import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Wand2 } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui'
import { AppointmentBadge } from '@/components/badges'
import {
  addDays,
  endOfMonth,
  fmt,
  isSameDay,
  isSameMonth,
  minutesOfDay,
  parseDateInput,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDateInput,
  withTime,
} from '@/lib/dates'
import { cn } from '@/lib/format'
import { useAppointments, useAutoAssign, useExternalEvents, useLeads, useSettings } from '@/hooks/queries'
import type { AppointmentStatus, AppointmentWithLead, BusinessSettings, ExternalEvent } from '@/lib/types'

type View = 'day' | 'week' | 'month'
const HOUR_PX = 56
const SHOWN: AppointmentStatus[] = ['pending', 'confirmed', 'auto_assigned', 'completed']

const blockStyle: Record<string, string> = {
  confirmed: 'border-green bg-green-soft text-green',
  auto_assigned: 'border-blue bg-blue-soft text-blue',
  pending: 'border-brass bg-brass-soft text-brass',
  completed: 'border-mute bg-slate-soft text-ink-2',
}

function rangeFor(view: View, date: Date) {
  if (view === 'day') {
    const from = startOfDay(date)
    return { from, to: addDays(from, 1), days: [from] }
  }
  if (view === 'week') {
    const from = startOfWeek(date)
    return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) }
  }
  const from = startOfWeek(startOfMonth(date))
  return { from, to: addDays(from, 42), days: Array.from({ length: 42 }, (_, i) => addDays(from, i)) }
}

function titleFor(view: View, date: Date) {
  if (view === 'day') return fmt.longYear(date)
  if (view === 'month') return fmt.monthYear(date)
  const s = startOfWeek(date)
  const e = addDays(s, 6)
  return `${fmt.shortDate(s)} – ${fmt.shortDate(e)}, ${e.getFullYear()}`
}

function TimeGrid({ days, appts, events, settings }: { days: Date[]; appts: AppointmentWithLead[]; events: ExternalEvent[]; settings: BusinessSettings }) {
  const startHour = Math.max(0, Number(settings.openingTime.split(':')[0]) - 1)
  const endHour = Math.min(24, Math.ceil(Number(settings.closingTime.split(':')[0]) + Number(settings.closingTime.split(':')[1]) / 60) + 1)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const height = hours.length * HOUR_PX
  const now = new Date()
  const place = (start: Date, end: Date) => {
    const top = ((minutesOfDay(start) - startHour * 60) / 60) * HOUR_PX
    const h = ((end.getTime() - start.getTime()) / 3_600_000) * HOUR_PX
    return { top: Math.max(0, top), height: Math.max(22, h - 2) }
  }
  const open = withTime(new Date(), settings.openingTime)
  const close = withTime(new Date(), settings.closingTime)
  const businessTop = ((minutesOfDay(open) - startHour * 60) / 60) * HOUR_PX
  const businessHeight = ((minutesOfDay(close) - minutesOfDay(open)) / 60) * HOUR_PX

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: days.length > 1 ? 760 : 0 }}>
        <div className="grid border-b border-line bg-canvas/60" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <div key={d.toISOString()} className={cn('border-l border-line-2 px-2 py-2 text-center', isSameDay(d, now) && 'bg-teal-soft/60')}>
              <p className="text-xs text-ink-2">{fmt.weekday(d)}</p>
              <p className={cn('num font-display text-lg leading-tight font-semibold', isSameDay(d, now) && 'text-teal-deep')}>{d.getDate()}</p>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <span key={h} className="num absolute right-2 -translate-y-1/2 text-[11px] text-mute" style={{ top: i * HOUR_PX, display: i === 0 ? 'none' : undefined }}>
                {new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const working = settings.workingDays.includes(d.getDay()) && !settings.holidays.some((h) => h.date === toDateInput(d))
            const dayAppts = appts.filter((a) => a.scheduledStartAt && isSameDay(new Date(a.scheduledStartAt), d))
            const dayEvents = events.filter((e) => isSameDay(new Date(e.startAt), d))
            return (
              <div key={d.toISOString()} className={cn('relative border-l border-line-2', !working && 'bg-sunken/70')} style={{ height }}>
                {working && <div aria-hidden className="absolute inset-x-0 bg-surface" style={{ top: businessTop, height: businessHeight }} />}
                {hours.map((h, i) => (
                  <div key={h} aria-hidden className="absolute inset-x-0 border-t border-line-2" style={{ top: i * HOUR_PX }} />
                ))}
                {dayEvents.map((e) => {
                  const p = place(new Date(e.startAt), new Date(e.endAt))
                  return (
                    <div key={e.id} className="absolute inset-x-1 overflow-hidden rounded-sm border border-dashed border-mute/50 bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(102_123_128/0.14)_5px_6px)] px-1.5 py-0.5 text-[11px] text-ink-2" style={p} title={`${e.title} (Google Calendar)`}>
                      <span className="line-clamp-2">{e.title}</span>
                    </div>
                  )
                })}
                {dayAppts.map((a) => {
                  const p = place(new Date(a.scheduledStartAt!), new Date(a.scheduledEndAt!))
                  return (
                    <Link
                      key={a.id}
                      to={`/appointments/${a.id}`}
                      className={cn('absolute inset-x-1 overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight shadow-sm hover:brightness-95', blockStyle[a.status])}
                      style={p}
                      title={`${a.leadName}, ${fmt.time(a.scheduledStartAt!)}`}
                    >
                      <span className="num block font-semibold">{fmt.time(a.scheduledStartAt!)}</span>
                      <span className="block truncate">{a.leadName}</span>
                    </Link>
                  )
                })}
                {isSameDay(d, now) && now.getHours() >= startHour && now.getHours() < endHour && (
                  <div aria-hidden className="absolute inset-x-0 z-10 border-t-2 border-coral" style={{ top: ((minutesOfDay(now) - startHour * 60) / 60) * HOUR_PX }}>
                    <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-coral" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthGrid({ days, month, appts, onPickDay }: { days: Date[]; month: Date; appts: AppointmentWithLead[]; onPickDay: (d: Date) => void }) {
  const now = new Date()
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="grid grid-cols-7 border-b border-line bg-canvas/60 text-center text-xs text-ink-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = appts.filter((a) => a.scheduledStartAt && isSameDay(new Date(a.scheduledStartAt), d))
            const inMonth = isSameMonth(d, month)
            return (
              <div key={d.toISOString()} className={cn('min-h-[104px] border-t border-l border-line-2 p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0', !inMonth && 'bg-sunken/60')}>
                <button type="button" onClick={() => onPickDay(d)} className={cn('num mb-1 grid size-6 place-items-center rounded-full text-xs hover:bg-sunken', isSameDay(d, now) ? 'bg-teal font-semibold text-white hover:bg-teal-deep' : inMonth ? 'text-ink' : 'text-mute')} aria-label={`Open ${fmt.long(d)}`}>
                  {d.getDate()}
                </button>
                <ul className="space-y-0.5">
                  {list.slice(0, 3).map((a) => (
                    <li key={a.id}>
                      <Link to={`/appointments/${a.id}`} className={cn('block truncate rounded-sm border-l-2 px-1 py-px text-[11px]', blockStyle[a.status])}>
                        <span className="num">{fmt.time(a.scheduledStartAt!)}</span> {a.leadName}
                      </Link>
                    </li>
                  ))}
                </ul>
                {list.length > 3 && (
                  <button type="button" onClick={() => onPickDay(d)} className="mt-0.5 px-1 text-[11px] font-medium text-teal-deep hover:underline">
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function NeedsTime() {
  const { data, isLoading } = useLeads({ appointmentStatus: 'unassigned', pageSize: 6, sort: 'createdAt', dir: 'desc' })
  const assign = useAutoAssign()
  return (
    <Panel title="Leads without a follow-up time" description="Open leads that have no active appointment" flush>
      {isLoading ? (
        <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : !data?.items.length ? (
        <EmptyState title="Every open lead has a time">New callers are booked or assigned automatically.</EmptyState>
      ) : (
        <ul className="divide-y divide-line-2">
          {data.items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <Link to={`/leads/${l.id}`} className="block truncate text-sm font-medium hover:underline">{l.fullName}</Link>
                <p className="truncate text-xs text-mute">{l.reasonForCall}</p>
              </div>
              <Button size="sm" onClick={() => assign.mutate(l.id)} loading={assign.isPending && assign.variables === l.id}>
                <Wand2 className="size-3.5" aria-hidden /> Assign earliest slot
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && (
        <div className="border-t border-line-2 px-5 py-3 text-sm">
          <Link to="/leads?appt=unassigned" className="font-medium text-teal-deep hover:underline">See all {data.total}</Link>
        </div>
      )}
    </Panel>
  )
}

export function AppointmentsPage() {
  const [sp, setSp] = useSearchParams()
  const view = (sp.get('view') as View) || 'week'
  const date = sp.get('date') ? parseDateInput(sp.get('date')!) : startOfDay(new Date())
  const [showBusy, setShowBusy] = useState(true)
  const settings = useSettings()

  const set = (patch: { view?: View; date?: Date }) => {
    const next = new URLSearchParams(sp)
    if (patch.view) next.set('view', patch.view)
    if (patch.date) next.set('date', toDateInput(patch.date))
    setSp(next, { replace: true })
  }

  const range = useMemo(() => rangeFor(view, date), [view, date.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const appts = useAppointments({ from: range.from.toISOString(), to: range.to.toISOString() })
  const events = useExternalEvents(range.from.toISOString(), range.to.toISOString())

  const step = (dir: -1 | 1) => {
    if (view === 'day') set({ date: addDays(date, dir) })
    else if (view === 'week') set({ date: addDays(date, dir * 7) })
    else set({ date: new Date(date.getFullYear(), date.getMonth() + dir, 1) })
  }

  const visible = (appts.data ?? []).filter((a) => SHOWN.includes(a.status))
  const loading = appts.isLoading || settings.isLoading

  return (
    <>
      <PageHeader title="Appointments" description="Every follow-up on the calendar, with the other events that block time." />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button onClick={() => set({ date: startOfDay(new Date()) })}>Today</Button>
          <div className="flex">
            <Button className="rounded-r-none" onClick={() => step(-1)} aria-label={`Previous ${view}`}><ChevronLeft className="size-4" aria-hidden /></Button>
            <Button className="-ml-px rounded-l-none" onClick={() => step(1)} aria-label={`Next ${view}`}><ChevronRight className="size-4" aria-hidden /></Button>
          </div>
          <h2 className="ml-1 font-display text-xl" aria-live="polite">{titleFor(view, date)}</h2>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={showBusy} onChange={(e) => setShowBusy(e.target.checked)} className="size-4 accent-teal" />
            Show busy time
          </label>
          <div role="group" aria-label="Calendar view" className="flex gap-0.5 rounded-[10px] bg-black/[0.07] p-0.5">
            {(['day', 'week', 'month'] as View[]).map((v, i) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => set({ view: v })}
                className={cn('h-8 rounded-[8px] px-3.5 text-sm capitalize transition-[background-color,box-shadow,color] duration-150', view === v ? 'bg-surface font-medium text-ink shadow-[0_1px_3px_rgb(0_0_0/0.15),0_0_0_0.5px_rgb(0_0_0/0.06)]' : 'text-ink-2 hover:text-ink')}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.05),0_1px_3px_rgb(0_0_0/0.04)]">
        {appts.isError ? (
          <ErrorState message="The calendar could not be loaded." onRetry={() => appts.refetch()} />
        ) : loading || !settings.data ? (
          <Skeleton className="m-4 h-[32rem]" />
        ) : view === 'month' ? (
          <MonthGrid days={range.days} month={date} appts={visible} onPickDay={(d) => set({ view: 'day', date: d })} />
        ) : (
          <TimeGrid days={range.days} appts={visible} events={showBusy ? events.data ?? [] : []} settings={settings.data} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-2">
        {(['confirmed', 'auto_assigned', 'pending', 'completed'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-3 rounded-sm border-l-[3px]', blockStyle[s])} />
            <AppointmentLabel status={s} />
          </span>
        ))}
        <span className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm border border-dashed border-mute/60 bg-sunken" /> Busy on Google Calendar</span>
        {!appts.isLoading && !visible.length && <span className="text-mute">No appointments in this {view}.</span>}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <NeedsTime />
        <UpcomingNext />
      </div>
    </>
  )
}

function AppointmentLabel({ status }: { status: AppointmentStatus }) {
  const label: Record<string, string> = { confirmed: 'Confirmed', auto_assigned: 'Automatically assigned', pending: 'Pending', completed: 'Completed' }
  return <>{label[status]}</>
}

function UpcomingNext() {
  const range = useMemo(() => ({ from: new Date().toISOString(), to: addDays(new Date(), 30).toISOString() }), [])
  const { data, isLoading } = useAppointments(range)
  const list = (data ?? []).filter((a) => ['confirmed', 'auto_assigned', 'pending'].includes(a.status)).slice(0, 5)
  return (
    <Panel title="Next up" flush>
      {isLoading ? (
        <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : !list.length ? (
        <EmptyState title="Nothing scheduled">Upcoming follow-ups appear here.</EmptyState>
      ) : (
        <ul className="divide-y divide-line-2">
          {list.map((a) => (
            <li key={a.id}>
              <Link to={`/appointments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sunken/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.leadName}</span>
                  <span className="num block text-xs text-mute">{fmt.dateTime(a.scheduledStartAt!)}</span>
                </span>
                <AppointmentBadge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
