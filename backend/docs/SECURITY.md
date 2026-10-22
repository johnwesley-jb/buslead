# Security notes

## What is protected, and how

| Area | Control |
|---|---|
| Passwords | Argon2id (19 MiB, 2 passes). Min 12 characters. Unknown emails take the same time as wrong passwords. Account lock for 15 min after 5 failures; one generic error for every login failure so accounts cannot be enumerated. |
| Sessions | 256-bit random opaque token in an **HttpOnly, SameSite=Lax, Secure (in production), `__Host-`-prefixed** cookie. Only an HMAC of the token is stored. 12 h absolute and 2 h idle expiry; new token on every login; password change signs out other devices; deactivating a user ends their sessions immediately. |
| CSRF | State-changing requests need `X-Requested-With: buslead` **and**, if the browser sends `Origin`, it must equal `FRONTEND_ORIGIN`. CORS allows exactly that one origin. |
| Authorization | `requireAuth` on every dashboard route; admin-only for users, settings, calendar connect/disconnect, lead deletion. IDs are validated as UUIDs; all DB access goes through Prisma (parameterized). |
| Input | Zod validation on every body, query and tool argument; 100 KB body limit (2 MB on the webhook only); phone numbers normalized to E.164. |
| Vapi webhook | Bearer secret (≥32 chars) compared in constant time; 401 otherwise; own rate limit; no cookies; idempotent by `eoc:<callId>`; always returns 200 for tools with safe messages (no internals). |
| Public exposure | The tunnel hostname can only reach `/api/webhooks/*` and `/health`; login and the dashboard API return 404 there. Postgres and Redis bind to `127.0.0.1` only. |
| Google tokens | Refresh token encrypted with AES-256-GCM (`ENCRYPTION_KEY`); access tokens only in memory; least-privilege scopes; revoked at Google on disconnect; `invalid_grant` flips the connection to `needs_reauth` instead of retrying forever. |
| Recordings | Never exposed by URL. `GET /calls/:id/recording` authenticates the user, checks the upstream host against an allowlist (https only, no IPs, no ports, no redirects), forwards Range, logs the access, and sends `Cache-Control: private, no-store`. |
| Double booking | Re-check right before booking, Postgres advisory lock, and `EXCLUDE USING gist` on live appointment time ranges. |
| Headers | helmet with `default-src 'none'`, `frame-ancestors 'none'`, HSTS in production, `Referrer-Policy: no-referrer`, no `X-Powered-By`, `Cache-Control: no-store` on API responses. |
| Logging | pino with redaction of cookies, authorization, passwords, tokens, emails and phone numbers; request logging records method and path only (no query strings, which may carry OAuth codes; no bodies). |
| Audit | `ActivityLog` records logins, lockouts, user changes, settings changes, calendar connect/disconnect, lead and appointment changes, recording plays. |
| Data lifecycle | Daily job: removes expired recording links after `recordingRetentionDays`, processed webhook payloads (transcripts) after 30 days, expired sessions, activity older than 400 days. Deleting a lead deletes its notes, calls, appointments, activity and calendar events. |
| Dependencies | `npm audit --omit=dev` via `npm run audit`. Pin and review updates; run it before every release. |

## Your responsibilities on a home PC

* Keep `.env` out of OneDrive/Git (it is git-ignored). Treat `ENCRYPTION_KEY`, `SESSION_SECRET`, `VAPI_WEBHOOK_SECRET`, `VAPI_API_KEY` and `GOOGLE_CLIENT_SECRET` as passwords. If one leaks: rotate it (changing `SESSION_SECRET` signs everyone out; changing `VAPI_WEBHOOK_SECRET` needs the same change in the Vapi credential; changing `ENCRYPTION_KEY` requires reconnecting Google).
* The PC must be on, awake and tunnel-connected for calls to be processed. Webhooks missed while offline are **not** replayed by Vapi automatically; recordings and transcripts can be recovered with **Check again** on a call, but the lead only exists if the end-of-call-report reached you. Consider a small always-on host for real traffic.
* Windows Firewall: do not open ports 4000/5432/6379 to the network. Only the tunnel needs outbound access.
* Disk encryption (BitLocker) is the main protection for call data at rest; the database itself is not encrypted.
* Backups: `docker compose exec postgres pg_dump -U buslead buslead > backup.sql`. Store backups encrypted; they contain personal data.

## Known gaps (be aware, fix before real customer traffic)

1. No MFA for dashboard users.
2. Rate-limit counters are in process memory.
3. Webhook uses a shared secret, not a signature over the body (a leaked secret allows forged calls until rotated).
4. Transcripts and phone numbers are stored unencrypted in PostgreSQL (disk encryption assumed).
5. No automatic notification (email/SMS) to callers or staff.
6. Call recording consent: depending on where callers are, you may have to announce recording. Add that to the greeting; this is a legal requirement outside the code.
7. The code has not been penetration tested, and (see README) has not yet been run end to end.
