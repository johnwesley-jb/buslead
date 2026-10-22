/**
 * Google Calendar client using plain REST + fetch (no SDK). Least-privilege scopes:
 *   calendar.events                      read/write events (also lets us read busy times)
 *   calendar.calendarlist.readonly       list calendars so the admin can pick one
 *   openid email                         show which Google account is connected
 * The refresh token is encrypted at rest (AES-256-GCM). Access tokens live only in memory.
 */
import type { CalendarConnection } from '@prisma/client'
import { env, googleConfigured } from '../config/env'
import { decrypt, encrypt } from '../lib/crypto'
import { AppError } from '../lib/errors'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { zonedToUtc } from '../lib/tz'
import type { BusyBlock } from './scheduler'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const API = 'https://www.googleapis.com/calendar/v3'

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
]

const TIMEOUT_MS = 10_000

export const calendarUnavailable = (why = 'Google Calendar is not connected. Reconnect it in Calendar settings before scheduling.') =>
  new AppError(503, 'CALENDAR_UNAVAILABLE', why)

function requireOAuthConfig() {
  if (!googleConfigured()) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google OAuth is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).')
}

/* ---------- OAuth ---------- */

export function buildAuthUrl(state: string, loginHint?: string): string {
  requireOAuthConfig()
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // we need a refresh token
    prompt: 'select_account consent', // always show the account chooser; consent is needed for Google to return a refresh token
    include_granted_scopes: 'false',
    state,
  })
  if (loginHint) p.set('login_hint', loginHint)
  return `${AUTH_URL}?${p.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(body: Record<string, string>): Promise<{ ok: boolean; status: number; data: TokenResponse }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse
  return { ok: res.ok, status: res.status, data }
}

let cached: { token: string; exp: number } | null = null
export const clearAccessTokenCache = () => {
  cached = null
}

/** Completes the OAuth dance and stores the connection. Throws AppError with a user-safe message. */
export async function completeConnection(code: string) {
  requireOAuthConfig()
  const r = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: env.GOOGLE_REDIRECT_URI })
  if (!r.ok || !r.data.access_token) {
    logger.warn({ status: r.status, error: r.data.error }, 'google code exchange failed')
    throw new AppError(502, 'GOOGLE_EXCHANGE_FAILED', 'Google did not accept the authorization. Try connecting again.')
  }
  const granted = (r.data.scope ?? '').split(' ')
  if (!granted.includes('https://www.googleapis.com/auth/calendar.events')) {
    throw new AppError(400, 'GOOGLE_SCOPE_MISSING', 'Calendar access was not granted. Connect again and allow calendar access.')
  }
  if (!r.data.refresh_token) {
    throw new AppError(400, 'GOOGLE_NO_REFRESH_TOKEN', 'Google did not return a long-lived token. Remove Buslead at myaccount.google.com/permissions, then connect again.')
  }
  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${r.data.access_token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then((x) => (x.ok ? (x.json() as Promise<{ email?: string }>) : { email: undefined }))
    .catch(() => ({ email: undefined }))

  cached = { token: r.data.access_token, exp: Date.now() + (r.data.expires_in ?? 3600) * 1000 - 60_000 }
  const calendars = await listCalendars(r.data.access_token)
  const primary = calendars.find((c) => c.primary) ?? calendars[0]
  const data = {
    googleAccountEmail: info.email ?? 'unknown',
    refreshTokenEnc: encrypt(r.data.refresh_token, env.ENCRYPTION_KEY),
    scopes: r.data.scope ?? SCOPES.join(' '),
    calendarId: primary?.id ?? null,
    calendars,
    health: 'healthy' as const,
    connectedAt: new Date(),
    lastSyncedAt: new Date(),
  }
  await prisma.calendarConnection.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } })
}

/** Returns a valid access token, refreshing when needed. Marks the connection `needs_reauth` on invalid_grant. */
export async function getAccessToken(conn?: CalendarConnection | null): Promise<string> {
  requireOAuthConfig()
  if (cached && cached.exp > Date.now()) return cached.token
  const c = conn ?? (await prisma.calendarConnection.findUnique({ where: { id: 1 } }))
  if (!c) throw calendarUnavailable()
  if (c.health !== 'healthy') throw calendarUnavailable('Google Calendar needs to be reconnected. Open Calendar settings and reconnect.')

  let refreshToken: string
  try {
    refreshToken = decrypt(c.refreshTokenEnc, env.ENCRYPTION_KEY)
  } catch {
    await markNeedsReauth()
    throw calendarUnavailable('Stored Google credentials could not be read. Reconnect Google Calendar.')
  }
  let r
  try {
    r = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'google token refresh network error')
    throw calendarUnavailable('Google Calendar could not be reached. Try again shortly.')
  }
  if (!r.ok || !r.data.access_token) {
    if (r.data.error === 'invalid_grant') {
      await markNeedsReauth()
      throw calendarUnavailable('Google access has expired or was revoked. Reconnect Google Calendar.')
    }
    logger.warn({ status: r.status, error: r.data.error }, 'google token refresh failed')
    throw calendarUnavailable('Google Calendar could not be reached. Try again shortly.')
  }
  cached = { token: r.data.access_token, exp: Date.now() + (r.data.expires_in ?? 3600) * 1000 - 60_000 }
  return cached.token
}

async function markNeedsReauth() {
  cached = null
  await prisma.calendarConnection.update({ where: { id: 1 }, data: { health: 'needs_reauth' } }).catch(() => undefined)
}

export async function revokeAndForget() {
  const c = await prisma.calendarConnection.findUnique({ where: { id: 1 } })
  cached = null
  if (c && googleConfigured()) {
    try {
      const token = decrypt(c.refreshTokenEnc, env.ENCRYPTION_KEY)
      await fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      /* best effort: the local credentials are deleted regardless */
    }
  }
  await prisma.calendarConnection.deleteMany({ where: { id: 1 } })
}

/* ---------- REST helper ---------- */

async function gcal<T>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown; okStatuses?: number[] } = {}): Promise<{ status: number; data: T }> {
  const conn = await prisma.calendarConnection.findUnique({ where: { id: 1 } })
  const url = `${API}${path}${opts.query ? `?${new URLSearchParams(opts.query)}` : ''}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(conn)
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      logger.warn({ err: (e as Error).message, method, path }, 'google calendar network error')
      throw calendarUnavailable('Google Calendar could not be reached. Try again shortly.')
    }
    if (res.status === 401 && attempt === 0) {
      cached = null // stale access token: refresh and retry once
      continue
    }
    const data = (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T
    if (res.ok || opts.okStatuses?.includes(res.status)) return { status: res.status, data }
    logger.warn({ status: res.status, method, path, reason: (data as { error?: { message?: string } })?.error?.message }, 'google calendar request failed')
    if (res.status === 403 || res.status === 401) {
      await markNeedsReauth()
      throw calendarUnavailable('Google refused the request. Reconnect Google Calendar.')
    }
    throw new AppError(res.status === 429 ? 503 : 502, res.status === 429 ? 'CALENDAR_UNAVAILABLE' : 'CALENDAR_ERROR', 'Google Calendar returned an error. Try again shortly.')
  }
  throw calendarUnavailable()
}

/* ---------- calendars ---------- */

export interface CalendarInfo {
  id: string
  name: string
  primary: boolean
}

async function listCalendars(accessToken: string): Promise<CalendarInfo[]> {
  const res = await fetch(`${API}/users/me/calendarList?minAccessRole=writer&maxResults=100`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new AppError(502, 'CALENDAR_ERROR', 'Could not list your Google calendars.')
  const data = (await res.json()) as { items?: Array<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean }> }
  return (data.items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary) }))
}

export async function refreshCalendars(): Promise<CalendarInfo[]> {
  const token = await getAccessToken()
  const calendars = await listCalendars(token)
  await prisma.calendarConnection.update({ where: { id: 1 }, data: { calendars, lastSyncedAt: new Date() } })
  return calendars
}

/* ---------- events ---------- */

interface GEvent {
  id: string
  status?: string
  transparency?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: Array<{ self?: boolean; responseStatus?: string }>
  extendedProperties?: { private?: Record<string, string> }
}

/**
 * Busy periods on the chosen calendar between `from` and `to`. Cancelled events, events marked "free" and events the
 * owner declined are ignored. When `excludeAppointmentId` is given, the event created for that appointment is ignored
 * too (needed when moving an appointment, otherwise it would block its own new time).
 */
export async function listBusy(calendarId: string, from: Date, to: Date, timeZone: string, excludeAppointmentId?: string): Promise<BusyBlock[]> {
  const out: BusyBlock[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const { data } = await gcal<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, {
      query: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        fields: 'nextPageToken,items(id,status,transparency,start,end,attendees(self,responseStatus),extendedProperties/private)',
        ...(pageToken ? { pageToken } : {}),
      },
    })
    for (const e of data.items ?? []) {
      if (e.status === 'cancelled' || e.transparency === 'transparent') continue
      if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
      if (excludeAppointmentId && e.extendedProperties?.private?.busleadAppointmentId === excludeAppointmentId) continue
      const start = e.start?.dateTime ? new Date(e.start.dateTime) : e.start?.date ? zonedToUtc(e.start.date, '00:00', timeZone) : null
      const end = e.end?.dateTime ? new Date(e.end.dateTime) : e.end?.date ? zonedToUtc(e.end.date, '00:00', timeZone) : null
      if (start && end && end > start) out.push({ start, end })
    }
    pageToken = data.nextPageToken
  } while (pageToken && ++pages < 20)
  return out
}

export interface OwnEvent {
  appointmentId: string
  start: Date | null
  end: Date | null
  cancelled: boolean
}

/** Events this app created (tagged with busleadAppointmentId) in a window, for reconciliation. */
export async function listOwnEvents(calendarId: string, from: Date, to: Date): Promise<Map<string, OwnEvent>> {
  const out = new Map<string, OwnEvent>()
  let pageToken: string | undefined
  let pages = 0
  do {
    const { data } = await gcal<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, {
      query: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: 'true',
        showDeleted: 'true',
        maxResults: '250',
        fields: 'nextPageToken,items(id,status,start,end,extendedProperties/private)',
        ...(pageToken ? { pageToken } : {}),
      },
    })
    for (const e of data.items ?? []) {
      const id = e.extendedProperties?.private?.busleadAppointmentId
      if (!id) continue
      out.set(id, { appointmentId: id, start: e.start?.dateTime ? new Date(e.start.dateTime) : null, end: e.end?.dateTime ? new Date(e.end.dateTime) : null, cancelled: e.status === 'cancelled' })
    }
    pageToken = data.nextPageToken
  } while (pageToken && ++pages < 20)
  return out
}

/** Google event ids must be 5-1024 chars of a-v and 0-9 (base32hex). A UUID without dashes qualifies. */
export const eventIdFor = (appointmentId: string) => `bl${appointmentId.replace(/-/g, '').toLowerCase()}`

export interface EventInput {
  appointmentId: string
  summary: string
  description: string
  start: Date
  end: Date
  timeZone: string
}

const eventBody = (e: EventInput) => ({
  summary: e.summary,
  description: e.description,
  start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
  end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
  reminders: { useDefault: true },
  extendedProperties: { private: { busleadAppointmentId: e.appointmentId } },
})

/** Idempotent: the same appointment always maps to the same event id, so a retry cannot create a duplicate. */
export async function upsertEvent(calendarId: string, e: EventInput): Promise<string> {
  const id = eventIdFor(e.appointmentId)
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`
  const created = await gcal<{ id: string }>('POST', base, { body: { id, ...eventBody(e) }, okStatuses: [409] })
  if (created.status === 409) {
    // Already exists (an earlier attempt succeeded, or it was cancelled before). Make it match, and un-cancel if needed.
    await gcal('PATCH', `${base}/${id}`, { body: { ...eventBody(e), status: 'confirmed' } })
  }
  return id
}

export async function patchEvent(calendarId: string, eventId: string, e: EventInput): Promise<string> {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`
  const r = await gcal('PATCH', `${base}/${eventId}`, { body: eventBody(e), okStatuses: [404, 410] })
  if (r.status === 404 || r.status === 410) return upsertEvent(calendarId, e) // someone deleted it by hand
  return eventId
}

/** 404 / 410 mean it is already gone, which is the outcome we want. */
export async function deleteEvent(calendarId: string, eventId: string) {
  await gcal('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { okStatuses: [404, 410] })
}

export async function getConnectionRow() {
  return prisma.calendarConnection.findUnique({ where: { id: 1 } })
}

/** The connection must exist, be healthy and have a calendar chosen. */
export async function requireReadyConnection() {
  const c = await getConnectionRow()
  if (!c) throw calendarUnavailable()
  if (c.health !== 'healthy') throw calendarUnavailable('Google Calendar needs to be reconnected. Open Calendar settings and reconnect.')
  if (!c.calendarId) throw calendarUnavailable('No calendar is selected. Choose one in Calendar settings.')
  return { ...c, calendarId: c.calendarId }
}

export function connectionDto(c: CalendarConnection | null) {
  if (!c) return { connected: false, googleAccountEmail: null, calendarId: null, calendars: [], tokenExpiresAt: null, lastSyncedAt: null, health: 'disconnected' as const }
  // In Testing mode Google expires refresh tokens after 7 days; show that date so it is never a surprise.
  const tokenExpiresAt = env.GOOGLE_OAUTH_TESTING_MODE ? new Date(c.connectedAt.getTime() + 7 * 86_400_000).toISOString() : null
  return {
    connected: true,
    googleAccountEmail: c.googleAccountEmail,
    calendarId: c.calendarId,
    calendars: (c.calendars as CalendarInfo[]) ?? [],
    tokenExpiresAt,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    health: c.health,
  }
}
