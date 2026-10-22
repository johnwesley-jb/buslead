import type { AppointmentStatus, LeadStatus, Priority, ProcessingStatus, RecordingStatus } from './types'

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name

/** +15551230142 -> (555) 123-0142 */
export const formatPhone = (e164: string) => {
  const d = e164.replace(/\D/g, '')
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (n.length !== 10) return e164
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  follow_up_scheduled: 'Follow-up scheduled',
  in_progress: 'In progress',
  qualified: 'Qualified',
  converted: 'Converted',
  unqualified: 'Unqualified',
  closed: 'Closed',
}

export const LEAD_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[]

/** Which statuses a lead may move to from its current one. */
export const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'follow_up_scheduled', 'unqualified', 'closed'],
  contacted: ['follow_up_scheduled', 'in_progress', 'qualified', 'unqualified', 'closed'],
  follow_up_scheduled: ['contacted', 'in_progress', 'qualified', 'unqualified', 'closed'],
  in_progress: ['follow_up_scheduled', 'qualified', 'converted', 'unqualified', 'closed'],
  qualified: ['in_progress', 'converted', 'unqualified', 'closed'],
  converted: ['closed'],
  unqualified: ['contacted', 'closed'],
  closed: ['contacted'],
}

export const canTransition = (from: LeadStatus, to: LeadStatus) => from === to || LEAD_TRANSITIONS[from].includes(to)

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  auto_assigned: 'Automatically assigned',
  rescheduling_required: 'Rescheduling required',
  cancelled: 'Cancelled',
  completed: 'Completed',
  failed: 'Failed',
}

export const APPOINTMENT_STATUSES = Object.keys(APPOINTMENT_STATUS_LABEL) as AppointmentStatus[]

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

export const PROCESSING_LABEL: Record<ProcessingStatus, string> = {
  received: 'Received',
  processing: 'Processing',
  processed: 'Processed',
  failed: 'Processing failed',
}

export const RECORDING_LABEL: Record<RecordingStatus, string> = {
  available: 'Recording ready',
  processing: 'Recording processing',
  unavailable: 'No recording',
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
]

/** Returns an E.164 number, or null when the input cannot be one. US numbers default to +1. */
export const normalizePhone = (input: string): string | null => {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
