import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

export interface ActivityInput {
  leadId?: string | null
  callId?: string | null
  appointmentId?: string | null
  action: string
  details?: string
  actor?: string
}

/**
 * Append-only audit trail shown in the dashboard. Details must be short and must not contain
 * secrets, tokens, transcripts or full contact details.
 */
export function logActivity(a: ActivityInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.activityLog.create({
    data: {
      leadId: a.leadId ?? null,
      callId: a.callId ?? null,
      appointmentId: a.appointmentId ?? null,
      action: a.action,
      details: (a.details ?? '').slice(0, 500),
      actor: a.actor ?? 'System',
    },
  })
}
