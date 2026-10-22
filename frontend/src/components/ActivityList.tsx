import { Link } from 'react-router'
import type { ActivityLog } from '@/lib/types'
import { fmt, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/format'

const LABEL: Record<string, string> = {
  'lead.created': 'Lead created',
  'lead.updated': 'Lead updated',
  'lead.deleted': 'Lead deleted',
  'lead.note_added': 'Note added',
  'call.received': 'Call received',
  'call.processing_failed': 'Call processing failed',
  'appointment.confirmed': 'Appointment confirmed',
  'appointment.pending': 'Reservation pending',
  'appointment.auto_assigned': 'Follow-up assigned automatically',
  'appointment.rescheduling_required': 'Needs a new time',
  'appointment.rescheduled': 'Appointment rescheduled',
  'appointment.cancelled': 'Appointment cancelled',
  'appointment.completed': 'Follow-up completed',
  'calendar.connected': 'Google Calendar connected',
  'calendar.disconnected': 'Google Calendar disconnected',
  'calendar.selected': 'Calendar changed',
  'settings.updated': 'Scheduling settings updated',
  'user.password_changed': 'Password changed',
}

const tone = (action: string) =>
  /failed|cancelled|disconnected|deleted|rescheduling_required/.test(action)
    ? 'bg-coral'
    : /pending|auto_assigned/.test(action)
      ? 'bg-brass'
      : /confirmed|completed|connected|created/.test(action)
        ? 'bg-teal'
        : 'bg-mute'

export type ActivityItem = ActivityLog & { leadName?: string | null }

/** A real sequence in time, so it is drawn as a timeline. */
export function ActivityList({ items, showLead }: { items: ActivityItem[]; showLead?: boolean }) {
  return (
    <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line">
      {items.map((a) => (
        <li key={a.id} className="relative pl-6">
          <span aria-hidden className={cn('absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-surface', tone(a.action))} />
          <p className="text-sm font-medium text-ink">
            {LABEL[a.action] ?? a.action}
            {showLead && a.leadName && a.leadId && (
              <>
                {' '}
                <span className="font-normal text-mute">for </span>
                <Link to={`/leads/${a.leadId}`} className="font-medium text-teal-deep underline-offset-2 hover:underline">
                  {a.leadName}
                </Link>
              </>
            )}
          </p>
          <p className="text-sm text-ink-2">{a.details}</p>
          <p className="mt-0.5 text-xs text-mute" title={fmt.dateTime(a.createdAt)}>
            {a.actor} · {relativeTime(a.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  )
}
