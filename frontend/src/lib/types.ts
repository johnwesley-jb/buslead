export type Role = 'admin' | 'agent'

export interface User {
  id: string
  name: string
  email: string
  role: Role
}

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'follow_up_scheduled'
  | 'in_progress'
  | 'qualified'
  | 'converted'
  | 'unqualified'
  | 'closed'

export type Priority = 'low' | 'medium' | 'high'
export type LeadSource = 'phone' | 'manual'

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'auto_assigned'
  | 'rescheduling_required'
  | 'cancelled'
  | 'completed'
  | 'failed'

export type AssignmentSource = 'caller' | 'automatic' | 'manual'
/** State of the Google Calendar reservation, kept separate from the appointment status. */
export type ConfirmationStatus = 'pending' | 'reserved' | 'failed'

export type CallStatus = 'completed' | 'missed' | 'failed'
export type ProcessingStatus = 'received' | 'processing' | 'processed' | 'failed'
export type RecordingStatus = 'available' | 'processing' | 'unavailable'

export interface TranscriptSegment {
  speaker: 'assistant' | 'caller'
  startSec: number
  text: string
}

export interface ExtractedData {
  fullName: string
  email: string
  phoneNumber: string
  reasonForCall: string
  preferredDate: string | null
  preferredTime: string | null
  timeZone: string
  appointmentStatus: string
}

export interface Note {
  id: string
  authorName: string
  body: string
  createdAt: string
}

export interface Lead {
  id: string
  fullName: string
  email: string
  phoneNumber: string
  reasonForCall: string
  /** Additional details the caller shared. */
  notes: string
  status: LeadStatus
  priority: Priority
  source: LeadSource
  timeZone: string
  internalNotes: Note[]
  createdAt: string
  updatedAt: string
}

export interface Call {
  id: string
  leadId: string
  vapiCallId: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  callStatus: CallStatus
  processingStatus: ProcessingStatus
  transcript: TranscriptSegment[] | null
  recordingStatus: RecordingStatus
  /** Set when the caller hung up before an appointment was agreed. */
  callerDisconnected: boolean
  extractedData: ExtractedData
  createdAt: string
  updatedAt: string
}

export interface Appointment {
  id: string
  leadId: string
  callId: string | null
  googleCalendarEventId: string | null
  requestedStartAt: string | null
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  timeZone: string
  status: AppointmentStatus
  assignmentSource: AssignmentSource
  confirmationStatus: ConfirmationStatus
  rescheduleCount: number
  cancelReason: string | null
  createdAt: string
  updatedAt: string
}

export interface ActivityLog {
  id: string
  leadId: string | null
  callId: string | null
  appointmentId: string | null
  action: string
  details: string
  actor: string
  createdAt: string
}

export interface Holiday {
  date: string // yyyy-mm-dd
  label: string
}

export interface BusinessSettings {
  timeZone: string
  workingDays: number[] // 0 = Sunday
  openingTime: string // HH:mm
  closingTime: string // HH:mm
  appointmentDurationMinutes: number
  bufferMinutes: number
  minimumNoticeMinutes: number
  maximumSchedulingDays: number
  selectedCalendarId: string
  holidays: Holiday[]
  allowCallerReschedule: boolean
  rescheduleCutoffHours: number
  cancellationCutoffHours: number
  maxReschedules: number
  recordingRetentionDays: number
}

export interface CalendarInfo {
  id: string
  name: string
  primary: boolean
}

export interface CalendarConnection {
  connected: boolean
  googleAccountEmail: string | null
  calendarId: string | null
  calendars: CalendarInfo[]
  tokenExpiresAt: string | null
  lastSyncedAt: string | null
  health: 'healthy' | 'needs_reauth' | 'disconnected'
}

export interface ExternalEvent {
  id: string
  title: string
  startAt: string
  endAt: string
}

/* ---------- API shapes ---------- */

export interface LeadListItem extends Lead {
  latestCall: Pick<Call, 'id' | 'durationSeconds' | 'startedAt' | 'recordingStatus'> | null
  appointment: Appointment | null
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface LeadListParams {
  page?: number
  pageSize?: number
  q?: string
  status?: LeadStatus | ''
  appointmentStatus?: AppointmentStatus | 'none' | 'unassigned' | ''
  sort?: 'createdAt' | 'name' | 'followUp'
  dir?: 'asc' | 'desc'
}

export interface LeadDetail {
  lead: Lead
  calls: Call[]
  appointments: Appointment[]
  activity: ActivityLog[]
}

export interface CallListItem extends Call {
  leadName: string
}

export interface AppointmentWithLead extends Appointment {
  leadName: string
  leadEmail: string
  leadPhone: string
}

export interface AppointmentDetail {
  appointment: Appointment
  lead: Lead
  call: Call | null
  activity: ActivityLog[]
}

export interface SlotInfo {
  startAt: string
  endAt: string
  available: boolean
  reason?: 'past' | 'notice' | 'horizon' | 'busy'
}

export interface AvailabilityResult {
  date: string
  slots: SlotInfo[]
  closedReason: 'not_working_day' | 'holiday' | null
  /** Closest open slots around the requested time, when a time was requested. */
  before: SlotInfo | null
  after: SlotInfo | null
}

export interface DashboardSummary {
  totalLeads: number
  newLeads: number
  awaitingFollowUp: number
  scheduledAppointments: number
  completedFollowUps: number
  unassignedFollowUps: number
}

export interface AttentionItem {
  id: string
  leadId: string
  leadName: string
  kind: 'unassigned' | 'processing_failed' | 'reschedule_required' | 'pending_reservation'
  detail: string
  at: string
}

export interface CallsByDay {
  date: string
  calls: number
  booked: number
}
