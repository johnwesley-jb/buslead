/**
 * Appointment lifecycle. The invariants:
 *  - a slot is re-verified (settings + our bookings + Google busy time) immediately before it is held;
 *  - holding a slot happens under a Postgres advisory lock, and a database EXCLUDE constraint backs it up;
 *  - Google is written AFTER the local row exists, using a deterministic event id, so retries are idempotent;
 *  - if Google fails, the appointment stays `pending` with confirmationStatus `failed` and a retry job takes over.
 */
import type { Appointment, AssignmentSource, Lead } from '@prisma/client'
import { env } from '../config/env'
import { AppError, conflict, notFound } from '../lib/errors'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { dateStrInZone, formatSpoken } from '../lib/tz'
import { enqueue } from '../jobs/queues'
import { logActivity } from './audit'
import { ACTIVE, dayWindow, dbBusyBlocks } from './availability'
import { deleteEvent, listBusy, patchEvent, requireReadyConnection, upsertEvent } from './google'
import type { EventInput } from './google'
import { earliestSlot, horizonWindow, isSlotAvailable } from './scheduler'
import { getSchedulerSettings } from './settings'

const LOCK_SQL = 'SELECT pg_advisory_xact_lock(727001)'
const MIN = 60_000
const MAX_RESERVATION_ATTEMPTS = 8

const isExclusionViolation = (e: unknown) => {
  const m = String((e as Error)?.message ?? '')
  return m.includes('appointment_no_overlap') || m.includes('23P01')
}

export const slotTaken = () => conflict('SLOT_TAKEN', 'That time is no longer available. Pick another open slot.')

function eventFor(a: Pick<Appointment, 'id' | 'scheduledStartAt' | 'scheduledEndAt' | 'timeZone' | 'assignmentSource'>, lead: Lead): EventInput {
  const how = a.assignmentSource === 'caller' ? 'chosen by the caller' : a.assignmentSource === 'automatic' ? 'assigned automatically' : 'scheduled by staff'
  return {
    appointmentId: a.id,
    summary: `Follow-up: ${lead.fullName}`,
    description: [`Reason: ${lead.reasonForCall}`, `Phone: ${lead.phoneNumber}`, `Email: ${lead.email}`, `Booked: ${how}`, `Open in Buslead: ${env.FRONTEND_ORIGIN}/appointments/${a.id}`].join('\n'),
    start: a.scheduledStartAt!,
    end: a.scheduledEndAt!,
    timeZone: a.timeZone,
  }
}

/** Pushes the appointment to Google and records the outcome. Never throws for Google failures. */
async function finalize(appointmentId: string, calendarId: string, success: 'confirmed' | 'auto_assigned', actor: string): Promise<Appointment> {
  const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { lead: true } })
  try {
    const ev = eventFor(appt, appt.lead)
    const eventId = appt.googleEventId ? await patchEvent(calendarId, appt.googleEventId, ev) : await upsertEvent(calendarId, ev)
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId, confirmationStatus: 'reserved', status: success } })
      if (['new', 'contacted'].includes(appt.lead.status)) await tx.lead.update({ where: { id: appt.leadId }, data: { status: 'follow_up_scheduled' } })
      await logActivity({ leadId: appt.leadId, callId: appt.callId, appointmentId: appt.id, action: 'appointment.reserved', details: `Reserved ${formatSpoken(appt.scheduledStartAt!, appt.timeZone)} in Google Calendar`, actor }, tx)
      return u
    })
    return updated
  } catch (e) {
    const attempts = appt.reservationAttempts + 1
    const message = e instanceof AppError ? e.message : 'Google Calendar request failed'
    logger.warn({ appointmentId, attempts, code: e instanceof AppError ? e.code : 'UNKNOWN' }, 'calendar reservation failed; will retry')
    const updated = await prisma.appointment.update({ where: { id: appt.id }, data: { confirmationStatus: 'failed', reservationAttempts: attempts } })
    await logActivity({ leadId: appt.leadId, callId: appt.callId, appointmentId: appt.id, action: 'appointment.reservation_failed', details: `${message}. Retrying automatically.`, actor })
    await enqueue('reserve-retry', { appointmentId: appt.id, target: success }, { jobId: `reserve-${appt.id}-${attempts}`, delay: Math.min(15_000 * 2 ** attempts, 15 * MIN) })
    return updated
  }
}

export interface ReserveInput {
  leadId: string
  callId?: string | null
  start: Date
  source: AssignmentSource
  requestedStart?: Date | null
  actor: string
}

/** Holds a specific slot. Throws SLOT_TAKEN if it is not available at the moment of booking. */
export async function reserveAppointment(i: ReserveInput): Promise<Appointment> {
  const conn = await requireReadyConnection()
  const s = await getSchedulerSettings()
  const now = new Date()
  const win = dayWindow(dateStrInZone(i.start, s.timeZone), s.timeZone)
  const googleBusy = await listBusy(conn.calendarId, win.from, win.to, s.timeZone)
  const end = new Date(i.start.getTime() + s.appointmentDurationMinutes * MIN)

  let held: Appointment
  try {
    held = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(LOCK_SQL)
        const own = await dbBusyBlocks(tx, win.from, win.to)
        if (!isSlotAvailable(i.start, s, [...googleBusy, ...own], now)) throw slotTaken()
        const lead = await tx.lead.findUnique({ where: { id: i.leadId }, select: { id: true } })
        if (!lead) throw notFound('This lead no longer exists.')
        const a = await tx.appointment.create({
          data: {
            leadId: i.leadId,
            callId: i.callId ?? null,
            requestedStartAt: i.requestedStart ?? i.start,
            scheduledStartAt: i.start,
            scheduledEndAt: end,
            timeZone: s.timeZone,
            status: 'pending',
            confirmationStatus: 'pending',
            assignmentSource: i.source,
          },
        })
        await logActivity({ leadId: i.leadId, callId: i.callId, appointmentId: a.id, action: 'appointment.created', details: `Holding ${formatSpoken(i.start, s.timeZone)} (${i.source})`, actor: i.actor }, tx)
        return a
      },
      { timeout: 15_000 },
    )
  } catch (e) {
    if (isExclusionViolation(e)) throw slotTaken()
    throw e
  }
  return finalize(held.id, conn.calendarId, i.source === 'automatic' ? 'auto_assigned' : 'confirmed', i.actor)
}

/** Books the earliest open slot, or flags the lead for manual scheduling when nothing is open. */
export async function autoAssign(leadId: string, actor: string, callId?: string | null): Promise<Appointment> {
  const existing = await prisma.appointment.findFirst({ where: { leadId, status: { in: ACTIVE } } })
  if (existing) return existing

  const conn = await requireReadyConnection()
  const s = await getSchedulerSettings()
  const now = new Date()
  const win = horizonWindow(s, now)
  const googleBusy = await listBusy(conn.calendarId, win.from, win.to, s.timeZone)

  let held: Appointment | null = null
  try {
    held = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(LOCK_SQL)
        const dup = await tx.appointment.findFirst({ where: { leadId, status: { in: ACTIVE } } })
        if (dup) return dup
        const own = await dbBusyBlocks(tx, win.from, win.to)
        const slot = earliestSlot(s, [...googleBusy, ...own], now)
        if (!slot) return null
        const a = await tx.appointment.create({
          data: { leadId, callId: callId ?? null, requestedStartAt: slot.start, scheduledStartAt: slot.start, scheduledEndAt: slot.end, timeZone: s.timeZone, status: 'pending', confirmationStatus: 'pending', assignmentSource: 'automatic' },
        })
        await logActivity({ leadId, callId, appointmentId: a.id, action: 'appointment.auto_assigned', details: `Earliest open slot: ${formatSpoken(slot.start, s.timeZone)}`, actor }, tx)
        return a
      },
      { timeout: 20_000 },
    )
  } catch (e) {
    if (isExclusionViolation(e)) throw slotTaken()
    throw e
  }

  if (!held) {
    const a = await prisma.appointment.create({ data: { leadId, callId: callId ?? null, timeZone: s.timeZone, status: 'rescheduling_required', confirmationStatus: 'failed', assignmentSource: 'automatic' } })
    await logActivity({ leadId, callId, appointmentId: a.id, action: 'appointment.no_slot', details: 'No open slot within the scheduling window. Assign a time manually.', actor })
    return a
  }
  if (held.status !== 'pending') return held // returned an existing active appointment
  return finalize(held.id, conn.calendarId, 'auto_assigned', actor)
}

const MOVABLE = ['pending', 'confirmed', 'auto_assigned', 'rescheduling_required', 'failed'] as const

export async function moveAppointment(id: string, start: Date, actor: string): Promise<Appointment> {
  const current = await prisma.appointment.findUnique({ where: { id } })
  if (!current) throw notFound('This appointment could not be found.')
  if (!(MOVABLE as readonly string[]).includes(current.status)) throw new AppError(409, 'INVALID_STATE', 'Only active appointments can be rescheduled.')

  const conn = await requireReadyConnection()
  const s = await getSchedulerSettings()
  const now = new Date()
  const win = dayWindow(dateStrInZone(start, s.timeZone), s.timeZone)
  const googleBusy = await listBusy(conn.calendarId, win.from, win.to, s.timeZone, id)
  const end = new Date(start.getTime() + s.appointmentDurationMinutes * MIN)

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(LOCK_SQL)
        const own = await dbBusyBlocks(tx, win.from, win.to, id)
        if (!isSlotAvailable(start, s, [...googleBusy, ...own], now)) throw slotTaken()
        const hadTime = Boolean(current.scheduledStartAt)
        await tx.appointment.update({
          where: { id },
          data: {
            scheduledStartAt: start,
            scheduledEndAt: end,
            timeZone: s.timeZone,
            status: 'pending',
            confirmationStatus: 'pending',
            assignmentSource: 'manual',
            reservationAttempts: 0,
            rescheduleCount: hadTime ? { increment: 1 } : undefined,
          },
        })
        await logActivity({ leadId: current.leadId, callId: current.callId, appointmentId: id, action: 'appointment.rescheduled', details: `Moved to ${formatSpoken(start, s.timeZone)}`, actor }, tx)
      },
      { timeout: 15_000 },
    )
  } catch (e) {
    if (isExclusionViolation(e)) throw slotTaken()
    throw e
  }
  return finalize(id, conn.calendarId, 'confirmed', actor)
}

export async function cancelAppointment(id: string, reason: string, actor: { name: string; role: 'admin' | 'agent' }): Promise<Appointment> {
  const appt = await prisma.appointment.findUnique({ where: { id } })
  if (!appt) throw notFound('This appointment could not be found.')
  if (!ACTIVE.includes(appt.status) && appt.status !== 'rescheduling_required') throw new AppError(409, 'INVALID_STATE', 'Only active appointments can be cancelled.')

  const cutoff = (await prisma.businessSettings.findUnique({ where: { id: 1 } }))?.cancellationCutoffHours ?? 24
  if (appt.scheduledStartAt && actor.role !== 'admin') {
    const hoursAway = (appt.scheduledStartAt.getTime() - Date.now()) / 3_600_000
    if (hoursAway >= 0 && hoursAway < cutoff) throw new AppError(403, 'CUTOFF', `Appointments inside ${cutoff} hours can only be cancelled by an admin.`)
  }
  const cleanReason = reason.trim() || 'Cancelled'
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.appointment.update({ where: { id }, data: { status: 'cancelled', cancelReason: cleanReason.slice(0, 300) } })
    await logActivity({ leadId: appt.leadId, callId: appt.callId, appointmentId: id, action: 'appointment.cancelled', details: cleanReason, actor: actor.name }, tx)
    return u
  })
  if (appt.googleEventId) await removeEvent(updated, actor.name)
  return prisma.appointment.findUniqueOrThrow({ where: { id } })
}

/** Deletes the Google event. On failure the id is kept so the reconcile job can finish the cleanup. */
export async function removeEvent(appt: Appointment, actor: string) {
  if (!appt.googleEventId) return
  try {
    const conn = await requireReadyConnection()
    await deleteEvent(conn.calendarId, appt.googleEventId)
    await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: null } })
    await logActivity({ leadId: appt.leadId, appointmentId: appt.id, action: 'appointment.event_removed', details: 'Google Calendar event removed', actor })
  } catch (e) {
    logger.warn({ appointmentId: appt.id, code: e instanceof AppError ? e.code : 'UNKNOWN' }, 'could not remove calendar event; reconcile will retry')
    await logActivity({ leadId: appt.leadId, appointmentId: appt.id, action: 'appointment.event_removal_failed', details: 'Could not remove the Google Calendar event yet. It will be retried.', actor })
  }
}

export async function completeAppointment(id: string, actor: string): Promise<Appointment> {
  const appt = await prisma.appointment.findUnique({ where: { id }, include: { lead: true } })
  if (!appt) throw notFound('This appointment could not be found.')
  if (!['confirmed', 'auto_assigned'].includes(appt.status)) throw new AppError(409, 'INVALID_STATE', 'Only confirmed appointments can be marked complete.')
  return prisma.$transaction(async (tx) => {
    const u = await tx.appointment.update({ where: { id }, data: { status: 'completed' } })
    if (['new', 'follow_up_scheduled'].includes(appt.lead.status)) await tx.lead.update({ where: { id: appt.leadId }, data: { status: 'contacted' } })
    await logActivity({ leadId: appt.leadId, callId: appt.callId, appointmentId: id, action: 'appointment.completed', details: 'Follow-up marked complete', actor }, tx)
    return u
  })
}

/** Called by the retry job. Gives up after a fixed number of attempts and flags the appointment for a human. */
export async function retryReservation(appointmentId: string, target: 'confirmed' | 'auto_assigned') {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
  if (!appt || appt.status !== 'pending' || appt.confirmationStatus === 'reserved' || !appt.scheduledStartAt) return 'skipped' as const
  if (appt.reservationAttempts >= MAX_RESERVATION_ATTEMPTS) {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id: appt.id }, data: { status: 'rescheduling_required' } })
      await logActivity({ leadId: appt.leadId, appointmentId: appt.id, action: 'appointment.reservation_gave_up', details: 'Google Calendar could not be updated after several attempts. Assign a time manually.' }, tx)
    })
    return 'gave_up' as const
  }
  const conn = await requireReadyConnection() // throws -> job retries with backoff
  const after = await finalize(appt.id, conn.calendarId, target, 'System')
  return after.confirmationStatus === 'reserved' ? ('done' as const) : ('retry' as const)
}

