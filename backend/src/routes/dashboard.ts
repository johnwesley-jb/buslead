import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { addDaysStr, dateStrInZone, zonedToUtc } from '../lib/tz'
import { requireAuth } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { ACTIVE } from '../services/availability'
import { toActivity } from '../services/serializers'
import { getSettingsRow } from '../services/settings'

export const dashboard = Router()
dashboard.use(requireAuth)

const OPEN = ['new', 'contacted', 'follow_up_scheduled', 'in_progress'] as const

dashboard.get(
  '/summary',
  wrap(async (_req, res) => {
    const now = new Date()
    const [totalLeads, newLeads, awaitingFollowUp, scheduledAppointments, completedFollowUps, unassignedFollowUps] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { status: 'new' } }),
      prisma.lead.count({ where: { status: { in: [...OPEN] } } }),
      prisma.appointment.count({ where: { status: { in: ['confirmed', 'auto_assigned'] }, scheduledStartAt: { gte: now } } }),
      prisma.appointment.count({ where: { status: 'completed' } }),
      prisma.lead.count({ where: { status: { in: [...OPEN] }, appointments: { none: { status: { in: ACTIVE } } } } }),
    ])
    res.json({ totalLeads, newLeads, awaitingFollowUp, scheduledAppointments, completedFollowUps, unassignedFollowUps })
  }),
)

dashboard.get(
  '/activity',
  wrap(async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }), req.query)
    const rows = await prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    const ids = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => Boolean(x)))]
    const names = new Map((await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((l) => [l.id, l.fullName]))
    res.json(rows.map((r) => ({ ...toActivity(r), leadName: r.leadId ? names.get(r.leadId) ?? null : null })))
  }),
)

dashboard.get(
  '/calls-by-day',
  wrap(async (req, res) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }), req.query)
    const s = await getSettingsRow()
    const today = dateStrInZone(new Date(), s.timeZone)
    const first = addDaysStr(today, -(days - 1))
    const since = zonedToUtc(first, '00:00', s.timeZone)
    const rows = await prisma.call.findMany({ where: { startedAt: { gte: since } }, select: { id: true, startedAt: true } })
    const booked = new Set((await prisma.appointment.findMany({ where: { callId: { in: rows.map((r) => r.id) }, status: { in: ['confirmed', 'auto_assigned', 'completed', 'pending'] } }, select: { callId: true } })).map((a) => a.callId))
    const out = Array.from({ length: days }, (_, i) => ({ date: addDaysStr(first, i), calls: 0, booked: 0 }))
    const index = new Map(out.map((d, i) => [d.date, i]))
    for (const r of rows) {
      const i = index.get(dateStrInZone(r.startedAt, s.timeZone))
      if (i === undefined) continue
      out[i].calls++
      if (booked.has(r.id)) out[i].booked++
    }
    res.json(out)
  }),
)

dashboard.get(
  '/attention',
  wrap(async (_req, res) => {
    const [appts, failed] = await Promise.all([
      prisma.appointment.findMany({ where: { status: { in: ['rescheduling_required', 'pending'] } }, include: { lead: { select: { id: true, fullName: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      prisma.call.findMany({ where: { processingStatus: 'failed' }, include: { lead: { select: { id: true, fullName: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
    ])
    type Item = { id: string; leadId: string; leadName: string; kind: 'unassigned' | 'processing_failed' | 'reschedule_required' | 'pending_reservation'; detail: string; at: string }
    const items: Item[] = appts.map((a) =>
      a.status === 'rescheduling_required'
        ? { id: a.id, leadId: a.lead.id, leadName: a.lead.fullName, kind: 'unassigned', detail: 'No slot could be reserved. Assign a time or let the system retry.', at: a.updatedAt.toISOString() }
        : { id: a.id, leadId: a.lead.id, leadName: a.lead.fullName, kind: 'pending_reservation', detail: 'Waiting for the Google Calendar reservation to finish.', at: a.updatedAt.toISOString() },
    )
    for (const c of failed) {
      if (!items.some((i) => i.leadId === c.lead.id)) items.push({ id: c.id, leadId: c.lead.id, leadName: c.lead.fullName, kind: 'processing_failed', detail: 'Call processing failed. The lead is saved.', at: c.updatedAt.toISOString() })
    }
    res.json(items.sort((a, b) => b.at.localeCompare(a.at)))
  }),
)
