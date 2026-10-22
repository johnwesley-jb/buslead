import type { AppointmentStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { addDaysStr, dateStrInZone, isDateStr, zonedToUtc } from '../lib/tz'
import { badRequest } from '../lib/errors'
import { listBusy, requireReadyConnection } from './google'
import { closedReason, daySlots, horizonWindow, nearestAlternatives } from './scheduler'
import type { BusyBlock, SchedulerSettings, Slot } from './scheduler'
import { getSchedulerSettings } from './settings'

/** Appointment states that hold a time on the calendar. */
export const ACTIVE: AppointmentStatus[] = ['pending', 'confirmed', 'auto_assigned']

type Db = Prisma.TransactionClient | typeof prisma

export async function dbBusyBlocks(db: Db, from: Date, to: Date, excludeAppointmentId?: string): Promise<BusyBlock[]> {
  const rows = await db.appointment.findMany({
    where: {
      status: { in: ACTIVE },
      scheduledStartAt: { lt: to },
      scheduledEndAt: { gt: from },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { scheduledStartAt: true, scheduledEndAt: true },
  })
  return rows.flatMap((r) => (r.scheduledStartAt && r.scheduledEndAt ? [{ start: r.scheduledStartAt, end: r.scheduledEndAt }] : []))
}

/** Busy time from our own bookings plus the connected Google calendar. Throws CALENDAR_UNAVAILABLE rather than guessing. */
export async function loadBusy(s: SchedulerSettings, from: Date, to: Date, excludeAppointmentId?: string): Promise<BusyBlock[]> {
  const conn = await requireReadyConnection()
  const [google, own] = await Promise.all([listBusy(conn.calendarId, from, to, s.timeZone, excludeAppointmentId), dbBusyBlocks(prisma, from, to, excludeAppointmentId)])
  return [...google, ...own]
}

export const dayWindow = (dateStr: string, tz: string) => ({
  from: zonedToUtc(addDaysStr(dateStr, -1), '00:00', tz),
  to: zonedToUtc(addDaysStr(dateStr, 2), '00:00', tz),
})

const slotInfo = (s: Slot | null) => (s ? { startAt: s.start.toISOString(), endAt: s.end.toISOString(), available: s.available, reason: s.reason } : null)

export async function getAvailability(dateStr: string, opts: { excludeAppointmentId?: string; requestedAt?: Date } = {}) {
  if (!isDateStr(dateStr)) throw badRequest('Use a date like 2026-10-27.', 'VALIDATION')
  const s = await getSchedulerSettings()
  const now = new Date()
  const closed = closedReason(dateStr, s)

  // Alternatives search spans the whole horizon; a plain day view only needs that day.
  const win = opts.requestedAt ? horizonWindow(s, now) : dayWindow(dateStr, s.timeZone)
  const busy = await loadBusy(s, win.from, win.to, opts.excludeAppointmentId)
  const slots = daySlots(dateStr, s, busy, now)
  let before: Slot | null = null
  let after: Slot | null = null
  if (opts.requestedAt) ({ before, after } = nearestAlternatives(opts.requestedAt, s, busy, now))
  return { date: dateStr, slots: slots.map((x) => slotInfo(x)!), closedReason: closed, before: slotInfo(before), after: slotInfo(after) }
}

/** Open slots around a time, for the phone assistant. */
export async function alternativesAround(requested: Date) {
  const s = await getSchedulerSettings()
  const now = new Date()
  const win = horizonWindow(s, now)
  const busy = await loadBusy(s, win.from, win.to)
  return { settings: s, ...nearestAlternatives(requested, s, busy, now) }
}

export { dateStrInZone }
