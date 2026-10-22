/**
 * Time zone helpers built on Intl only (no date library). All scheduling is done in the business time zone:
 * "9:00 on 2026-10-26" means 9:00 wall-clock there, whatever zone the server runs in.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    dtfCache.set(tz, f)
  }
  return f
}

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function partsInZone(date: Date, tz: string): ZonedParts {
  const o: Record<string, number> = {}
  for (const p of dtf(tz).formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { year: o.year, month: o.month, day: o.day, hour: o.hour === 24 ? 0 : o.hour, minute: o.minute, second: o.second }
}

/** Offset of `tz` from UTC at the given instant, in milliseconds. */
export function offsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" + "HH:mm" in `tz` -> UTC instant. Handles DST transitions (a skipped hour resolves forward). */
export function zonedToUtc(dateStr: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0, 0)
  let t = guess - offsetMs(new Date(guess), tz)
  const o2 = offsetMs(new Date(t), tz)
  t = guess - o2
  return new Date(t)
}

export const dateStrInZone = (date: Date, tz: string) => {
  const p = partsInZone(date, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export const timeStrInZone = (date: Date, tz: string) => {
  const p = partsInZone(date, tz)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** Calendar arithmetic on date strings is zone independent. */
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** 0 = Sunday. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export const isDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

export function formatSpoken(date: Date, tz: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date)
  return `${day} at ${time}`
}

export function formatTimeOnly(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date)
}
