import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env'
import { OAUTH_STATE_COOKIE, clearSecureCookie, parseCookies, setSecureCookie } from '../lib/cookies'
import { randomToken, safeEqual } from '../lib/crypto'
import { AppError, notFound } from '../lib/errors'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { me, requireAuth, requireRole } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { heavyLimiter } from '../middleware/security'
import { logActivity } from '../services/audit'
import { buildAuthUrl, clearAccessTokenCache, completeConnection, connectionDto, getConnectionRow, listBusy, refreshCalendars, requireReadyConnection, revokeAndForget } from '../services/google'
import { getSettingsRow } from '../services/settings'

export const calendar = Router()

/**
 * Google redirects the browser here with ?code&state. It is a top-level GET navigation, so the SameSite=Lax session
 * cookie is sent; the `state` value is checked against a short-lived HttpOnly cookie to block login-CSRF.
 */
calendar.get(
  '/callback',
  requireAuth,
  requireRole('admin'),
  wrap(async (req, res) => {
    const back = (q: string) => res.redirect(302, `${env.FRONTEND_ORIGIN}/settings/calendar?${q}`)
    const stateCookie = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE]
    clearSecureCookie(res, OAUTH_STATE_COOKIE)

    const q = req.query
    if (typeof q.error === 'string') return back(`calendar_error=${encodeURIComponent(q.error === 'access_denied' ? 'denied' : 'google_error')}`)
    const code = typeof q.code === 'string' ? q.code : ''
    const state = typeof q.state === 'string' ? q.state : ''
    if (!code || !state || !stateCookie || !safeEqual(state, stateCookie)) return back('calendar_error=state')

    try {
      await completeConnection(code)
      await logActivity({ action: 'calendar.connected', details: 'Google Calendar connected', actor: me(req).name })
      return back('calendar_connected=1')
    } catch (e) {
      logger.warn({ code: e instanceof AppError ? e.code : 'UNKNOWN' }, 'google connection failed')
      return back(`calendar_error=${encodeURIComponent(e instanceof AppError ? e.code : 'failed')}`)
    }
  }),
)

calendar.use(requireAuth)

calendar.get(
  '/',
  wrap(async (_req, res) => {
    res.json(connectionDto(await getConnectionRow()))
  }),
)

/** Starts OAuth. Returns the Google consent URL; the dashboard navigates the browser to it. */
calendar.post(
  '/connect',
  requireRole('admin'),
  wrap(async (_req, res) => {
    const state = randomToken(24)
    setSecureCookie(res, OAUTH_STATE_COOKIE, state, 600)
    res.json({ url: buildAuthUrl(state) })
  }),
)

calendar.post(
  '/disconnect',
  requireRole('admin'),
  wrap(async (req, res) => {
    await revokeAndForget()
    await logActivity({ action: 'calendar.disconnected', details: 'Google Calendar disconnected. New bookings are paused.', actor: me(req).name })
    res.json(connectionDto(null))
  }),
)

calendar.put(
  '/selected',
  requireRole('admin'),
  wrap(async (req, res) => {
    const { calendarId } = parse(z.object({ calendarId: z.string().min(1).max(300) }), req.body)
    const c = await getConnectionRow()
    if (!c) throw notFound('Google Calendar is not connected.')
    const list = (c.calendars as Array<{ id: string; name: string }>) ?? []
    const pick = list.find((x) => x.id === calendarId)
    if (!pick) throw notFound('That calendar is not on the connected account.')
    const updated = await prisma.calendarConnection.update({ where: { id: 1 }, data: { calendarId } })
    clearAccessTokenCache()
    await logActivity({ action: 'calendar.selected', details: `Using calendar ${pick.name}`, actor: me(req).name })
    res.json(connectionDto(updated))
  }),
)

calendar.post(
  '/sync',
  heavyLimiter,
  wrap(async (_req, res) => {
    await refreshCalendars()
    res.json(connectionDto(await getConnectionRow()))
  }),
)

/** Busy periods from Google for the calendar view. Only times are returned, never event titles or attendees. */
calendar.get(
  '/events',
  heavyLimiter,
  wrap(async (req, res) => {
    const q = parse(z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }), req.query)
    const from = new Date(q.from)
    const to = new Date(q.to)
    if (to <= from || to.getTime() - from.getTime() > 62 * 86_400_000) throw new AppError(400, 'VALIDATION', 'Choose a range of up to two months.')
    const conn = await requireReadyConnection()
    const settings = await getSettingsRow()
    const busy = await listBusy(conn.calendarId, from, to, settings.timeZone)
    res.json(busy.map((b) => ({ id: `busy-${b.start.toISOString()}`, title: 'Busy (Google Calendar)', startAt: b.start.toISOString(), endAt: b.end.toISOString() })))
  }),
)
