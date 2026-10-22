import type { Lead, LeadSource, LeadStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { normalizePhone } from '../lib/phone'
import type { LeadBag } from './vapiParse'

/** Same state machine as the dashboard (frontend/src/lib/format.ts). */
export const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'follow_up_scheduled', 'unqualified', 'closed'],
  contacted: ['follow_up_scheduled', 'in_progress', 'qualified', 'unqualified', 'closed'],
  follow_up_scheduled: ['contacted', 'in_progress', 'qualified', 'unqualified', 'closed'],
  in_progress: ['follow_up_scheduled', 'qualified', 'converted', 'unqualified', 'closed'],
  qualified: ['in_progress', 'converted', 'unqualified', 'closed'],
  converted: ['closed'],
  unqualified: ['contacted', 'closed'],
  closed: ['contacted'],
}
export const canTransition = (from: LeadStatus, to: LeadStatus) => from === to || LEAD_TRANSITIONS[from].includes(to)

export const UNKNOWN_CALLER = 'Unknown caller'

/**
 * Finds the existing lead for a caller (same email or same phone number) or creates one.
 * Missing details on an existing lead are filled in; details a person already entered are never overwritten.
 */
export async function findOrCreateLead(bag: LeadBag, opts: { fallbackPhone?: string; timeZone: string; source?: LeadSource; db?: Prisma.TransactionClient | typeof prisma }): Promise<{ lead: Lead; created: boolean }> {
  const db = opts.db ?? prisma
  const phone = normalizePhone(bag.phoneNumber ?? '') ?? normalizePhone(opts.fallbackPhone ?? '') ?? ''
  const email = bag.email ?? ''
  const or = [...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []), ...(phone ? [{ phoneNumber: phone }] : [])]
  const existing = or.length ? await db.lead.findFirst({ where: { OR: or }, orderBy: { createdAt: 'desc' } }) : null

  if (existing) {
    const patch: Partial<Lead> = {}
    if ((!existing.fullName || existing.fullName === UNKNOWN_CALLER) && bag.fullName) patch.fullName = bag.fullName
    if (!existing.email && email) patch.email = email
    if (!existing.phoneNumber && phone) patch.phoneNumber = phone
    if (!existing.reasonForCall && bag.reasonForCall) patch.reasonForCall = bag.reasonForCall
    const lead = Object.keys(patch).length ? await db.lead.update({ where: { id: existing.id }, data: patch }) : existing
    return { lead, created: false }
  }

  const lead = await db.lead.create({
    data: {
      fullName: bag.fullName?.slice(0, 120) || UNKNOWN_CALLER,
      email: email.slice(0, 254),
      phoneNumber: phone,
      reasonForCall: (bag.reasonForCall ?? '').slice(0, 1000),
      notes: (bag.notes ?? '').slice(0, 2000),
      source: opts.source ?? 'phone',
      timeZone: opts.timeZone,
    },
  })
  return { lead, created: true }
}

/** Enough to follow up: a name that is not the placeholder, and an email or a phone number. */
export const hasContactDetails = (l: Pick<Lead, 'fullName' | 'email' | 'phoneNumber'>) => l.fullName !== UNKNOWN_CALLER && Boolean(l.email || l.phoneNumber)
