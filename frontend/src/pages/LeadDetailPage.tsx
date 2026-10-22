import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CalendarCheck2, CalendarClock, ExternalLink, Pencil, Trash2, Wand2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ActivityList } from '@/components/ActivityList'
import { AppointmentBadge, LeadStatusBadge, PriorityBadge, ProcessingBadge, RecordingBadge } from '@/components/badges'
import { CallPlayback } from '@/components/CallPlayback'
import { LeadFormDialog } from '@/components/LeadFormDialog'
import { ScheduleDialog } from '@/components/ScheduleDialog'
import { Button, ConfirmDialog, DefinitionList, Dialog, EmptyState, ErrorState, Field, Notice, Panel, Select, Skeleton, Textarea } from '@/components/ui'
import { fmt, formatDuration, relativeTime, timeRange } from '@/lib/dates'
import { LEAD_STATUS_LABEL, LEAD_TRANSITIONS, formatPhone } from '@/lib/format'
import type { Appointment, Call, LeadDetail } from '@/lib/types'
import {
  useAddNote,
  useAutoAssign,
  useCancelAppointment,
  useCompleteAppointment,
  useCreateAppointment,
  useDeleteLead,
  useLead,
  useReschedule,
  useUpdateLead,
} from '@/hooks/queries'

const SOURCE_LABEL = { caller: 'Chosen by the caller on the call', automatic: 'Assigned automatically', manual: 'Scheduled by your team' } as const

function CallSection({ calls }: { calls: Call[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!calls.length) {
    return (
      <Panel title="Call">
        <EmptyState title="No call is linked to this lead">This lead was added manually, so there is no recording or transcript.</EmptyState>
      </Panel>
    )
  }
  const call = calls.find((c) => c.id === selectedId) ?? calls[0]
  return (
    <Panel
      title="Call recording and transcript"
      description={`${fmt.longYear(call.startedAt)}, ${fmt.time(call.startedAt)} · ${formatDuration(call.durationSeconds)}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <ProcessingBadge status={call.processingStatus} />
          <RecordingBadge status={call.recordingStatus} />
        </div>
      }
    >
      {calls.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Select aria-label="Choose call" value={call.id} onChange={(e) => setSelectedId(e.target.value)}>
            {calls.map((c) => <option key={c.id} value={c.id}>{fmt.dateTime(c.startedAt)}</option>)}
          </Select>
        </div>
      )}
      <CallPlayback call={call} />
      <p className="num mt-4 text-xs text-mute">Vapi call ID {call.vapiCallId}</p>
    </Panel>
  )
}

function FollowUpSection({ detail }: { detail: LeadDetail }) {
  const { lead, appointments } = detail
  const active = appointments.find((a) => ['pending', 'confirmed', 'auto_assigned'].includes(a.status))
  const waiting = appointments.find((a) => a.status === 'rescheduling_required')
  const current: Appointment | undefined = active ?? waiting ?? appointments[0]
  const requestedAt = current?.requestedStartAt ?? null

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')

  const create = useCreateAppointment(() => setScheduleOpen(false))
  const reschedule = useReschedule(() => setRescheduleOpen(false))
  const cancel = useCancelAppointment(() => { setCancelOpen(false); setReason('') })
  const complete = useCompleteAppointment()
  const assign = useAutoAssign()

  const canAct = !!active
  const history = appointments.filter((a) => a.id !== current?.id)

  return (
    <Panel title="Follow-up appointment" description="Booked against your Google Calendar. Times are re-checked before every booking.">
      {!current ? (
        <EmptyState icon={<CalendarClock className="size-5" aria-hidden />} title="No follow-up scheduled" action={<Scheduling onSchedule={() => setScheduleOpen(true)} onAssign={() => assign.mutate(lead.id)} assigning={assign.isPending} />}>
          Pick a time yourself, or let the system reserve the earliest open slot.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {current.status === 'rescheduling_required' && (
            <Notice tone="coral" title="No time is booked for this lead" action={<Scheduling onSchedule={() => setScheduleOpen(true)} onAssign={() => assign.mutate(lead.id)} assigning={assign.isPending} />}>
              The system could not reserve a slot, usually because Google Calendar was unavailable. Nothing has been confirmed with the caller.
            </Notice>
          )}
          {current.status === 'pending' && <Notice tone="brass" title="Reservation in progress">The slot is held internally while Google Calendar finishes. It is not confirmed until the calendar event exists.</Notice>}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {current.scheduledStartAt && current.scheduledEndAt ? (
                <>
                  <p className="font-display text-2xl leading-tight font-semibold">{fmt.long(current.scheduledStartAt)}</p>
                  <p className="num text-sm text-ink-2">{timeRange(current.scheduledStartAt, current.scheduledEndAt)} · {current.timeZone.replace('_', ' ')}</p>
                </>
              ) : (
                <p className="font-display text-xl font-semibold text-ink-2">No time yet</p>
              )}
              <p className="mt-1.5 text-sm text-ink-2">{SOURCE_LABEL[current.assignmentSource]}</p>
              {requestedAt && current.scheduledStartAt && requestedAt !== current.scheduledStartAt && (
                <p className="text-xs text-mute">Caller originally asked for {fmt.dateTime(requestedAt)}</p>
              )}
            </div>
            <AppointmentBadge status={current.status} />
          </div>

          <div className="flex flex-wrap gap-2">
            {canAct && (
              <>
                <Button onClick={() => setRescheduleOpen(true)}>Reschedule</Button>
                {current.status !== 'pending' && <Button onClick={() => complete.mutate(current.id)} loading={complete.isPending}>Mark complete</Button>}
                <Button variant="ghost" className="text-coral hover:bg-coral-soft/60" onClick={() => setCancelOpen(true)}>Cancel appointment</Button>
              </>
            )}
            {(current.status === 'cancelled' || current.status === 'completed') && !active && (
              <Scheduling onSchedule={() => setScheduleOpen(true)} onAssign={() => assign.mutate(lead.id)} assigning={assign.isPending} />
            )}
            <Link to={`/appointments/${current.id}`} className="ml-auto self-center text-sm font-medium text-teal-deep hover:underline">
              Appointment details
            </Link>
          </div>

          {current.cancelReason && current.status === 'cancelled' && <p className="text-sm text-ink-2">Cancelled: {current.cancelReason}</p>}

          {history.length > 0 && (
            <div className="border-t border-line-2 pt-3">
              <p className="mb-1.5 text-xs font-medium text-ink-2">Earlier appointments</p>
              <ul className="space-y-1.5">
                {history.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link to={`/appointments/${a.id}`} className="text-ink-2 hover:underline">{a.scheduledStartAt ? fmt.dateTime(a.scheduledStartAt) : 'No time'}</Link>
                    <AppointmentBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule a follow-up" description={`Pick an open time for ${lead.fullName}.`} confirmLabel="Book follow-up" requestedAt={requestedAt} pending={create.isPending} onConfirm={(startAt) => create.mutate({ leadId: lead.id, startAt })} />
      {current && (
        <ScheduleDialog open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} title="Reschedule follow-up" description={`${current.rescheduleCount} of the allowed reschedules used.`} confirmLabel="Move appointment" excludeAppointmentId={current.id} requestedAt={requestedAt} pending={reschedule.isPending} onConfirm={(startAt) => reschedule.mutate({ id: current.id, startAt })} />
      )}
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this appointment?"
        description="The Google Calendar event is removed and the lead goes back to needing a follow-up."
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)} disabled={cancel.isPending}>Keep appointment</Button>
            <Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => current && cancel.mutate({ id: current.id, reason })}>Cancel appointment</Button>
          </>
        }
      >
        <Field label="Reason" hint="Saved to the activity history.">
          {(id, d) => <Textarea id={id} aria-describedby={d} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: caller asked to move to next month" />}
        </Field>
      </Dialog>
    </Panel>
  )
}

function Scheduling({ onSchedule, onAssign, assigning }: { onSchedule: () => void; onAssign: () => void; assigning: boolean }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="primary" onClick={onSchedule}><CalendarCheck2 className="size-4" aria-hidden /> Choose a time</Button>
      <Button onClick={onAssign} loading={assigning}><Wand2 className="size-4" aria-hidden /> Assign earliest slot</Button>
    </div>
  )
}

function NotesSection({ detail }: { detail: LeadDetail }) {
  const [body, setBody] = useState('')
  const add = useAddNote(detail.lead.id)
  return (
    <Panel title="Internal notes" description="Only your team sees these.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) add.mutate(body, { onSuccess: () => setBody('') })
        }}
        className="space-y-2"
      >
        <label htmlFor="note" className="sr-only">New note</label>
        <Textarea id="note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write what you learned or what happens next" />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={!body.trim()} loading={add.isPending}>Add note</Button>
        </div>
      </form>
      {detail.lead.internalNotes.length > 0 && (
        <ul className="mt-4 divide-y divide-line-2 border-t border-line-2">
          {detail.lead.internalNotes.map((n) => (
            <li key={n.id} className="py-3">
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-mute">{n.authorName} · {relativeTime(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function LeadDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { data, isLoading, isError, error, refetch } = useLead(id)
  const update = useUpdateLead(id)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const del = useDeleteLead(() => navigate('/leads', { replace: true }))

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6"><Skeleton className="h-96" /><Skeleton className="h-52" /></div>
          <Skeleton className="h-96" />
        </div>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <>
        <Link to="/leads" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:underline"><ArrowLeft className="size-4" aria-hidden /> Leads</Link>
        <ErrorState title="This lead could not be opened" message={error instanceof Error ? error.message : 'Try again.'} onRetry={() => refetch()} />
      </>
    )
  }

  const { lead, calls } = data
  const nextStatuses = [lead.status, ...LEAD_TRANSITIONS[lead.status]]
  const call = calls[0]
  const extracted = call?.extractedData
  const eventId = data.appointments.find((a) => a.googleCalendarEventId)?.googleCalendarEventId

  return (
    <>
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Leads
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] leading-tight">{lead.fullName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LeadStatusBadge status={lead.status} />
            <PriorityBadge priority={lead.priority} />
            <span className="text-sm text-mute">Created {relativeTime(lead.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs font-medium text-ink-2">
            Lead status
            <Select
              className="mt-1 w-48"
              value={lead.status}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ status: e.target.value as typeof lead.status }, )}
            >
              {nextStatuses.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
            </Select>
          </label>
          <Button onClick={() => setEditOpen(true)}><Pencil className="size-4" aria-hidden /> Edit</Button>
          {isAdmin && (
            <Button variant="ghost" className="text-coral hover:bg-coral-soft/60" onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" aria-hidden /> Delete</Button>
          )}
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <CallSection calls={calls} />
          <FollowUpSection detail={data} />
          <NotesSection detail={data} />
          <Panel title="Activity">
            {data.activity.length ? <ActivityList items={data.activity} /> : <EmptyState title="No activity yet" />}
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel title="Contact">
            <DefinitionList
              items={[
                { label: 'Email', value: <a href={`mailto:${lead.email}`} className="text-teal-deep hover:underline">{lead.email}</a> },
                { label: 'Phone', value: <a href={`tel:${lead.phoneNumber}`} className="num text-teal-deep hover:underline">{formatPhone(lead.phoneNumber)}</a> },
                { label: 'Time zone', value: lead.timeZone.replace('_', ' ') },
                { label: 'Source', value: lead.source === 'phone' ? 'Phone call (Vapi)' : 'Added manually' },
                { label: 'Created', value: fmt.dateTime(lead.createdAt) },
                { label: 'Updated', value: fmt.dateTime(lead.updatedAt) },
              ]}
            />
          </Panel>

          <Panel title="Why they called">
            <p className="text-sm">{lead.reasonForCall}</p>
            {lead.notes && <p className="mt-2 text-sm text-ink-2">{lead.notes}</p>}
          </Panel>

          <Panel title="Google Calendar event">
            {eventId ? (
              <div className="space-y-2 text-sm">
                <p className="num font-mono text-xs break-all text-ink-2">{eventId}</p>
                <span className="inline-flex items-center gap-1.5 text-mute"><ExternalLink className="size-3.5" aria-hidden /> Opens in Google Calendar once connected to a real account</span>
              </div>
            ) : (
              <p className="text-sm text-mute">No calendar event exists for this lead yet.</p>
            )}
          </Panel>

          {extracted && (
            <Panel title="Captured on the call" description="What the receptionist extracted. Review before trusting it.">
              <DefinitionList
                items={[
                  { label: 'Name', value: extracted.fullName },
                  { label: 'Preferred date', value: extracted.preferredDate ?? 'Not given' },
                  { label: 'Preferred time', value: extracted.preferredTime ?? 'Not given' },
                  { label: 'Time zone', value: extracted.timeZone.replace('_', ' ') },
                ]}
              />
            </Panel>
          )}
        </aside>
      </div>

      <LeadFormDialog open={editOpen} onClose={() => setEditOpen(false)} lead={lead} pending={update.isPending} onSubmit={(v) => update.mutate(v, { onSuccess: () => setEditOpen(false) })} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => del.mutate(lead.id)}
        pending={del.isPending}
        title={`Delete ${lead.fullName}?`}
        description="The lead, its calls, transcripts and appointments are removed, and any calendar event is cancelled. This cannot be undone."
        confirmLabel="Delete lead"
      />
    </>
  )
}
