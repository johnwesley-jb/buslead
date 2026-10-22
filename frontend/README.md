# Buslead frontend (preview build)

React + TypeScript + Vite + Tailwind CSS v4 + TanStack Query + React Hook Form + Zod.

This build runs entirely on **simulated data**. There is no backend, database, Vapi or Google
connection yet. Everything the UI reads and writes goes through `src/mock/api.ts`, which adds
latency, validates like the real API will, and saves to `localStorage`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds to dist/
```

Sign in with `admin@buslead.test` or `agent@buslead.test`, password `buslead-demo`.
Admins can delete leads, change scheduling rules and connect the calendar. Agents cannot.
Profile & security has a "Reset preview data" button.

## What is simulated

| Area | Behavior in this preview |
| --- | --- |
| Leads, calls, appointments | 42 generated leads covering every scenario: caller booked, caller accepted an alternative, caller hung up (automatic assignment), calendar failure (needs a time), pending reservation, completed, cancelled, manual. |
| Availability | `src/mock/scheduler.ts` applies business hours, duration, buffer, minimum notice, horizon, holidays, internal appointments and external "busy" events. Booking re-checks the slot and fails with "no longer available" instead of faking success. |
| Calendar connection | Connect/disconnect/sync are simulated. Disconnecting blocks new bookings. |
| Recording playback | A clock walks through the call so seeking and transcript sync work. No audio file exists. Swap for an `<audio>` element pointed at the authorized recording endpoint. |
| Auth | Two demo users. The real build uses server sessions. |

## Swapping in the real backend

The data source is chosen in `src/api/index.ts`:

- **Simulated (default):** `npm run dev` with no env file. Everything lives in this browser.
- **Real backend:** copy `.env.example` to `.env.local` (it sets `VITE_USE_MOCK=false`), start the backend on port 4000, then `npm run dev`. Vite proxies `/api` to it, so the session cookie and the backend's CSRF checks work. Sign in with the admin you created via `npm run admin:create`.

`src/api/http.ts` implements the same functions as `src/mock/api.ts`; the hooks and pages do not know which is active. Preview-only UI (demo accounts, reset button, notices) is hidden in real mode.

## Structure

```
src/
  auth/          session context
  components/    ui kit, shell, call player, schedule dialog
  hooks/         TanStack Query hooks (one place for cache keys and invalidation)
  lib/           types, date helpers, formatting
  mock/          simulated API, seed data, slot engine
  pages/         one file per screen
```
