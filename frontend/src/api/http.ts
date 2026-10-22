/**
 * Real API client. Same exported functions as src/mock/api.ts, so hooks and pages do not change.
 * Requests go to /api (proxied to the backend by Vite in development) with the session cookie.
 */
import type {
  ActivityLog, Appointment, AppointmentDetail, AppointmentStatus, AppointmentWithLead, AttentionItem, AvailabilityResult,
  BusinessSettings, Call, CallListItem, CallsByDay, CalendarConnection, DashboardSummary, ExternalEvent, Lead, LeadDetail,
  LeadListItem, LeadListParams, LeadStatus, Paged, Priority, RecordingStatus, User,
} from '@/lib/types'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

export interface LeadInput {
  fullName: string
  email: string
  phoneNumber: string
  reasonForCall: string
  notes?: string
  priority: Priority
}

type Query = Record<string, string | number | undefined | null>

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const url = `/api${path}${qs.size ? `?${qs}` : ''}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-Requested-With': 'buslead', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError('NETWORK', 'The server could not be reached. Check that the API is running and try again.')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('buslead:unauthorized'))
    throw new ApiError(e?.code ?? `HTTP_${res.status}`, e?.message ?? 'Something went wrong. Try again.')
  }
  return data as T
}

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query })
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} })

/* ---------- auth ---------- */

export const getCurrentUser = async (): Promise<User | null> => {
  try {
    return await get<User>('/auth/me')
  } catch (e) {
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') return null
    throw e
  }
}
export const login = (email: string, password: string) => post<User>('/auth/login', { email, password })
export const logout = () => post<{ ok: boolean }>('/auth/logout').then(() => true)
export const updateProfile = (patch: { name: string }) => request<User>('PATCH', '/auth/me', { body: patch })
export const changePassword = (currentPassword: string, newPassword: string) => post('/auth/change-password', { currentPassword, newPassword }).then(() => true)

/* ---------- leads ---------- */

export const listLeads = (p: LeadListParams = {}) => get<Paged<LeadListItem>>('/leads', { ...p })
export const getLead = (id: string) => get<LeadDetail>(`/leads/${id}`)
export const createLead = (input: LeadInput) => post<Lead>('/leads', input)
export const updateLead = (id: string, patch: Partial<LeadInput> & { status?: LeadStatus }) => request<Lead>('PATCH', `/leads/${id}`, { body: patch })
export const deleteLead = (id: string) => request('DELETE', `/leads/${id}`).then(() => true)
export const addNote = (leadId: string, body: string) => post<Lead>(`/leads/${leadId}/notes`, { body })

/* ---------- calls ---------- */

export const listCalls = (p: { q?: string; recording?: RecordingStatus | '' } = {}) => get<CallListItem[]>('/calls', { ...p })
export const getCall = (id: string) => get<{ call: Call; lead: Lead | null; appointment: Appointment | null }>(`/calls/${id}`)
export const refreshRecording = (callId: string) => post<Call>(`/calls/${callId}/refresh-recording`)
/** URL of the authorized audio stream for an <audio> element. */
export const recordingUrl = (callId: string) => `/api/calls/${callId}/recording`

/* ---------- appointments ---------- */

export const listAppointments = (p: { from?: string; to?: string; status?: AppointmentStatus | '' } = {}) => get<AppointmentWithLead[]>('/appointments', { ...p })
export const getAppointment = (id: string) => get<AppointmentDetail>(`/appointments/${id}`)
export const getAvailability = (date: string, opts: { excludeAppointmentId?: string; requestedAt?: string } = {}) =>
  get<AvailabilityResult>('/appointments/availability', { date, ...opts })
export const createAppointment = (input: { leadId: string; startAt: string; source?: 'manual' }) => post<Appointment>('/appointments', { leadId: input.leadId, startAt: input.startAt })
export const autoAssignAppointment = (leadId: string) => post<Appointment>('/appointments/auto-assign', { leadId })
export const rescheduleAppointment = (id: string, startAt: string) => post<Appointment>(`/appointments/${id}/reschedule`, { startAt })
export const cancelAppointment = (id: string, reason: string) => post<Appointment>(`/appointments/${id}/cancel`, { reason })
export const completeAppointment = (id: string) => post<Appointment>(`/appointments/${id}/complete`)

/* ---------- calendar ---------- */

export const getConnection = () => get<CalendarConnection>('/calendar')
/** Starts Google sign-in: the browser leaves for Google and returns to /settings/calendar. */
export const connectCalendar = async (): Promise<CalendarConnection> => {
  const { url } = await post<{ url: string }>('/calendar/connect')
  window.location.assign(url)
  return new Promise<CalendarConnection>(() => undefined) // the page is navigating away
}
export const disconnectCalendar = () => post<CalendarConnection>('/calendar/disconnect')
export const selectCalendar = (calendarId: string) => request<CalendarConnection>('PUT', '/calendar/selected', { body: { calendarId } })
export const syncCalendar = () => post<CalendarConnection>('/calendar/sync')
export const listExternalEvents = async (from: string, to: string) => {
  try {
    return await get<ExternalEvent[]>('/calendar/events', { from, to })
  } catch (e) {
    if (e instanceof ApiError && e.code === 'CALENDAR_UNAVAILABLE') return []
    throw e
  }
}

/* ---------- settings & dashboard ---------- */

export const getSettings = () => get<BusinessSettings>('/settings')
export const updateSettings = (s: BusinessSettings) => request<BusinessSettings>('PUT', '/settings', { body: s })
export const getDashboardSummary = () => get<DashboardSummary>('/dashboard/summary')
export const getDashboardActivity = (limit = 12) => get<Array<ActivityLog & { leadName: string | null }>>('/dashboard/activity', { limit })
export const getCallsByDay = (days = 14) => get<CallsByDay[]>('/dashboard/calls-by-day', { days })
export const getAttention = () => get<AttentionItem[]>('/dashboard/attention')
