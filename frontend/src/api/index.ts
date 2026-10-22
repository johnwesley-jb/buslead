/**
 * Picks the data source. Real API by default when VITE_USE_MOCK=false, simulated browser data otherwise.
 *   frontend/.env.local:   VITE_USE_MOCK=false      (talk to the backend through the /api proxy)
 */
import * as mock from '@/mock/api'
import * as http from './http'

export const isMock = import.meta.env.VITE_USE_MOCK !== 'false'
const s = isMock ? mock : http

export type { LeadInput } from './http'
export const ApiError = s.ApiError
export const login = s.login
export const logout = s.logout
export const updateProfile = s.updateProfile
export const changePassword = s.changePassword
export const listLeads = s.listLeads
export const getLead = s.getLead
export const createLead = s.createLead
export const updateLead = s.updateLead
export const deleteLead = s.deleteLead
export const addNote = s.addNote
export const listCalls = s.listCalls
export const getCall = s.getCall
export const refreshRecording = s.refreshRecording
export const listAppointments = s.listAppointments
export const getAppointment = s.getAppointment
export const getAvailability = s.getAvailability
export const createAppointment = s.createAppointment
export const autoAssignAppointment = s.autoAssignAppointment
export const rescheduleAppointment = s.rescheduleAppointment
export const cancelAppointment = s.cancelAppointment
export const completeAppointment = s.completeAppointment
export const getConnection = s.getConnection
export const connectCalendar = s.connectCalendar
export const disconnectCalendar = s.disconnectCalendar
export const selectCalendar = s.selectCalendar
export const syncCalendar = s.syncCalendar
export const listExternalEvents = s.listExternalEvents
export const getSettings = s.getSettings
export const updateSettings = s.updateSettings
export const getDashboardSummary = s.getDashboardSummary
export const getDashboardActivity = s.getDashboardActivity
export const getCallsByDay = s.getCallsByDay
export const getAttention = s.getAttention

/** Signed-in user at startup: the stored demo user, or the server session. */
export const getCurrentUser = (): Promise<import('@/lib/types').User | null> =>
  isMock ? Promise.resolve(mock.getStoredUser()) : http.getCurrentUser()
export const resetDemoData = mock.resetDemoData
/** Audio URL for a call in real mode; null in the preview, which simulates playback. */
export const recordingUrl = (callId: string) => (isMock ? null : http.recordingUrl(callId))
