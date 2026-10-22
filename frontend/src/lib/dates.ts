/** Small, dependency-free date helpers. All math uses the viewer's local time zone. */

export const MS_MIN = 60_000

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * MS_MIN)

export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export const startOfDay = (d: Date) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Weeks start on Monday. */
export const startOfWeek = (d: Date) => {
  const x = startOfDay(d)
  return addDays(x, -((x.getDay() + 6) % 7))
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
export const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export const isSameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

/** Returns a copy of `d` with the clock set from "HH:mm". */
export const withTime = (d: Date, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0, 0, 0)
}

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

const pad = (n: number) => String(n).padStart(2, '0')

export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export const parseDateInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const f = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', opts)
const fmtShortDate = f({ month: 'short', day: 'numeric' })
const fmtDateY = f({ month: 'short', day: 'numeric', year: 'numeric' })
const fmtLong = f({ weekday: 'long', month: 'long', day: 'numeric' })
const fmtLongY = f({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const fmtTimeOnly = f({ hour: 'numeric', minute: '2-digit' })
const fmtWeekdayShort = f({ weekday: 'short' })
const fmtMonthYear = f({ month: 'long', year: 'numeric' })
const fmtMonthShort = f({ month: 'short' })

export const fmt = {
  date: (d: Date | string) => fmtDateY.format(new Date(d)),
  shortDate: (d: Date | string) => fmtShortDate.format(new Date(d)),
  long: (d: Date | string) => fmtLong.format(new Date(d)),
  longYear: (d: Date | string) => fmtLongY.format(new Date(d)),
  time: (d: Date | string) => fmtTimeOnly.format(new Date(d)),
  dateTime: (d: Date | string) => `${fmtShortDate.format(new Date(d))}, ${fmtTimeOnly.format(new Date(d))}`,
  weekday: (d: Date | string) => fmtWeekdayShort.format(new Date(d)),
  monthYear: (d: Date | string) => fmtMonthYear.format(new Date(d)),
  month: (d: Date | string) => fmtMonthShort.format(new Date(d)),
}

export const timeRange = (start: string | Date, end: string | Date) =>
  `${fmtTimeOnly.format(new Date(start))} – ${fmtTimeOnly.format(new Date(end))}`

/** Short zone label such as "EDT" for an IANA zone. */
export const tzLabel = (timeZone: string, at: Date = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
  } catch {
    return timeZone
  }
}

export const relativeTime = (iso: string | Date, now: Date = new Date()) => {
  const diff = now.getTime() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / MS_MIN)
  const suffix = diff >= 0 ? 'ago' : 'from now'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ${suffix}`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ${suffix}`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ${suffix}`
  return fmtDateY.format(new Date(iso))
}

/** "4m 12s" */
export const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null) return '–'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${pad(s)}s` : `${s}s`
}

/** "4:12" for players */
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}
