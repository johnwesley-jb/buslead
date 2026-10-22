/**
 * Background worker (run separately: `npm run dev:worker`). Jobs:
 *  reserve-retry    push a held appointment to Google again after a failure
 *  auto-assign      book the earliest slot for a lead that has contact details but no appointment
 *  process-webhook  re-run a Vapi end-of-call report that failed the first time
 *  sweep (5 min)    safety net: re-discovers unfinished work in the database, so nothing depends on Redis alone
 *  reconcile (30m)  compares our appointments with the Google calendar and flags/syncs differences
 *  retention (daily) removes expired recording links, old webhook payloads and expired sessions
 */
import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { makeRedis } from '../lib/redis'
import { logActivity } from '../services/audit'
import { autoAssign, removeEvent, retryReservation } from '../services/appointments'
import { markCallProcessingFailed, processEndOfCall } from '../services/callProcessing'
import { listOwnEvents, getConnectionRow } from '../services/google'
import { hasContactDetails } from '../services/leads'
import { purgeExpiredSessions } from '../services/auth'
import { getSettingsRow } from '../services/settings'
import { refreshCallFromVapi } from '../services/vapiApi'
import { QUEUE_NAME, enqueue, getQueue } from './queues'

const MIN = 60_000
const DAY = 86_400_000

async function handle(job: Job) {
  switch (job.name) {
    case 'reserve-retry': {
      const r = await retryReservation(String(job.data.appointmentId), job.data.target === 'auto_assigned' ? 'auto_assigned' : 'confirmed')
      return r
    }
    case 'auto-assign': {
      const lead = await prisma.lead.findUnique({ where: { id: String(job.data.leadId) } })
      if (!lead || lead.status !== 'new' || !hasContactDetails(lead)) return 'skipped'
      const a = await autoAssign(lead.id, 'System', job.data.callId ? String(job.data.callId) : null)
      return a.status
    }
    case 'process-webhook': {
      const ev = await prisma.webhookEvent.findUnique({ where: { id: String(job.data.eventId) } })
      if (!ev || ev.status === 'processed') return 'skipped'
      try {
        await processEndOfCall(ev.payload)
        await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 }, error: null } })
        return 'processed'
      } catch (e) {
        const message = (e as Error).message.slice(0, 300)
        await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: 'failed', attempts: { increment: 1 }, error: message } })
        if (ev.vapiCallId) await markCallProcessingFailed(ev.vapiCallId, message)
        throw e // BullMQ retries with backoff
      }
    }
    case 'sweep':
      return sweep()
    case 'reconcile':
      return reconcile()
    case 'retention':
      return retention()
    default:
      logger.warn({ job: job.name }, 'unknown job')
  }
}

async function sweep() {
  const now = Date.now()
  let queued = 0

  const events = await prisma.webhookEvent.findMany({ where: { status: { in: ['received', 'failed'] }, attempts: { lt: 10 }, receivedAt: { lt: new Date(now - 2 * MIN) } }, take: 50 })
  for (const e of events) if (await enqueue('process-webhook', { eventId: e.id }, { jobId: `evt-${e.id}-${Math.floor(now / (10 * MIN))}` })) queued++

  const held = await prisma.appointment.findMany({ where: { status: 'pending', confirmationStatus: { in: ['pending', 'failed'] }, scheduledStartAt: { not: null }, updatedAt: { lt: new Date(now - 3 * MIN) } }, take: 50 })
  for (const a of held) if (await enqueue('reserve-retry', { appointmentId: a.id, target: a.assignmentSource === 'automatic' ? 'auto_assigned' : 'confirmed' }, { jobId: `reserve-${a.id}-sweep-${Math.floor(now / (10 * MIN))}` })) queued++

  const cancelled = await prisma.appointment.findMany({ where: { status: 'cancelled', googleEventId: { not: null } }, take: 50 })
  for (const a of cancelled) await removeEvent(a, 'System')

  if (env.AUTO_ASSIGN_UNBOOKED) {
    const leads = await prisma.lead.findMany({
      where: { status: 'new', source: 'phone', createdAt: { lt: new Date(now - 3 * MIN) }, appointments: { none: {} }, calls: { some: { processingStatus: 'processed', callStatus: 'completed' } } },
      take: 25,
    })
    for (const l of leads) if (hasContactDetails(l) && (await enqueue('auto-assign', { leadId: l.id }, { jobId: `auto-${l.id}`, attempts: 8 }))) queued++
  }

  // Recordings usually appear within minutes. Ask Vapi once they are overdue, then stop waiting.
  const waiting = await prisma.call.findMany({ where: { recordingStatus: 'processing', endedAt: { lt: new Date(now - 10 * MIN) } }, take: 20 })
  for (const c of waiting) {
    const ageHours = (now - c.endedAt.getTime()) / 3_600_000
    try {
      const u = await refreshCallFromVapi(c.id)
      if (u.recordingStatus === 'processing' && ageHours > 6) await prisma.call.update({ where: { id: c.id }, data: { recordingStatus: 'unavailable' } })
    } catch {
      if (ageHours > 6) await prisma.call.update({ where: { id: c.id }, data: { recordingStatus: 'unavailable' } })
    }
  }
  return { queued }
}

/** Appointments are the source of truth for scheduling; the Google event must agree with them. */
async function reconcile() {
  const conn = await getConnectionRow()
  if (!conn || conn.health !== 'healthy' || !conn.calendarId) return 'skipped'
  const s = await getSettingsRow()
  const from = new Date(Date.now() - DAY)
  const to = new Date(Date.now() + (s.maximumSchedulingDays + 2) * DAY)
  const events = await listOwnEvents(conn.calendarId, from, to)

  const appts = await prisma.appointment.findMany({ where: { status: { in: ['confirmed', 'auto_assigned'] }, scheduledStartAt: { gte: from, lt: to }, googleEventId: { not: null } } })
  let flagged = 0
  let synced = 0
  for (const a of appts) {
    const ev = events.get(a.id)
    if (!ev || ev.cancelled) {
      await prisma.appointment.update({ where: { id: a.id }, data: { status: 'rescheduling_required', confirmationStatus: 'failed' } })
      await logActivity({ leadId: a.leadId, callId: a.callId, appointmentId: a.id, action: 'appointment.event_missing', details: 'The Google Calendar event was deleted. Reschedule or cancel this appointment.', actor: 'System' })
      flagged++
    } else if (ev.start && ev.end && (ev.start.getTime() !== a.scheduledStartAt!.getTime() || ev.end.getTime() !== a.scheduledEndAt!.getTime())) {
      try {
        await prisma.appointment.update({ where: { id: a.id }, data: { scheduledStartAt: ev.start, scheduledEndAt: ev.end } })
        await logActivity({ leadId: a.leadId, callId: a.callId, appointmentId: a.id, action: 'appointment.synced_from_google', details: 'The event was moved in Google Calendar; the appointment time was updated to match.', actor: 'System' })
        synced++
      } catch (e) {
        logger.warn({ appointmentId: a.id, err: (e as Error).message }, 'could not apply a time change made in Google (overlap?)')
      }
    }
  }
  await prisma.calendarConnection.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } })
  return { checked: appts.length, flagged, synced }
}

async function retention() {
  const s = await getSettingsRow()
  const cutoff = new Date(Date.now() - s.recordingRetentionDays * DAY)
  // Recordings are not stored here; drop our link to them (and the stored transcript) when the retention period ends.
  const calls = await prisma.call.updateMany({ where: { endedAt: { lt: cutoff }, OR: [{ recordingUrl: { not: null } }, { recordingStatus: 'available' }] }, data: { recordingUrl: null, recordingStatus: 'unavailable' } })
  // Raw webhook payloads contain full transcripts: keep them only long enough to retry or reprocess.
  const events = await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 30 * DAY) }, status: 'processed' } })
  const sessions = await purgeExpiredSessions()
  const activity = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 400 * DAY) } } })
  return { recordings: calls.count, events: events.count, sessions: sessions.count, activity: activity.count }
}

async function main() {
  const worker = new Worker(QUEUE_NAME, handle, { connection: makeRedis(), concurrency: 4 })
  worker.on('completed', (job, result) => logger.info({ job: job.name, id: job.id, result: typeof result === 'string' ? result : undefined }, 'job done'))
  worker.on('failed', (job, err) => logger.warn({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed'))
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'))

  const q = getQueue()
  await q.upsertJobScheduler('sweep', { every: 5 * MIN }, { name: 'sweep', opts: { removeOnComplete: true, removeOnFail: 20, attempts: 1 } })
  await q.upsertJobScheduler('reconcile', { every: 30 * MIN }, { name: 'reconcile', opts: { removeOnComplete: true, removeOnFail: 20, attempts: 1 } })
  await q.upsertJobScheduler('retention', { every: DAY }, { name: 'retention', opts: { removeOnComplete: true, removeOnFail: 20, attempts: 1 } })
  logger.info('Buslead worker started')

  const stop = async () => {
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGTERM', () => void stop())
  process.on('SIGINT', () => void stop())
}

main().catch((e) => {
  logger.error({ err: (e as Error).message }, 'worker failed to start')
  process.exit(1)
})
