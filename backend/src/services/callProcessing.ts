/**
 * Turns a Vapi end-of-call-report into a lead + call record. Safe to run more than once for the same call
 * (upsert on vapiCallId, lead de-duplication, no duplicate appointments) and safe when events arrive out of order
 * (a call created earlier by a tool call is completed here rather than replaced).
 */
import type { Prisma } from '@prisma/client'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { enqueue } from '../jobs/queues'
import { logActivity } from './audit'
import { ACTIVE } from './availability'
import { UNKNOWN_CALLER, findOrCreateLead, hasContactDetails } from './leads'
import { getSettingsRow } from './settings'
import { callOutcome, endedByCaller, leadBagFrom, mergeBags, parseEndOfCallReport } from './vapiParse'

const RECORDING_GRACE_MS = 15 * 60_000

export async function processEndOfCall(payload: unknown): Promise<{ callId: string; leadId: string }> {
  const report = parseEndOfCallReport(payload)
  if (!report) throw new Error('Unparseable end-of-call-report (missing call id)')
  const settings = await getSettingsRow()

  const existing = await prisma.call.findUnique({ where: { vapiCallId: report.callId }, include: { lead: true } })
  const bag = mergeBags(report.structured, leadBagFrom(existing?.intake), { phoneNumber: report.customerNumber })

  const now = new Date()
  const endedAt = report.endedAt ?? existing?.endedAt ?? now
  const durationSeconds = Math.max(0, Math.round(report.durationSeconds ?? (report.startedAt ? (endedAt.getTime() - report.startedAt.getTime()) / 1000 : existing?.durationSeconds ?? 0)))
  const startedAt = report.startedAt ?? existing?.startedAt ?? new Date(endedAt.getTime() - durationSeconds * 1000)
  const callStatus = callOutcome(report.endedReason)
  const recordingStatus = report.recordingUrl ? 'available' : callStatus === 'completed' && now.getTime() - endedAt.getTime() < RECORDING_GRACE_MS ? 'processing' : 'unavailable'

  const { call, lead, bookedAppointment, createdLead } = await prisma.$transaction(async (tx) => {
    let lead = existing?.lead
    let createdLead = false
    if (!lead) {
      const r = await findOrCreateLead(bag, { fallbackPhone: report.customerNumber, timeZone: settings.timeZone, db: tx })
      lead = r.lead
      createdLead = r.created
    } else {
      // Fill gaps only; never overwrite what a person typed.
      const patch: Prisma.LeadUpdateInput = {}
      if ((!lead.fullName || lead.fullName === UNKNOWN_CALLER) && bag.fullName) patch.fullName = bag.fullName
      if (!lead.email && bag.email) patch.email = bag.email
      if (!lead.reasonForCall && bag.reasonForCall) patch.reasonForCall = bag.reasonForCall
      if (Object.keys(patch).length) lead = await tx.lead.update({ where: { id: lead.id }, data: patch })
    }

    const active = await tx.appointment.findFirst({ where: { leadId: lead.id, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } })
    const callerDisconnected = endedByCaller(report.endedReason) && !active
    const extracted: Prisma.InputJsonValue = {
      fullName: bag.fullName ?? lead.fullName,
      email: bag.email ?? lead.email,
      phoneNumber: bag.phoneNumber ?? lead.phoneNumber,
      reasonForCall: bag.reasonForCall ?? lead.reasonForCall,
      preferredDate: bag.preferredDate ?? '',
      preferredTime: bag.preferredTime ?? '',
      timeZone: settings.timeZone,
      appointmentStatus: active ? 'booked' : 'not_booked',
    }
    const data = {
      leadId: lead.id,
      startedAt,
      endedAt,
      durationSeconds,
      callStatus,
      processingStatus: 'processed' as const,
      processingError: null,
      endedReason: report.endedReason?.slice(0, 120),
      customerNumber: report.customerNumber,
      transcript: (report.transcript ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      recordingUrl: report.recordingUrl,
      recordingStatus: recordingStatus as 'available' | 'processing' | 'unavailable',
      callerDisconnected,
      extracted,
    }
    const call = await tx.call.upsert({
      where: { vapiCallId: report.callId },
      update: { ...data, processingAttempts: { increment: 1 } },
      create: { vapiCallId: report.callId, ...data, processingAttempts: 1 },
    })
    // Link any appointment the assistant booked during this call, if it was created before the call row existed.
    if (active && !active.callId) await tx.appointment.update({ where: { id: active.id }, data: { callId: call.id } })
    await logActivity({ leadId: lead.id, callId: call.id, action: 'call.processed', details: `${callStatus} call, ${durationSeconds}s${createdLead ? '; new lead created' : ''}`, actor: 'Vapi' }, tx)
    return { call, lead, bookedAppointment: active, createdLead }
  })

  if (!bookedAppointment && env.AUTO_ASSIGN_UNBOOKED && callStatus === 'completed' && lead.status === 'new' && hasContactDetails(lead)) {
    await enqueue('auto-assign', { leadId: lead.id, callId: call.id }, { jobId: `auto-${lead.id}`, attempts: 8 })
  }
  logger.info({ callId: call.id, leadId: lead.id, createdLead, status: callStatus }, 'end-of-call processed')
  return { callId: call.id, leadId: lead.id }
}

/** Marks a call as failed when its processing keeps erroring, so the dashboard can show it. */
export async function markCallProcessingFailed(vapiCallId: string, message: string) {
  await prisma.call.updateMany({ where: { vapiCallId }, data: { processingStatus: 'failed', processingError: message.slice(0, 300) } })
}
