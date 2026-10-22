import { Router } from 'express'
import { z } from 'zod'
import { AppError, notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { me, requireAuth } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { heavyLimiter } from '../middleware/security'
import { ACTIVE, getAvailability } from '../services/availability'
import { autoAssign, cancelAppointment, completeAppointment, moveAppointment, reserveAppointment } from '../services/appointments'
import { toActivity, toAppointment, toCall, toLead } from '../services/serializers'

export const appointments = Router()
appointments.use(requireAuth)

const isoDate = z.string().datetime({ offset: true })
const STATUSES = ['pending', 'confirmed', 'auto_assigned', 'rescheduling_required', 'cancelled', 'completed', 'failed', ''] as const

appointments.get(
  '/availability',
  heavyLimiter,
  wrap(async (req, res) => {
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), excludeAppointmentId: z.string().uuid().optional(), requestedAt: isoDate.optional() }), req.query)
    res.json(await getAvailability(q.date, { excludeAppointmentId: q.excludeAppointmentId, requestedAt: q.requestedAt ? new Date(q.requestedAt) : undefined }))
  }),
)

appointments.get(
  '/',
  wrap(async (req, res) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), status: z.enum(STATUSES).default('') }), req.query)
    const windowed = Boolean(q.from || q.to)
    const rows = await prisma.appointment.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(windowed ? { scheduledStartAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      },
      include: { lead: { select: { fullName: true, email: true, phoneNumber: true } } },
      orderBy: { scheduledStartAt: 'asc' },
      take: 1000,
    })
    res.json(rows.map((a) => ({ ...toAppointment(a), leadName: a.lead.fullName, leadEmail: a.lead.email, leadPhone: a.lead.phoneNumber })))
  }),
)

appointments.post(
  '/',
  heavyLimiter,
  wrap(async (req, res) => {
    const b = parse(z.object({ leadId: z.string().uuid(), startAt: isoDate }), req.body)
    const active = await prisma.appointment.findFirst({ where: { leadId: b.leadId, status: { in: ACTIVE } } })
    if (active) throw new AppError(409, 'ALREADY_SCHEDULED', 'This lead already has an appointment. Reschedule it instead.')
    const a = await reserveAppointment({ leadId: b.leadId, start: new Date(b.startAt), source: 'manual', actor: me(req).name })
    res.status(201).json(toAppointment(a))
  }),
)

appointments.post(
  '/auto-assign',
  heavyLimiter,
  wrap(async (req, res) => {
    const b = parse(z.object({ leadId: z.string().uuid() }), req.body)
    if (!(await prisma.lead.findUnique({ where: { id: b.leadId }, select: { id: true } }))) throw notFound('This lead no longer exists.')
    res.status(201).json(toAppointment(await autoAssign(b.leadId, me(req).name)))
  }),
)

appointments.get(
  '/:id',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const a = await prisma.appointment.findUnique({ where: { id }, include: { lead: { include: { internalNotes: { orderBy: { createdAt: 'desc' } } } }, call: true } })
    if (!a) throw notFound('This appointment could not be found.')
    const activity = await prisma.activityLog.findMany({ where: { appointmentId: id }, orderBy: { createdAt: 'desc' }, take: 100 })
    res.json({ appointment: toAppointment(a), lead: toLead(a.lead), call: a.call ? toCall(a.call) : null, activity: activity.map(toActivity) })
  }),
)

appointments.post(
  '/:id/reschedule',
  heavyLimiter,
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const b = parse(z.object({ startAt: isoDate }), req.body)
    res.json(toAppointment(await moveAppointment(id, new Date(b.startAt), me(req).name)))
  }),
)

appointments.post(
  '/:id/cancel',
  heavyLimiter,
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const b = parse(z.object({ reason: z.string().trim().max(300).default('') }), req.body ?? {})
    const u = me(req)
    res.json(toAppointment(await cancelAppointment(id, b.reason, { name: u.name, role: u.role })))
  }),
)

appointments.post(
  '/:id/complete',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    res.json(toAppointment(await completeAppointment(id, me(req).name)))
  }),
)
