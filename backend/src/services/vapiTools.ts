/**
 * Server-side tools the phone assistant calls mid-conversation (Vapi "tool-calls" messages).
 * Rules every handler follows:
 *  - the result is ONE flat string (JSON.stringify for structure), as Vapi requires;
 *  - never throw to the caller: failures become a result string telling the assistant what to say;
 *  - lead details are saved even when scheduling is unavailable, so a caller is never lost;
 *  - no secrets and no internal IDs are returned.
 */
import type { Prisma } from '@prisma/client'
import { AppError } from '../lib/errors'
import { logger } from '../lib/logger'
import { normalizePhone } from '../lib/phone'
import { prisma } from '../lib/prisma'
import { formatSpoken, formatTimeOnly, zonedToUtc } from '../lib/tz'
import { logActivity } from './audit'
import { ACTIVE, alternativesAround, getAvailability, loadBusy } from './availability'
import { moveAppointment, reserveAppointment } from './appointments'
import { findOrCreateLead } from './leads'
import { closedReason, horizonWindow, openSlots } from './scheduler'
import type { SchedulerSettings, Slot } from './scheduler'
import { getSchedulerSettings } from './settings'
import { bookAppointmentArgs, callIdOf, checkAvailabilityArgs, customerNumberOf, getMessage, parseToolCalls } from './vapiParse'
import type { ToolCall } from './vapiParse'

const out = (o: Record<string, unknown>) => JSON.stringify(o)
const spoken = (s: Slot, tz: string) => ({ time: formatTimeOnly(s.start, tz), full: formatSpoken(s.start, tz) })

const SCHEDULING_DOWN = out({
  status: 'scheduling_unavailable',
  message: 'The calendar is temporarily unavailable. Collect the caller details, tell them the team will call back to schedule, and still call book_appointment so their details are saved.',
})

export async function handleToolCalls(body: unknown): Promise<{ results: Array<{ name: string; toolCallId: string; result: string }> }> {
  const calls = parseToolCalls(body)
  const vapiCallId = callIdOf(body)
  const customerNumber = customerNumberOf(body)
  const m = getMessage(body)
  const callInfo = m && typeof m.call === 'object' && m.call ? (m.call as Record<string, unknown>) : {}

  const results = []
  for (const c of calls) {
    let result: string
    try {
      result = await runTool(c, { vapiCallId, customerNumber, callInfo })
    } catch (e) {
      logger.error({ tool: c.name, err: (e as Error).message }, 'tool handler crashed')
      result = out({ status: 'error', message: 'Something went wrong. Apologize, collect the details, and tell the caller the team will follow up.' })
    }
    results.push({ name: c.name, toolCallId: c.id, result })
  }
  return { results }
}

interface Ctx {
  vapiCallId: string | null
  customerNumber?: string
  callInfo: Record<string, unknown>
}

async function runTool(c: ToolCall, ctx: Ctx): Promise<string> {
  switch (c.name) {
    case 'check_availability':
      return checkAvailability(c.args)
    case 'book_appointment':
      return bookAppointment(c.args, ctx)
    default:
      return out({ status: 'error', message: `Unknown tool ${c.name.slice(0, 40)}.` })
  }
}

async function checkAvailability(rawArgs: unknown): Promise<string> {
  const parsed = checkAvailabilityArgs.safeParse(rawArgs)
  if (!parsed.success) return out({ status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid arguments. Use date as YYYY-MM-DD and time as HH:mm.' })
  const { date, time } = parsed.data
  const s = await getSchedulerSettings()

  const closed = closedReason(date, s)
  try {
    if (closed) {
      const next = (await upcoming(s, 3)).map((x) => x.full)
      return out({ status: 'closed', reason: closed === 'holiday' ? 'a holiday' : 'not a working day', nextAvailable: next, message: 'We are not open that day. Offer the next available times.' })
    }
    const requested = time ? zonedToUtc(date, time, s.timeZone) : undefined
    const day = await getAvailability(date, { requestedAt: requested })
    const open = day.slots.filter((x) => x.available).map((x) => formatTimeOnly(new Date(x.startAt), s.timeZone))
    const openTimes = open.slice(0, 8)

    if (requested) {
      const free = day.slots.some((x) => x.available && new Date(x.startAt).getTime() === requested.getTime())
      if (free) return out({ status: 'available', requested: formatSpoken(requested, s.timeZone), message: 'That time is open. Confirm it with the caller before booking.' })
      const near = [day.before, day.after].filter(Boolean).map((x) => formatSpoken(new Date(x!.startAt), s.timeZone))
      return out({ status: 'unavailable', requested: formatSpoken(requested, s.timeZone), nearestOpenTimes: near, openThatDay: openTimes, message: 'That time is not open. Offer the nearest times.' })
    }
    if (!open.length) {
      const next = (await upcoming(s, 3)).map((x) => x.full)
      return out({ status: 'full', nextAvailable: next, message: 'No openings that day. Offer the next available times.' })
    }
    return out({ status: 'available', openTimes, message: 'Offer a few of these times. Use time as HH:mm when booking.' })
  } catch (e) {
    if (e instanceof AppError && e.code.startsWith('CALENDAR')) return SCHEDULING_DOWN
    throw e
  }
}

async function upcoming(s: SchedulerSettings, n: number) {
  const now = new Date()
  const w = horizonWindow(s, now)
  const busy = await loadBusy(s, w.from, w.to)
  return openSlots(s, busy, now).slice(0, n).map((x) => spoken(x, s.timeZone))
}

async function bookAppointment(rawArgs: unknown, ctx: Ctx): Promise<string> {
  const parsed = bookAppointmentArgs.safeParse(rawArgs)
  if (!parsed.success) {
    return out({ status: 'invalid', message: `${parsed.error.issues[0]?.message ?? 'Some details are missing.'} Ask the caller to correct this, then call book_appointment again.` })
  }
  if (!ctx.vapiCallId) return out({ status: 'error', message: 'Missing call context. Tell the caller the team will follow up.' })
  const a = parsed.data
  const phone = normalizePhone(a.phoneNumber ?? '') ?? normalizePhone(ctx.customerNumber ?? '')
  if (!phone) return out({ status: 'invalid', message: 'A valid callback phone number is required. Ask the caller for a number with area code.' })

  const s = await getSchedulerSettings()
  const start = zonedToUtc(a.date, a.time, s.timeZone)

  // Save the lead and call first: the caller's details must survive any scheduling failure.
  const { lead, call } = await prisma.$transaction(async (tx) => {
    const { lead, created } = await findOrCreateLead({ fullName: a.fullName, email: a.email, phoneNumber: phone, reasonForCall: a.reasonForCall, notes: a.notes }, { timeZone: s.timeZone, db: tx })
    const startedAt = new Date(typeof ctx.callInfo.createdAt === 'string' ? ctx.callInfo.createdAt : Date.now())
    const intake: Prisma.InputJsonValue = { fullName: a.fullName, email: a.email, phoneNumber: phone, reasonForCall: a.reasonForCall, notes: a.notes ?? '', preferredDate: a.date, preferredTime: a.time }
    const call = await tx.call.upsert({
      where: { vapiCallId: ctx.vapiCallId! },
      update: { intake, customerNumber: ctx.customerNumber },
      create: { vapiCallId: ctx.vapiCallId!, leadId: lead.id, startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt, endedAt: new Date(), callStatus: 'completed', processingStatus: 'received', recordingStatus: 'processing', intake, customerNumber: ctx.customerNumber },
    })
    if (created) await logActivity({ leadId: lead.id, callId: call.id, action: 'lead.created', details: 'Created from a phone call', actor: 'Vapi' }, tx)
    return { lead, call }
  })

  try {
    const existing = await prisma.appointment.findFirst({ where: { callId: call.id, status: { in: ACTIVE } }, orderBy: { createdAt: 'desc' } })
    let appt
    if (existing?.scheduledStartAt?.getTime() === start.getTime()) appt = existing // repeated tool call: idempotent
    else if (existing) appt = await moveAppointment(existing.id, start, 'Vapi') // caller changed their mind during the call
    else appt = await reserveAppointment({ leadId: lead.id, callId: call.id, start, source: 'caller', actor: 'Vapi' })

    const when = formatSpoken(appt.scheduledStartAt!, s.timeZone)
    if (appt.confirmationStatus === 'reserved') return out({ status: 'booked', when, message: `Booked for ${when}. Confirm this with the caller and ask if there is anything else.` })
    return out({ status: 'held', when, message: `The time ${when} is being confirmed on the calendar. Tell the caller it is reserved and the team will confirm shortly.` })
  } catch (e) {
    if (e instanceof AppError && e.code === 'SLOT_TAKEN') {
      let near: string[] = []
      try {
        const alt = await alternativesAround(start)
        near = [alt.before, alt.after].filter(Boolean).map((x) => formatSpoken(x!.start, s.timeZone))
      } catch {
        /* alternatives are a nicety */
      }
      return out({ status: 'unavailable', nearestOpenTimes: near, message: 'That time is no longer open. Offer the nearest times, then call book_appointment again with the chosen one.' })
    }
    if (e instanceof AppError && e.code.startsWith('CALENDAR')) {
      return out({ status: 'saved_without_time', message: 'The details are saved but the calendar is unavailable. Tell the caller the team will call back to schedule.' })
    }
    logger.error({ err: (e as Error).message }, 'book_appointment failed after saving the lead')
    return out({ status: 'saved_without_time', message: 'The details are saved. Tell the caller the team will follow up to schedule.' })
  }
}
