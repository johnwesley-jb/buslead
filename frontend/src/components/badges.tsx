import type { AppointmentStatus, LeadStatus, Priority, ProcessingStatus, RecordingStatus } from '@/lib/types'
import { APPOINTMENT_STATUS_LABEL, LEAD_STATUS_LABEL, PRIORITY_LABEL, PROCESSING_LABEL, RECORDING_LABEL } from '@/lib/format'
import { Badge, type Tone } from './ui'

const leadTone: Record<LeadStatus, Tone> = {
  new: 'blue',
  contacted: 'neutral',
  follow_up_scheduled: 'teal',
  in_progress: 'brass',
  qualified: 'teal',
  converted: 'solid',
  unqualified: 'neutral',
  closed: 'neutral',
}

const apptTone: Record<AppointmentStatus, Tone> = {
  pending: 'brass',
  confirmed: 'teal',
  auto_assigned: 'blue',
  rescheduling_required: 'coral',
  cancelled: 'neutral',
  completed: 'solid',
  failed: 'coral',
}

export const apptToneOf = (s: AppointmentStatus) => apptTone[s]

export const LeadStatusBadge = ({ status }: { status: LeadStatus }) => <Badge tone={leadTone[status]}>{LEAD_STATUS_LABEL[status]}</Badge>
export const AppointmentBadge = ({ status }: { status: AppointmentStatus }) => <Badge tone={apptTone[status]}>{APPOINTMENT_STATUS_LABEL[status]}</Badge>

export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <Badge tone={priority === 'high' ? 'coral' : priority === 'medium' ? 'brass' : 'neutral'} dot={false}>
    {PRIORITY_LABEL[priority]}
  </Badge>
)

export const ProcessingBadge = ({ status }: { status: ProcessingStatus }) => (
  <Badge tone={status === 'processed' ? 'teal' : status === 'failed' ? 'coral' : 'brass'}>{PROCESSING_LABEL[status]}</Badge>
)

export const RecordingBadge = ({ status }: { status: RecordingStatus }) => (
  <Badge tone={status === 'available' ? 'teal' : status === 'processing' ? 'brass' : 'neutral'}>{RECORDING_LABEL[status]}</Badge>
)
