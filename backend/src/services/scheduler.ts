/**
 * Pure slot engine. No database, no network: everything it needs is passed in, so it is easy to test.
 * Rules: business hours, appointment duration, buffer on both sides of every busy block, minimum notice,
 * scheduling horizon, working days and holidays. All wall-clock logic happens in the business time zone.
 */
import { addDaysStr, dateStrInZone, isDateStr, weekdayOf, zonedToUtc } from '../lib/tz'

export interface SchedulerSettings {
  timeZone: string
  workingDays: number[] // 0 = Sunday
  openingTime: string // HH:mm
  closingTime: string // HH:mm
  appointmentDurationMinutes: number
  bufferMinutes: number
  minimumNoticeMinutes: number
  maximumSchedulingDays: number
  holidays: Array<{ date: string; label: string }>
}

export interface BusyBlock {
  start: Date
  end: Date
}

export type SlotReason = 'past' | 'notice' | 'horizon' | 'busy'

export interface Slot {
  start: Date
  end: Date
  available: boolean
  reason?: SlotReason
}

export type ClosedReason = 'not_working_day' | 'holiday'

const MIN = 60_000
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * MIN)

export function closedReason(dateStr: string, s: SchedulerSettings): ClosedReason | null {
  if (!s.workingDays.includes(weekdayOf(dateStr))) return 'not_working_day'
  if (s.holidays.some((h) => h.date === dateStr)) return 'holiday'
  return null
}

const overlaps = (aStart: Date, aEnd: Date, b: BusyBlock) => b.start < aEnd && b.end > aStart

export function daySlots(dateStr: string, s: SchedulerSettings, busy: BusyBlock[], now: Date): Slot[] {
  if (!isDateStr(dateStr) || closedReason(dateStr, s)) return []
  const open = zonedToUtc(dateStr, s.openingTime, s.timeZone)
  const close = zonedToUtc(dateStr, s.closingTime, s.timeZone)
  const step = s.appointmentDurationMinutes + s.bufferMinutes
  const earliest = addMin(now, s.minimumNoticeMinutes)
  const lastDate = addDaysStr(dateStrInZone(now, s.timeZone), s.maximumSchedulingDays)
  const slots: Slot[] = []

  for (let t = open; addMin(t, s.appointmentDurationMinutes) <= close; t = addMin(t, step)) {
    const end = addMin(t, s.appointmentDurationMinutes)
    let reason: SlotReason | undefined
    if (t < now) reason = 'past'
    else if (t < earliest) reason = 'notice'
    else if (dateStr > lastDate) reason = 'horizon'
    if (!reason) {
      const from = addMin(t, -s.bufferMinutes)
      const to = addMin(end, s.bufferMinutes)
      if (busy.some((b) => overlaps(from, to, b))) reason = 'busy'
    }
    slots.push({ start: t, end, available: !reason, reason })
  }
  return slots
}

export function isSlotAvailable(start: Date, s: SchedulerSettings, busy: BusyBlock[], now: Date): boolean {
  const dateStr = dateStrInZone(start, s.timeZone)
  return daySlots(dateStr, s, busy, now).some((x) => x.available && x.start.getTime() === start.getTime())
}

/** Every open slot from today to the end of the scheduling horizon, in order. */
export function openSlots(s: SchedulerSettings, busy: BusyBlock[], now: Date): Slot[] {
  const today = dateStrInZone(now, s.timeZone)
  const out: Slot[] = []
  for (let i = 0; i <= s.maximumSchedulingDays; i++) {
    for (const slot of daySlots(addDaysStr(today, i), s, busy, now)) if (slot.available) out.push(slot)
  }
  return out
}

export const earliestSlot = (s: SchedulerSettings, busy: BusyBlock[], now: Date) => openSlots(s, busy, now)[0] ?? null

/** Closest open slot before and after a requested time. */
export function nearestAlternatives(requested: Date, s: SchedulerSettings, busy: BusyBlock[], now: Date) {
  let before: Slot | null = null
  let after: Slot | null = null
  for (const slot of openSlots(s, busy, now)) {
    if (slot.start < requested) before = slot
    else if (slot.start > requested && !after) after = slot
  }
  return { before, after }
}

/** Window of time the busy sources must cover for the whole horizon (UTC instants). */
export function horizonWindow(s: SchedulerSettings, now: Date): { from: Date; to: Date } {
  const today = dateStrInZone(now, s.timeZone)
  return {
    from: zonedToUtc(addDaysStr(today, -1), '00:00', s.timeZone),
    to: zonedToUtc(addDaysStr(today, s.maximumSchedulingDays + 2), '00:00', s.timeZone),
  }
}
