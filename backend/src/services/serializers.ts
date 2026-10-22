/** Maps database rows to the JSON shapes the dashboard expects (frontend/src/lib/types.ts). */
import type { Appointment, Call, Lead, Note, ActivityLog } from '@prisma/client'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export const toNote = (n: Note) => ({ id: n.id, authorName: n.authorName, body: n.body, createdAt: n.createdAt.toISOString() })

export const toLead = (l: Lead & { internalNotes?: Note[] }) => ({
  id: l.id,
  fullName: l.fullName,
  email: l.email,
  phoneNumber: l.phoneNumber,
  reasonForCall: l.reasonForCall,
  notes: l.notes,
  status: l.status,
  priority: l.priority,
  source: l.source,
  timeZone: l.timeZone,
  internalNotes: (l.internalNotes ?? []).map(toNote),
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
})

/** `recordingUrl` is deliberately absent: recordings are only reachable through the authorized proxy. */
export const toCall = (c: Call) => ({
  id: c.id,
  leadId: c.leadId,
  vapiCallId: c.vapiCallId,
  startedAt: c.startedAt.toISOString(),
  endedAt: c.endedAt.toISOString(),
  durationSeconds: c.durationSeconds,
  callStatus: c.callStatus,
  processingStatus: c.processingStatus,
  transcript: (c.transcript as unknown) ?? null,
  recordingStatus: c.recordingStatus,
  callerDisconnected: c.callerDisconnected,
  extractedData: normalizeExtracted(c.extracted),
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
})

export function normalizeExtracted(raw: unknown) {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const n = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : null)
  return {
    fullName: s('fullName'),
    email: s('email'),
    phoneNumber: s('phoneNumber'),
    reasonForCall: s('reasonForCall'),
    preferredDate: n('preferredDate'),
    preferredTime: n('preferredTime'),
    timeZone: s('timeZone'),
    appointmentStatus: s('appointmentStatus'),
  }
}

export const toAppointment = (a: Appointment) => ({
  id: a.id,
  leadId: a.leadId,
  callId: a.callId,
  googleCalendarEventId: a.googleEventId,
  requestedStartAt: iso(a.requestedStartAt),
  scheduledStartAt: iso(a.scheduledStartAt),
  scheduledEndAt: iso(a.scheduledEndAt),
  timeZone: a.timeZone,
  status: a.status,
  assignmentSource: a.assignmentSource,
  confirmationStatus: a.confirmationStatus,
  rescheduleCount: a.rescheduleCount,
  cancelReason: a.cancelReason,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
})

export const toActivity = (a: ActivityLog) => ({
  id: a.id,
  leadId: a.leadId,
  callId: a.callId,
  appointmentId: a.appointmentId,
  action: a.action,
  details: a.details,
  actor: a.actor,
  createdAt: a.createdAt.toISOString(),
})
