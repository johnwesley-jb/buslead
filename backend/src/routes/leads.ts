import { Router } from 'express'
import type { Appointment, Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError, notFound } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { prisma } from '../lib/prisma'
import { me, requireAuth, requireRole } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { logActivity } from '../services/audit'
import { ACTIVE } from '../services/availability'
import { removeEvent } from '../services/appointments'
import { canTransition } from '../services/leads'
import { toActivity, toAppointment, toCall, toLead } from '../services/serializers'
import { getSettingsRow } from '../services/settings'

export const leads = Router()
leads.use(requireAuth)

const OPEN = ['new', 'contacted', 'follow_up_scheduled', 'in_progress'] as const
const STATUSES = ['new', 'contacted', 'follow_up_scheduled', 'in_progress', 'qualified', 'converted', 'unqualified', 'closed'] as const
const APPT_STATUSES = ['pending', 'confirmed', 'auto_assigned', 'rescheduling_required', 'cancelled', 'completed', 'failed'] as const

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).default(''),
  status: z.enum([...STATUSES, '']).default(''),
  appointmentStatus: z.enum([...APPT_STATUSES, 'none', 'unassigned', '']).default(''),
  sort: z.enum(['createdAt', 'name', 'followUp']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})

/** The appointment shown for a lead: an active one if present, otherwise the most recent. */
const currentAppointment = (list: Appointment[]) => {
  if (!list.length) return null
  const active = list.filter((a) => ACTIVE.includes(a.status))
  const pool = active.length ? active : list
  return [...pool].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

leads.get(
  '/',
  wrap(async (req, res) => {
    const p = parse(listQuery, req.query)
    const and: Prisma.LeadWhereInput[] = []
    if (p.q) {
      const digits = p.q.replace(/\D/g, '')
      and.push({
        OR: [
          { fullName: { contains: p.q, mode: 'insensitive' } },
          { email: { contains: p.q, mode: 'insensitive' } },
          { reasonForCall: { contains: p.q, mode: 'insensitive' } },
          { phoneNumber: { contains: p.q } },
          ...(digits.length >= 3 ? [{ phoneNumber: { contains: digits } }] : []),
        ],
      })
    }
    if (p.status) and.push({ status: p.status })
    if (p.appointmentStatus === 'unassigned') and.push({ status: { in: [...OPEN] }, appointments: { none: { status: { in: ACTIVE } } } })
    else if (p.appointmentStatus === 'none') and.push({ appointments: { none: {} } })
    else if (p.appointmentStatus) and.push({ appointments: { some: { status: p.appointmentStatus } } })
    const where: Prisma.LeadWhereInput = and.length ? { AND: and } : {}

    const include = { appointments: true, calls: { orderBy: { startedAt: 'desc' as const }, take: 1 }, internalNotes: { orderBy: { createdAt: 'desc' as const } } }
    const total = await prisma.lead.count({ where })

    let rows
    if (p.sort === 'followUp') {
      // Ordering by a related table's value is done in memory (bounded by the filter) and only the page is hydrated.
      const all = await prisma.lead.findMany({ where, select: { id: true, appointments: { where: { status: { in: ACTIVE } }, select: { scheduledStartAt: true } } }, take: 5000 })
      const next = (l: (typeof all)[number]) => l.appointments.map((a) => a.scheduledStartAt?.getTime() ?? Infinity).sort()[0] ?? Infinity
      const sign = p.dir === 'desc' ? -1 : 1
      all.sort((a, b) => (next(a) === next(b) ? 0 : next(a) === Infinity ? 1 : next(b) === Infinity ? -1 : (next(a) - next(b)) * sign))
      const ids = all.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map((l) => l.id)
      const found = await prisma.lead.findMany({ where: { id: { in: ids } }, include })
      rows = ids.map((id) => found.find((l) => l.id === id)!).filter(Boolean)
    } else {
      rows = await prisma.lead.findMany({
        where,
        include,
        orderBy: p.sort === 'name' ? { fullName: p.dir } : { createdAt: p.dir },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
      })
    }

    res.json({
      items: rows.map((l) => {
        const c = l.calls[0]
        const appt = currentAppointment(l.appointments)
        return {
          ...toLead(l),
          internalNotes: [],
          latestCall: c ? { id: c.id, durationSeconds: c.durationSeconds, startedAt: c.startedAt.toISOString(), recordingStatus: c.recordingStatus } : null,
          appointment: appt ? toAppointment(appt) : null,
        }
      }),
      total,
      page: p.page,
      pageSize: p.pageSize,
    })
  }),
)

const leadFields = {
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  phoneNumber: z.string().trim().max(32).transform((v, ctx) => {
    const n = normalizePhone(v)
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, like +1 555 123 4567' })
    return n ?? ''
  }),
  reasonForCall: z.string().trim().min(2, 'Add a reason for the call').max(1000),
  notes: z.string().trim().max(2000).default(''),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
}

leads.post(
  '/',
  wrap(async (req, res) => {
    const b = parse(z.object(leadFields), req.body)
    const settings = await getSettingsRow()
    const lead = await prisma.lead.create({ data: { ...b, source: 'manual', timeZone: settings.timeZone } })
    await logActivity({ leadId: lead.id, action: 'lead.created', details: 'Added manually', actor: me(req).name })
    res.status(201).json(toLead(lead))
  }),
)

leads.get(
  '/:id',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const lead = await prisma.lead.findUnique({ where: { id }, include: { internalNotes: { orderBy: { createdAt: 'desc' } } } })
    if (!lead) throw notFound('This lead no longer exists. It may have been deleted.')
    const [calls, appointments, activity] = await Promise.all([
      prisma.call.findMany({ where: { leadId: id }, orderBy: { startedAt: 'desc' } }),
      prisma.appointment.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.activityLog.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ])
    res.json({ lead: toLead(lead), calls: calls.map(toCall), appointments: appointments.map(toAppointment), activity: activity.map(toActivity) })
  }),
)

leads.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const b = parse(z.object({ ...leadFields, status: z.enum(STATUSES) }).partial(), req.body)
    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead) throw notFound('This lead no longer exists.')
    if (b.status && !canTransition(lead.status, b.status)) throw new AppError(409, 'INVALID_TRANSITION', `A ${lead.status.replace(/_/g, ' ')} lead cannot move straight to ${b.status.replace(/_/g, ' ')}.`)

    const changes: string[] = []
    if (b.status && b.status !== lead.status) changes.push(`status ${lead.status} -> ${b.status}`)
    if (b.priority && b.priority !== lead.priority) changes.push(`priority ${lead.priority} -> ${b.priority}`)
    for (const [k, label] of [['fullName', 'name'], ['email', 'email'], ['phoneNumber', 'phone'], ['reasonForCall', 'reason'], ['notes', 'notes']] as const) {
      if (b[k] !== undefined && b[k] !== lead[k]) changes.push(`${label} updated`)
    }
    const updated = await prisma.lead.update({ where: { id }, data: b })
    if (changes.length) await logActivity({ leadId: id, action: 'lead.updated', details: changes.join('; '), actor: me(req).name })
    res.json(toLead(updated))
  }),
)

leads.delete(
  '/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const lead = await prisma.lead.findUnique({ where: { id }, include: { appointments: true } })
    if (!lead) throw notFound('This lead no longer exists.')
    for (const a of lead.appointments) if (a.googleEventId) await removeEvent(a, me(req).name) // best effort; keeps the calendar clean
    await prisma.$transaction([
      prisma.activityLog.deleteMany({ where: { leadId: id } }), // personal data goes with the lead
      prisma.lead.delete({ where: { id } }), // notes, calls and appointments cascade
    ])
    await logActivity({ action: 'lead.deleted', details: 'Deleted a lead and its related records', actor: me(req).name })
    res.json({ ok: true })
  }),
)

leads.post(
  '/:id/notes',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const { body } = parse(z.object({ body: z.string().trim().min(1, 'Write a note first').max(2000) }), req.body)
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
    if (!lead) throw notFound('This lead no longer exists.')
    await prisma.note.create({ data: { leadId: id, authorName: me(req).name, body } })
    await logActivity({ leadId: id, action: 'lead.note_added', details: 'Added an internal note', actor: me(req).name })
    const full = await prisma.lead.findUniqueOrThrow({ where: { id }, include: { internalNotes: { orderBy: { createdAt: 'desc' } } } })
    res.status(201).json(toLead(full))
  }),
)
