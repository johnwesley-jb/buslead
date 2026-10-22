# Buslead backend

API for the Buslead dashboard: leads, calls, appointments, scheduling rules, Google Calendar and the Vapi phone assistant.

**Stack:** Node 20+, Express, TypeScript, Prisma, PostgreSQL 16, Redis 7 + BullMQ, Zod, Argon2id, pino.

> **Status, plainly.** This code was written in an environment that could not install npm packages, so it has **not been
> compiled or run against a real database, Redis, Google or Vapi yet.** What *was* executed here: 37 offline tests of the
> pure logic (slot engine incl. time zones/DST, Vapi payload parsing, crypto, recording-URL guard, env validation, tunnel guard)
> and a strict type-check of those modules. Everything that touches Express, Prisma, BullMQ, Google or Vapi is
> reviewed but unexecuted. Expect to fix a few typos or type errors on the first `npm run typecheck`, and use the
> checklist in [First run](#first-run-checklist) to verify each integration before trusting it.

## How it fits together

```
 Caller ── phone ──▶ Vapi assistant ──┬─ tool calls (check_availability, book_appointment) ─┐
                                      └─ end-of-call-report (transcript, recording) ────────┤
                                                                                            ▼
                                          ngrok / Cloudflare tunnel ──▶  POST /api/webhooks/vapi   (Bearer secret)
                                                                                            │
 Dashboard (React) ──▶ /api/*  (HttpOnly session cookie + CSRF header) ────────────────────┤
                                                                                            ▼
                              Express API ──▶ PostgreSQL (leads, calls, appointments, audit log)
                                    │  ╲
                                    │   ╲──▶ Google Calendar (OAuth, events.list busy times, events insert/patch/delete)
                                    ▼
                               Redis / BullMQ worker: reserve-retry · auto-assign · process-webhook · sweep · reconcile · retention
```

* The **tunnel only exposes the webhook.** The API refuses every other path when a request arrives on the public tunnel hostname.
* A slot is **re-checked at the moment of booking** (rules + our bookings + Google busy time), taken under a Postgres advisory lock,
  and a database `EXCLUDE` constraint makes double-booking impossible even if the lock were bypassed.
* If Google fails after the slot is held, the appointment stays `pending` and the worker retries; nothing is faked as "confirmed".
* A caller's details are saved **before** scheduling is attempted, so a calendar outage never loses a lead.
* End-of-call processing is idempotent (unique event key, upsert on the Vapi call id, lead de-duplication by email/phone).

## Requirements

* Node.js 20.11+ and npm
* Docker Desktop (for PostgreSQL and Redis)
* ngrok or Cloudflare Tunnel (free tier is fine) so Vapi can reach your PC
* A Vapi account with a phone number, and a Google Cloud project (see `docs/`)

## Setup

```powershell
cd backend
copy .env.example .env          # then edit .env (see below). Never commit it, never paste it into chat.
npm install
docker compose up -d            # PostgreSQL + Redis, bound to 127.0.0.1 only
npx prisma generate
npx prisma migrate deploy       # creates tables and the no-overlap constraint
npm run admin:create            # creates the first admin from INITIAL_ADMIN_* in .env, then delete INITIAL_ADMIN_PASSWORD
npm run dev                     # API on http://localhost:4000
npm run dev:worker              # second terminal: background jobs
```

Generate the secrets for `.env` (PowerShell or any shell with Node):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # VAPI_WEBHOOK_SECRET (different value)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # ENCRYPTION_KEY
```

`POSTGRES_PASSWORD` must match the password inside `DATABASE_URL`. Keep `ENCRYPTION_KEY` safe: if you lose it, stored Google
tokens cannot be decrypted and you simply reconnect Google Calendar.

### Values only you can supply (put them in `.env`, not in chat)

| Variable | Where it comes from |
|---|---|
| `VAPI_API_KEY` | Vapi dashboard, API keys (private key) |
| `VAPI_WEBHOOK_SECRET` | You generate it; the same value goes into the Vapi Bearer credential |
| `VAPI_ASSISTANT_ID` | Optional reference only |
| `PUBLIC_API_URL` | Your tunnel's https URL, e.g. `https://abc123.ngrok-free.app` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (`docs/GOOGLE_SETUP.md`) |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | Your own choice (12+ characters) |

Then follow **`docs/GOOGLE_SETUP.md`** and **`docs/VAPI_SETUP.md`**.

## Connecting the dashboard

The dashboard still runs on its built-in simulated data. To point it at this API during development, add a proxy to
`frontend/vite.config.ts` so the browser sees one origin (cookies and CSRF checks then work without extra CORS):

```ts
server: { proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } }
```

The frontend must send `credentials: 'include'` and the header `X-Requested-With: buslead` on every non-GET request.
Replacing `frontend/src/mock/api.ts` with real `fetch` calls is a separate step (the response shapes already match
`frontend/src/lib/types.ts`; errors are `{ "error": { "code", "message" } }`).

`TRUST_PROXY=1` is right here: webhook traffic passes one proxy (the tunnel) and dashboard traffic passes one proxy (Vite's dev proxy).
A wrong value only weakens per-IP rate limiting, it does not open anything up.

## API overview

| Area | Endpoints (all under `/api`, cookie auth unless noted) |
|---|---|
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me` · `POST /auth/change-password` |
| Users (admin) | `GET/POST /users` · `PATCH /users/:id` |
| Leads | `GET /leads` (page, q, status, appointmentStatus, sort, dir) · `POST /leads` · `GET/PATCH/DELETE /leads/:id` · `POST /leads/:id/notes` |
| Calls | `GET /calls` · `GET /calls/:id` · `GET /calls/:id/recording` (authorized audio stream, Range supported) · `POST /calls/:id/refresh-recording` · `POST /calls/:id/reprocess` (admin) |
| Appointments | `GET /appointments` · `GET /appointments/availability?date=` · `POST /appointments` · `POST /appointments/auto-assign` · `GET /appointments/:id` · `POST /appointments/:id/reschedule` · `/cancel` · `/complete` |
| Calendar | `GET /calendar` · `POST /calendar/connect` (admin) → `{url}` · `GET /calendar/callback` · `POST /calendar/disconnect` · `PUT /calendar/selected` · `POST /calendar/sync` · `GET /calendar/events` |
| Settings | `GET /settings` · `PUT /settings` (admin) |
| Dashboard | `GET /dashboard/summary` · `/activity` · `/calls-by-day` · `/attention` |
| Vapi (bearer, no cookie) | `POST /webhooks/vapi` — `tool-calls` and `end-of-call-report`; other message types are acknowledged and ignored |
| Health | `GET /health` · `GET /health/ready` (local only) |

Roles: **admin** can manage users, settings, the calendar connection, delete leads and cancel inside the cut-off window; **agent** can work leads, calls and appointments.

## Testing

```
npm test                 # offline unit tests (node:test); no database needed
npm run typecheck
npm run simulate -- availability 2026-10-27        # fake Vapi tool call against your running API
npm run simulate -- book 2026-10-27 10:30
npm run simulate -- report --duplicate             # end-of-call report, sent twice: the second must be ignored
```

### First run checklist

Work through these in order; each one proves one integration before you rely on it.

1. `npm run typecheck` and `npm test` pass.
2. `docker compose up -d`, `npx prisma migrate deploy` succeeds (if the `EXCLUDE` migration fails, see Troubleshooting).
3. `npm run admin:create`, then sign in via `POST /api/auth/login` (or the dashboard once it is wired up).
4. Connect Google Calendar (admin) and confirm `GET /api/calendar` shows `health: healthy` and your calendars.
5. `npm run simulate -- availability <a weekday>` returns open times. `book` creates an event in your calendar. Run `book` again for the same time with another call id (`SIM_CALL_ID=other`): it must answer `unavailable`.
6. `npm run simulate -- report --duplicate`: one lead, one call, second delivery says `duplicate`.
7. Start the tunnel, set the Vapi server URL, place a real call. Check the Calls page for transcript and recording.
8. Open `https://<tunnel>/api/auth/login` in a browser: it must return 404 (tunnel guard).

## Troubleshooting

* **`Invalid environment configuration`** at start: the message lists variable names (never values). Fix `.env`.
* **Migration fails on `EXCLUDE USING gist`**: the Postgres image in `docker-compose.yml` supports it. If you use another Postgres, run `CREATE EXTENSION IF NOT EXISTS btree_gist;` first; range-only exclusion normally needs no extension.
* **Prisma generate/migrate on Windows + OneDrive** can hit file locks. Keep `node_modules` out of OneDrive sync (pause sync, or move the repo to e.g. `C:\dev\buslead`).
* **Vapi says the tool returned no result**: the webhook must answer HTTP 200 within the tool timeout. Check the API log for the request id, and that the Bearer credential matches `VAPI_WEBHOOK_SECRET`.
* **Google asks you to reconnect every week**: expected while the OAuth app is in *Testing* mode; see `docs/GOOGLE_SETUP.md`.
* **Recording button says "blocked"**: the recording URL's host is not in `RECORDING_HOST_ALLOWLIST`. Add the real host from your Vapi call data.

## Known limitations

* Rate limits are per process and in memory (fine for one API instance on your PC; use a Redis store if you ever run several).
* No MFA for dashboard logins yet, and no email/SMS confirmation to callers (events are created without attendees on purpose).
* Vapi payload fields beyond those documented are parsed defensively; if a field is named differently in your account, the call is still saved and the field is simply empty.
* Recordings are streamed from Vapi's storage, not copied. "Retention" removes our link to them; deleting the audio itself is controlled in your Vapi settings.
* The Vapi webhook signature scheme (HMAC) is not used because its format is not documented publicly; a Bearer credential with constant-time comparison is used instead.
