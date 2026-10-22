import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, ExternalLink, PhoneCall, Wand2 } from 'lucide-react'
import { ActivityList } from '@/components/ActivityList'
import { AppointmentBadge, LeadStatusBadge } from '@/components/badges'
import { ScheduleDialog } from '@/components/ScheduleDialog'
import { Badge, Button, DefinitionList, Dialog, EmptyState, ErrorState, Field, Notice, Panel, Skeleton, Textarea } from '@/components/ui'
import { fmt, formatDuration, timeRange, tzLabel } from '@/lib/dates'
import { formatPhone } from '@/lib/format'
import {
  useAppointment,
  useAutoAssign,
  useCancelAppointment,
  useCompleteAppointment,
  useCreateAppointment,
  useReschedule,
  useSettings,
} from '@/hooks/queries'

const SOURCE = { caller: 'Chosen by the caller on the call', automatic: 'Assigned automatically', manual: 'Scheduled by your team' } as const

export function AppointmentDetailPage() {
  const { id = '' } = useParams()
  const { data, isLoading, isError, error, refetch } = useAppointment(id)
  const settings = useSettings()
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')

  const reschedule = useReschedule(() => setRescheduleOpen(false))
  const create = useCreateAppointment(() => setScheduleOpen(false))
  const cancel = useCancelAppointment(() => { setCancelOpen(false); setReason('') })
  const complete = useCompleteAppointment()
  const assign = useAutoAssign()

  const back = (
    <Link to="/appointments" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Appointments
    </Link>
  )

  if (isLoading) {
    return (
      <>
        {back}
        <Skeleton className="mb-6 h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      </>
    )
  }
  if (isError || !data) {
    return (
      <>
        {back}
        <ErrorState title="This appointment could not be opened" message={error instanceof Error ? error.message : 'Try again.'} onRetry={() => refetch()} />
      </>
    )
  }

  const { appointment: a, lead, call, activity } = data
  const active = ['pending', 'confirmed', 'auto_assigned'].includes(a.status)
  const needsTime = a.status === 'rescheduling_required'
  const hasTime = !!(a.scheduledStartAt && a.scheduledEndAt)
  const tz = settings.data ? tzLabel(a.timeZone, hasTime ? new Date(a.scheduledStartAt!) : new Date()) : ''

  return (
    <>
      {back}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-tight">{lead.fullName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AppointmentBadge status={a.status} />
            <span className="text-sm text-mute">Follow-up appointment</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {active && (
            <>
              <Button onClick={() => setRescheduleOpen(true)}>Reschedule</Button>
              {a.status !== 'pending' && <Button onClick={() => complete.mutate(a.id)} loading={complete.isPending}>Mark complete</Button>}
              <Button variant="ghost" className="text-coral hover:bg-coral-soft/60" onClick={() => setCancelOpen(true)}>Cancel appointment</Button>
            </>
          )}
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {needsTime && (
            <Notice
              tone="coral"
              title="This appointment has no time"
              action={
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setScheduleOpen(true)}>Choose a time</Button>
                  <Button onClick={() => assign.mutate(lead.id)} loading={assign.isPending}><Wand2 className="size-4" aria-hidden /> Assign earliest slot</Button>
                </div>
              }
            >
              The slot could not be reserved. The caller has not been told a time is confirmed.
            </Notice>
          )}
          {a.status === 'cancelled' && <Notice tone="brass" title="Cancelled">{a.cancelReason ?? 'No reason recorded.'}</Notice>}

          <Panel title="When">
            {hasTime ? (
              <div>
                <p className="font-display text-[28px] leading-tight font-semibold">{fmt.long(a.scheduledStartAt!)}</p>
                <p className="num mt-0.5 text-ink-2">{timeRange(a.scheduledStartAt!, a.scheduledEndAt!)} {tz && `(${tz})`}</p>
              </div>
            ) : (
              <p className="text-ink-2">No time is booked.</p>
            )}
            <div className="mt-4">
              <DefinitionList
                items={[
                  { label: 'Time zone', value: a.timeZone.replace('_', ' ') },
                  { label: 'Requested', value: a.requestedStartAt ? fmt.dateTime(a.requestedStartAt) : 'The caller did not ask for a time' },
                  { label: 'How it was set', value: SOURCE[a.assignmentSource] },
                  {
                    label: 'Calendar',
                    value: (
                      <Badge tone={a.confirmationStatus === 'reserved' ? 'teal' : a.confirmationStatus === 'failed' ? 'coral' : 'brass'}>
                        {a.confirmationStatus === 'reserved' ? 'Reserved on Google Calendar' : a.confirmationStatus === 'failed' ? 'Reservation failed' : 'Reservation pending'}
                      </Badge>
                    ),
                  },
                  { label: 'Event ID', value: a.googleCalendarEventId ? <span className="num font-mono text-xs break-all">{a.googleCalendarEventId}</span> : <span className="text-mute">None</span> },
                  { label: 'Reschedules', value: `${a.rescheduleCount} of ${settings.data?.maxReschedules ?? 3} allowed` },
                  { label: 'Created', value: fmt.dateTime(a.createdAt) },
                ]}
              />
            </div>
            {a.googleCalendarEventId && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-mute"><ExternalLink className="size-3.5" aria-hidden /> Opens in Google Calendar once connected to a real account</p>
            )}
          </Panel>

          <Panel title="Activity">
            {activity.length ? <ActivityList items={activity} /> : <EmptyState title="No activity yet" />}
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel
            title="Lead"
            actions={<Link to={`/leads/${lead.id}`} className="text-sm font-medium text-teal-deep hover:underline">Open lead</Link>}
          >
            <div className="mb-3"><LeadStatusBadge status={lead.status} /></div>
            <DefinitionList
              items={[
                { label: 'Email', value: <a href={`mailto:${lead.email}`} className="text-teal-deep hover:underline">{lead.email}</a> },
                { label: 'Phone', value: <a href={`tel:${lead.phoneNumber}`} className="num text-teal-deep hover:underline">{formatPhone(lead.phoneNumber)}</a> },
                { label: 'Reason', value: lead.reasonForCall },
              ]}
            />
          </Panel>

          <Panel title="Source call">
            {call ? (
              <div className="space-y-3 text-sm">
                <p>{fmt.dateTime(call.startedAt)} · <span className="num">{formatDuration(call.durationSeconds)}</span></p>
                <Link to={`/calls?call=${call.id}`}>
                  <Button><PhoneCall className="size-4" aria-hidden /> Replay call</Button>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-mute">Scheduled by your team, so there is no call attached.</p>
            )}
          </Panel>
        </aside>
      </div>

      <ScheduleDialog open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} title="Reschedule follow-up" description={`${a.rescheduleCount} reschedules used so far.`} confirmLabel="Move appointment" excludeAppointmentId={a.id} requestedAt={a.requestedStartAt} pending={reschedule.isPending} onConfirm={(startAt) => reschedule.mutate({ id: a.id, startAt })} />
      <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule a follow-up" description={`Pick an open time for ${lead.fullName}.`} confirmLabel="Book follow-up" requestedAt={a.requestedStartAt} pending={create.isPending} onConfirm={(startAt) => create.mutate({ leadId: lead.id, startAt })} />
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this appointment?"
        description="The Google Calendar event is removed and the lead goes back to needing a follow-up."
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)} disabled={cancel.isPending}>Keep appointment</Button>
            <Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate({ id: a.id, reason })}>Cancel appointment</Button>
          </>
        }
      >
        <Field label="Reason" hint="Saved to the activity history.">
          {(fid, d) => <Textarea id={fid} aria-describedby={d} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: caller asked to move to next month" />}
        </Field>
      </Dialog>
    </>
  )
}
