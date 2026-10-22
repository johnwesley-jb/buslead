import { useMemo } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ArrowRight, CalendarClock, Hourglass, PhoneOff } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ActivityList } from '@/components/ActivityList'
import { AppointmentBadge } from '@/components/badges'
import { Button, EmptyState, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui'
import { addDays, fmt, parseDateInput, relativeTime } from '@/lib/dates'
import { cn, firstName } from '@/lib/format'
import { useAppointments, useAttention, useCallsByDay, useDashboardActivity, useSummary } from '@/hooks/queries'
import type { AttentionItem } from '@/lib/types'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** One strip instead of six cards: the figures are a single ledger read left to right. */
function Ledger() {
  const { data, isLoading, isError, refetch } = useSummary()
  if (isError) return <ErrorState message="The summary figures could not be loaded." onRetry={() => refetch()} />
  const items = [
    { label: 'Total leads', value: data?.totalLeads, to: '/leads' },
    { label: 'New leads', value: data?.newLeads, to: '/leads?status=new' },
    { label: 'Awaiting follow-up', value: data?.awaitingFollowUp, to: '/leads' },
    { label: 'Scheduled appointments', value: data?.scheduledAppointments, to: '/appointments' },
    { label: 'Completed follow-ups', value: data?.completedFollowUps, to: '/appointments' },
    { label: 'Unassigned follow-ups', value: data?.unassignedFollowUps, to: '/leads?appt=unassigned', alert: true },
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
      {items.map((i) => {
        const alert = i.alert && (i.value ?? 0) > 0
        return (
          <Link key={i.label} to={i.to} className={cn('block px-5 py-4 transition-colors', alert ? 'bg-brass-soft hover:bg-brass-soft/70' : 'bg-surface hover:bg-sunken')}>
            <p className={cn('text-[13px]', alert ? 'font-medium text-brass' : 'text-ink-2')}>{i.label}</p>
            <div className="mt-1">
              {isLoading ? <Skeleton className="h-9 w-14" /> : <span className={cn('num font-display text-[38px] leading-none font-semibold', alert ? 'text-brass' : 'text-ink')}>{i.value}</span>}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function CallsChart() {
  const { data, isLoading, isError, refetch } = useCallsByDay()
  const max = useMemo(() => Math.max(3, ...(data ?? []).map((d) => d.calls)), [data])
  const total = data?.reduce((n, d) => n + d.calls, 0) ?? 0
  const booked = data?.reduce((n, d) => n + d.booked, 0) ?? 0

  return (
    <Panel title="Calls in the last 14 days" description={data ? `${total} calls, ${booked} ended with a follow-up on the calendar` : undefined}>
      {isError ? (
        <ErrorState message="Call volume could not be loaded." onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <div role="img" aria-label={`Bar chart of daily calls. ${total} calls in 14 days, ${booked} with a follow-up booked.`} className="flex h-44 items-end gap-1.5 sm:gap-2">
            {data.map((d) => {
              const date = parseDateInput(d.date)
              const weekend = date.getDay() === 0 || date.getDay() === 6
              return (
                <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${fmt.shortDate(date)}: ${d.calls} calls, ${d.booked} booked`}>
                  <span className="num mb-1 text-center text-[11px] text-ink-2">{d.calls || ''}</span>
                  <div className={cn('relative w-full overflow-hidden rounded-t-sm', weekend ? 'bg-line-2' : 'bg-line')} style={{ height: `${(d.calls / max) * 100}%`, minHeight: d.calls ? 4 : 2 }}>
                    <div className="absolute inset-x-0 bottom-0 bg-teal" style={{ height: d.calls ? `${(d.booked / d.calls) * 100}%` : 0 }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-2" aria-hidden>
            {data.map((d, i) => (
              <span key={d.date} className="num flex-1 text-center text-[11px] text-mute">
                {i % 2 === (data.length - 1) % 2 ? parseDateInput(d.date).getDate() : ''}
              </span>
            ))}
          </div>
          <div className="mt-4 flex gap-5 text-xs text-ink-2">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-teal" aria-hidden /> Follow-up booked</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-line" aria-hidden /> No follow-up yet</span>
          </div>
        </>
      )}
    </Panel>
  )
}

const attentionIcon: Record<AttentionItem['kind'], typeof AlertCircle> = {
  unassigned: CalendarClock,
  reschedule_required: CalendarClock,
  processing_failed: PhoneOff,
  pending_reservation: Hourglass,
}
const attentionTitle: Record<AttentionItem['kind'], string> = {
  unassigned: 'Needs a time',
  reschedule_required: 'Needs a new time',
  processing_failed: 'Call processing failed',
  pending_reservation: 'Booking in progress',
}

function Attention() {
  const { data, isLoading, isError, refetch } = useAttention()
  return (
    <Panel title="Needs attention" description="Leads the system could not finish on its own" flush>
      {isError ? (
        <ErrorState message="This list could not be loaded." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : !data?.length ? (
        <EmptyState title="Nothing is stuck">Every lead has a follow-up or is on its way to one.</EmptyState>
      ) : (
        <ul className="divide-y divide-line-2">
          {data.slice(0, 5).map((a) => {
            const Icon = attentionIcon[a.kind]
            return (
              <li key={a.id}>
                <Link to={`/leads/${a.leadId}`} className="flex gap-3 px-5 py-3 hover:bg-sunken/60">
                  <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', a.kind === 'pending_reservation' ? 'bg-brass-soft text-brass' : 'bg-coral-soft text-coral')}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{a.leadName} <span className="font-normal text-mute">· {attentionTitle[a.kind]}</span></span>
                    <span className="block text-[13px] text-ink-2">{a.detail}</span>
                    <span className="block text-xs text-mute">{relativeTime(a.at)}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function Upcoming() {
  const range = useMemo(() => ({ from: new Date().toISOString(), to: addDays(new Date(), 14).toISOString() }), [])
  const { data, isLoading, isError, refetch } = useAppointments(range)
  const upcoming = (data ?? []).filter((a) => ['confirmed', 'auto_assigned', 'pending'].includes(a.status)).slice(0, 6)
  return (
    <Panel
      title="Upcoming follow-ups"
      actions={
        <Link to="/appointments" className="inline-flex items-center gap-1 text-sm font-medium text-teal-deep hover:underline">
          Open calendar <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
      flush
    >
      {isError ? (
        <ErrorState message="Upcoming appointments could not be loaded." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : !upcoming.length ? (
        <EmptyState title="No follow-ups in the next two weeks">Booked and automatically assigned appointments show up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-line-2">
          {upcoming.map((a) => (
            <li key={a.id}>
              <Link to={`/appointments/${a.id}`} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 px-5 py-3 hover:bg-sunken/60">
                <span className="num leading-tight">
                  <span className="block text-sm font-semibold">{fmt.shortDate(a.scheduledStartAt!)}</span>
                  <span className="block text-xs text-mute">{fmt.time(a.scheduledStartAt!)}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.leadName}</span>
                  <span className="block truncate text-xs text-mute">{a.leadEmail}</span>
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

function Recent() {
  const { data, isLoading, isError, refetch } = useDashboardActivity()
  return (
    <Panel title="Recent activity">
      {isError ? (
        <ErrorState message="Activity could not be loaded." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !data?.length ? (
        <EmptyState title="No activity yet">Calls, bookings and edits are logged here.</EmptyState>
      ) : (
        <ActivityList items={data} showLead />
      )}
    </Panel>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user?.name ?? '')}`}
        description="Where your calls, leads and follow-ups stand right now."
        actions={
          <Link to="/leads">
            <Button variant="primary">View all leads</Button>
          </Link>
        }
      />
      <div className="space-y-6">
        <Ledger />
        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <CallsChart />
          <Attention />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Upcoming />
          <Recent />
        </div>
      </div>
    </>
  )
}
