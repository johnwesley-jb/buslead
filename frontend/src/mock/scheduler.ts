/**
 * Pure slot engine shared by the mock API. It mirrors the rules the real scheduling
 * service will enforce: business hours, duration, buffer, minimum notice, horizon,
 * holidays and busy periods (internal appointments + external calendar events).
 */
import { addDays, addMinutes, startOfDay, toDateInput, withTime } from '@/lib/dates'
import type { BusinessSettings } from '@/lib/types'

export interface BusyBlock {
  start: Date
  end: Date
  kind: 'appointment' | 'external'
}

export interface Slot {
  start: Date
  end: Date
  available: boolean
  reason?: 'past' | 'notice' | 'horizon' | 'busy'
}

export type ClosedReason = 'not_working_day' | 'holiday'

export function closedReason(day: Date, s: BusinessSettings): ClosedReason | null {
  if (!s.workingDays.includes(day.getDay())) return 'not_working_day'
  if (s.holidays.some((h) => h.date === toDateInput(day))) return 'holiday'
  return null
}

const overlaps = (aStart: Date, aEnd: Date, b: BusyBlock) => b.start < aEnd && b.end > aStart

export function daySlots(
  day: Date,
  s: BusinessSettings,
  busy: BusyBlock[],
  now: Date,
  opts: { ignoreWindow?: boolean } = {},
): Slot[] {
  if (closedReason(day, s)) return []
  const open = withTime(day, s.openingTime)
  const close = withTime(day, s.closingTime)
  const step = s.appointmentDurationMinutes + s.bufferMinutes
  const earliest = addMinutes(now, s.minimumNoticeMinutes)
  const horizonEnd = startOfDay(addDays(now, s.maximumSchedulingDays + 1))
  const slots: Slot[] = []

  for (let t = open; addMinutes(t, s.appointmentDurationMinutes) <= close; t = addMinutes(t, step)) {
    const end = addMinutes(t, s.appointmentDurationMinutes)
    let reason: Slot['reason']
    if (!opts.ignoreWindow) {
      if (t < now) reason = 'past'
      else if (t < earliest) reason = 'notice'
      else if (t >= horizonEnd) reason = 'horizon'
    }
    if (!reason) {
      // Buffer applies on both sides of every busy block.
      const from = addMinutes(t, -s.bufferMinutes)
      const to = addMinutes(end, s.bufferMinutes)
      if (busy.some((b) => overlaps(from, to, b))) reason = 'busy'
    }
    slots.push({ start: t, end, available: !reason, reason })
  }
  return slots
}

export function isSlotAvailable(start: Date, s: BusinessSettings, busy: BusyBlock[], now: Date): boolean {
  return daySlots(startOfDay(start), s, busy, now).some((x) => x.available && x.start.getTime() === start.getTime())
}

/** Every open slot from today to the end of the scheduling horizon, in order. */
export function openSlots(s: BusinessSettings, busy: BusyBlock[], now: Date): Slot[] {
  const out: Slot[] = []
  for (let i = 0; i <= s.maximumSchedulingDays; i++) {
    for (const slot of daySlots(addDays(startOfDay(now), i), s, busy, now)) if (slot.available) out.push(slot)
  }
  return out
}

export function earliestSlot(s: BusinessSettings, busy: BusyBlock[], now: Date): Slot | null {
  return openSlots(s, busy, now)[0] ?? null
}

/** Closest open slot before and after a requested time. */
export function nearestAlternatives(requested: Date, s: BusinessSettings, busy: BusyBlock[], now: Date) {
  const all = openSlots(s, busy, now)
  let before: Slot | null = null
  let after: Slot | null = null
  for (const slot of all) {
    if (slot.start < requested) before = slot
    else if (slot.start > requested && !after) after = slot
  }
  return { before, after }
}
