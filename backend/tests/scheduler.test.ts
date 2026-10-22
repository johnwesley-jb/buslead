import test from 'node:test'
import assert from 'node:assert/strict'
import { closedReason, daySlots, earliestSlot, isSlotAvailable, nearestAlternatives, openSlots } from '../src/services/scheduler'
import type { SchedulerSettings } from '../src/services/scheduler'
import { addDaysStr, dateStrInZone, timeStrInZone, zonedToUtc } from '../src/lib/tz'

const base: SchedulerSettings = {
  timeZone: 'America/New_York',
  workingDays: [1, 2, 3, 4, 5],
  openingTime: '09:00',
  closingTime: '17:00',
  appointmentDurationMinutes: 30,
  bufferMinutes: 15,
  minimumNoticeMinutes: 120,
  maximumSchedulingDays: 30,
  holidays: [{ date: '2026-10-29', label: 'Closed' }],
}
// Monday 2026-10-26 08:00 in New York (EDT, UTC-4) = 12:00Z
const now = new Date('2026-10-26T12:00:00Z')
const ny = (date: string, time: string) => zonedToUtc(date, time, 'America/New_York')

test('zonedToUtc converts wall clock in the business zone', () => {
  assert.equal(ny('2026-10-26', '09:00').toISOString(), '2026-10-26T13:00:00.000Z') // EDT
  assert.equal(ny('2026-11-03', '09:00').toISOString(), '2026-11-03T14:00:00.000Z') // EST after DST ends on Nov 1
})

test('zonedToUtc and timeStrInZone round-trip across DST', () => {
  for (const [d, t] of [['2026-03-08', '09:00'], ['2026-03-09', '09:00'], ['2026-11-01', '09:00'], ['2026-11-02', '16:45']]) {
    const utc = zonedToUtc(d, t, 'America/New_York')
    assert.equal(dateStrInZone(utc, 'America/New_York'), d)
    assert.equal(timeStrInZone(utc, 'America/New_York'), t)
  }
})

test('works for zones east of UTC', () => {
  const utc = zonedToUtc('2026-10-26', '09:00', 'Asia/Tokyo')
  assert.equal(utc.toISOString(), '2026-10-26T00:00:00.000Z')
})

test('addDaysStr handles month and year edges', () => {
  assert.equal(addDaysStr('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysStr('2026-03-01', -1), '2026-02-28')
})

test('closed on weekends and holidays', () => {
  assert.equal(closedReason('2026-10-31', base), 'not_working_day') // Saturday
  assert.equal(closedReason('2026-10-29', base), 'holiday')
  assert.equal(closedReason('2026-10-27', base), null)
  assert.deepEqual(daySlots('2026-10-31', base, [], now), [])
})

test('slots step by duration + buffer and end before closing', () => {
  const slots = daySlots('2026-10-27', base, [], now)
  assert.equal(timeStrInZone(slots[0].start, base.timeZone), '09:00')
  assert.equal(timeStrInZone(slots[1].start, base.timeZone), '09:45')
  const last = slots[slots.length - 1]
  assert.ok(last.end <= ny('2026-10-27', '17:00'))
  assert.equal(slots.length, 11) // starts at 09:00 + n*45 min, last start 16:30 (must end by 17:00)
})

test('minimum notice and past slots are unavailable', () => {
  const slots = daySlots('2026-10-26', base, [], now) // today, now = 08:00, notice 2h -> earliest 10:00
  const byTime = (t: string) => slots.find((s) => timeStrInZone(s.start, base.timeZone) === t)!
  assert.equal(byTime('09:00').reason, 'notice')
  assert.equal(byTime('10:30').available, true) // 09:45 is < 10:00 -> notice, 10:30 ok
  assert.equal(byTime('09:45').reason, 'notice')
})

test('horizon limits how far ahead slots can be booked', () => {
  assert.equal(isSlotAvailable(ny('2026-11-25', '09:00'), base, [], now), true) // 30 days ahead
  assert.equal(isSlotAvailable(ny('2026-11-27', '09:00'), base, [], now), false) // 32 days ahead
})

test('busy blocks and buffers remove neighbouring slots', () => {
  const busy = [{ start: ny('2026-10-27', '10:20'), end: ny('2026-10-27', '10:50') }]
  const slots = daySlots('2026-10-27', base, busy, now)
  const avail = (t: string) => slots.find((s) => timeStrInZone(s.start, base.timeZone) === t)?.available
  assert.equal(avail('09:45'), false) // ends 10:15, its 15 minute buffer reaches 10:30 which overlaps the block
  assert.equal(avail('10:30'), false) // overlaps the block itself
  assert.equal(avail('11:15'), true) // grid: 09:00, 09:45, 10:30, 11:15; buffer starts at 11:00, after the block
  assert.equal(avail('09:00'), true)
})

test('exact boundaries: a block that only touches the buffer edge does not collide', () => {
  const busy = [{ start: ny('2026-10-27', '09:45'), end: ny('2026-10-27', '10:15') }]
  const slots = daySlots('2026-10-27', base, busy, now)
  const nine = slots.find((s) => timeStrInZone(s.start, base.timeZone) === '09:00')!
  // 09:00-09:30 with a 15 minute buffer reaches 09:45, which equals the busy start: allowed.
  assert.equal(nine.available, true)
})

test('earliestSlot skips unavailable times', () => {
  const s = earliestSlot(base, [], now)!
  assert.equal(dateStrInZone(s.start, base.timeZone), '2026-10-26')
  assert.equal(timeStrInZone(s.start, base.timeZone), '10:30')
})

test('openSlots never returns closed days', () => {
  const dates = new Set(openSlots(base, [], now).map((s) => dateStrInZone(s.start, base.timeZone)))
  assert.ok(!dates.has('2026-10-31'))
  assert.ok(!dates.has('2026-11-01'))
  assert.ok(!dates.has('2026-10-29'))
})

test('nearestAlternatives brackets a taken time', () => {
  const busy = [{ start: ny('2026-10-27', '10:30'), end: ny('2026-10-27', '11:00') }]
  const { before, after } = nearestAlternatives(ny('2026-10-27', '10:30'), base, busy, now)
  assert.ok(before && after)
  assert.ok(before!.start < ny('2026-10-27', '10:30'))
  assert.ok(after!.start > ny('2026-10-27', '10:30'))
})

test('rejects malformed date strings', () => {
  assert.deepEqual(daySlots('tomorrow', base, [], now), [])
})
