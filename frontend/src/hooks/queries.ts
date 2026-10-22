import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as api from '@/api'
import type { LeadInput } from '@/api'
import type { AppointmentStatus, BusinessSettings, LeadListParams, LeadStatus, RecordingStatus } from '@/lib/types'

export const qk = {
  leads: (p: LeadListParams) => ['leads', p] as const,
  lead: (id: string) => ['lead', id] as const,
  calls: (p: object) => ['calls', p] as const,
  call: (id: string) => ['call', id] as const,
  appointments: (p: object) => ['appointments', p] as const,
  appointment: (id: string) => ['appointment', id] as const,
  availability: (date: string, ex?: string, req?: string) => ['availability', date, ex, req] as const,
  connection: ['connection'] as const,
  settings: ['settings'] as const,
  events: (from: string, to: string) => ['events', from, to] as const,
  summary: ['summary'] as const,
  activity: ['dash-activity'] as const,
  callsByDay: ['calls-by-day'] as const,
  attention: ['attention'] as const,
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

/* ---------- reads ---------- */

export const useLeads = (p: LeadListParams) => useQuery({ queryKey: qk.leads(p), queryFn: () => api.listLeads(p), placeholderData: keepPreviousData })
export const useLead = (id: string) => useQuery({ queryKey: qk.lead(id), queryFn: () => api.getLead(id), retry: false })
export const useCalls = (p: { q?: string; recording?: RecordingStatus | '' }) =>
  useQuery({ queryKey: qk.calls(p), queryFn: () => api.listCalls(p), placeholderData: keepPreviousData })
export const useCall = (id: string | null) => useQuery({ queryKey: qk.call(id ?? ''), queryFn: () => api.getCall(id!), enabled: !!id, retry: false })
export const useAppointments = (p: { from?: string; to?: string; status?: AppointmentStatus | '' }) =>
  useQuery({ queryKey: qk.appointments(p), queryFn: () => api.listAppointments(p), placeholderData: keepPreviousData })
export const useAppointment = (id: string) => useQuery({ queryKey: qk.appointment(id), queryFn: () => api.getAppointment(id), retry: false })
export const useAvailability = (date: string, opts: { excludeAppointmentId?: string; requestedAt?: string } = {}) =>
  useQuery({
    queryKey: qk.availability(date, opts.excludeAppointmentId, opts.requestedAt),
    queryFn: () => api.getAvailability(date, opts),
    enabled: !!date,
    // Availability must never be served stale.
    staleTime: 0,
    gcTime: 0,
  })
export const useConnection = () => useQuery({ queryKey: qk.connection, queryFn: api.getConnection })
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.getSettings })
export const useExternalEvents = (from: string, to: string) => useQuery({ queryKey: qk.events(from, to), queryFn: () => api.listExternalEvents(from, to), placeholderData: keepPreviousData })
export const useSummary = () => useQuery({ queryKey: qk.summary, queryFn: api.getDashboardSummary })
export const useDashboardActivity = () => useQuery({ queryKey: qk.activity, queryFn: () => api.getDashboardActivity(10) })
export const useCallsByDay = () => useQuery({ queryKey: qk.callsByDay, queryFn: () => api.getCallsByDay(14) })
export const useAttention = () => useQuery({ queryKey: qk.attention, queryFn: api.getAttention })

/* ---------- writes ---------- */

function useAction<TArgs = void, TResult = unknown>(fn: (a: TArgs) => Promise<TResult>, opts: { success?: string | ((r: TResult) => string); onSuccess?: (r: TResult) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      // Everything derives from the same store, so refresh all server state.
      void qc.invalidateQueries()
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success)
      opts.onSuccess?.(r)
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      // A failed booking usually means the calendar changed underneath us.
      void qc.invalidateQueries({ queryKey: ['availability'] })
    },
  })
}

export const useCreateLead = (onSuccess?: (id: string) => void) =>
  useAction((v: LeadInput) => api.createLead(v), { success: 'Lead created', onSuccess: (l) => onSuccess?.(l.id) })
export const useUpdateLead = (id: string, success = 'Lead updated') =>
  useAction((patch: Partial<LeadInput> & { status?: LeadStatus }) => api.updateLead(id, patch), { success })
export const useDeleteLead = (onSuccess?: () => void) => useAction((id: string) => api.deleteLead(id), { success: 'Lead deleted', onSuccess })
export const useAddNote = (leadId: string) => useAction((body: string) => api.addNote(leadId, body), { success: 'Note added' })

export const useCreateAppointment = (onSuccess?: () => void) =>
  useAction((v: { leadId: string; startAt: string }) => api.createAppointment(v), { success: 'Follow-up scheduled', onSuccess })
export const useAutoAssign = () =>
  useAction((leadId: string) => api.autoAssignAppointment(leadId), { success: 'Earliest open slot reserved' })
export const useReschedule = (onSuccess?: () => void) =>
  useAction((v: { id: string; startAt: string }) => api.rescheduleAppointment(v.id, v.startAt), { success: 'Appointment rescheduled', onSuccess })
export const useCancelAppointment = (onSuccess?: () => void) =>
  useAction((v: { id: string; reason: string }) => api.cancelAppointment(v.id, v.reason), { success: 'Appointment cancelled', onSuccess })
export const useCompleteAppointment = () => useAction((id: string) => api.completeAppointment(id), { success: 'Appointment marked complete' })

export const useRefreshRecording = () => useAction((id: string) => api.refreshRecording(id), { success: 'Recording is ready' })

export const useConnectCalendar = () => useAction(() => api.connectCalendar(), { success: 'Google Calendar connected' })
export const useDisconnectCalendar = () => useAction(() => api.disconnectCalendar(), { success: 'Google Calendar disconnected' })
export const useSelectCalendar = () => useAction((id: string) => api.selectCalendar(id), { success: 'Calendar changed' })
export const useSyncCalendar = () => useAction(() => api.syncCalendar(), { success: 'Calendar synced' })
export const useUpdateSettings = () => useAction((s: BusinessSettings) => api.updateSettings(s), { success: 'Scheduling settings saved' })
