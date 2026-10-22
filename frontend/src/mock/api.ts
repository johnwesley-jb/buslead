/**
 * Simulated backend. Every function is async, adds latency, validates like the real API
 * will, and persists to localStorage. Swap this module for fetch calls when the Express
 * backend exists; the hooks and pages only depend on these signatures.
 */
import { addDays, addMinutes, isSameDay, parseDateInput, startOfDay, toDateInput } from '@/lib/dates'
import { canTransition, LEAD_STATUS_LABEL } from '@/lib/format'
import type {
  ActivityLog,
  Appointment,
  AppointmentDetail,
  AppointmentStatus,
  AppointmentWithLead,
  AttentionItem,
  AvailabilityResult,
  BusinessSettings,
  Call,
  CallListItem,
  CallsByDay,
  CalendarConnection,
  DashboardSummary,
  ExternalEvent,
  Lead,
  LeadDetail,
  LeadListItem,
  LeadListParams,
  LeadStatus,
  Paged,
  Priority,
  RecordingStatus,
  SlotInfo,
  User,
} from '@/lib/types'
import { DB_VERSION, DEMO_USERS, defaultConnection, seedDb, type Db } from './seed'
import { closedReason, daySlots, earliestSlot, isSlotAvailable, nearestAlternatives, type BusyBlock, type Slot } from './scheduler'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

const DB_KEY = 'buslead.mock.db.v1'
const SESSION_KEY = 'buslead.mock.session.v1'
const ACTIVE: AppointmentStatus[] = ['pending', 'confirmed', 'auto_assigned']

/* ---------- storage ---------- */

let db: Db | null = null

function load(): Db {
  if (db) return db
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Db
      if (parsed.version === DB_VERSION) {
        db = parsed
        return db
      }
    }
  } catch {
    /* fall through to a fresh seed */
  }
  db = seedDb(new Date())
  save()
  return db
}

function save() {
  try {
    if (db) localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    /* storage unavailable: data lives in memory for this tab */
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const delay = <T,>(value: () => T, ms = 140 + Math.random() * 220): Promise<T> =>
  new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(clone(value()))
      } catch (e) {
        reject(e)
      }
    }, ms),
  )

let idSeq = Date.now()
const newId = (prefix: string) => `${prefix}-${(idSeq++).toString(36)}`
const nowIso = () => new Date().toISOString()

export function resetDemoData() {
  db = seedDb(new Date())
  save()
}

/* ---------- auth ---------- */

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

function actor(): User {
  const u = getStoredUser()
  if (!u) throw new ApiError('UNAUTHORIZED', 'Your session has ended. Sign in again.')
  return u
}

function requireAdmin() {
  if (actor().role !== 'admin') throw new ApiError('FORBIDDEN', 'Only admins can do this.')
}

export const login = (email: string, password: string) =>
  delay(() => {
    const found = DEMO_USERS.find((u) => u.email === email.trim().toLowerCase())
    if (!found || found.password !== password) {
      throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match. Check both and try again.')
    }
    const { password: _pw, ...user } = found
    localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    return user as User
  }, 450)

export const logout = () =>
  delay(() => {
    localStorage.removeItem(SESSION_KEY)
    return true
  }, 80)

export const updateProfile = (patch: { name: string }) =>
  delay(() => {
    const u = { ...actor(), name: patch.name.trim() }
    localStorage.setItem(SESSION_KEY, JSON.stringify(u))
    return u
  })

export const changePassword = (current: string, next: string) =>
  delay(() => {
    const u = actor()
    const found = DEMO_USERS.find((d) => d.id === u.id)
    if (!found || found.password !== current) throw new ApiError('INVALID_CREDENTIALS', 'Your current password is not correct.')
    if (next.length < 10) throw new ApiError('VALIDATION', 'Use at least 10 characters.')
    found.password = next
    log({ leadId: null, callId: null, appointmentId: null, action: 'user.password_changed', details: 'Password changed' })
    return true
  }, 400)

/* ---------- helpers ---------- */

function log(a: Omit<ActivityLog, 'id' | 'actor' | 'createdAt'> & { actor?: string }) {
  const d = load()
  d.activity.unshift({ id: newId('act'), actor: a.actor ?? getStoredUser()?.name ?? 'System', createdAt: nowIso(), ...a })
}

function busyBlocks(excludeAppointmentId?: string): BusyBlock[] {
  const d = load()
  const out: BusyBlock[] = d.externalEvents.map((e) => ({ start: new Date(e.startAt), end: new Date(e.endAt), kind: 'external' }))
  for (const a of d.appointments) {
    if (a.id === excludeAppointmentId) continue
    if (ACTIVE.includes(a.status) && a.scheduledStartAt && a.scheduledEndAt) {
      out.push({ start: new Date(a.scheduledStartAt), end: new Date(a.scheduledEndAt), kind: 'appointment' })
    }
  }
  return out
}

const toSlotInfo = (s: Slot | null): SlotInfo | null =>
  s ? { startAt: s.start.toISOString(), endAt: s.end.toISOString(), available: s.available, reason: s.reason } : null

/** Appointment shown for a lead: an active one if present, otherwise the most recent. */
function currentAppointment(leadId: string): Appointment | null {
  const list = load().appointments.filter((a) => a.leadId === leadId)
  if (!list.length) return null
  const active = list.filter((a) => ACTIVE.includes(a.status))
  const pool = active.length ? active : list
  return pool.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

function requireConnection() {
  const c = load().connection
  if (!c.connected || c.health !== 'healthy') {
    throw new ApiError('CALENDAR_UNAVAILABLE', 'Google Calendar is not connected. Reconnect it in Calendar settings before scheduling.')
  }
}

function toListItem(lead: Lead): LeadListItem {
  const d = load()
  const calls = d.calls.filter((c) => c.leadId === lead.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const c = calls[0]
  return {
    ...lead,
    latestCall: c ? { id: c.id, durationSeconds: c.durationSeconds, startedAt: c.startedAt, recordingStatus: c.recordingStatus } : null,
    appointment: currentAppointment(lead.id),
  }
}

/* ---------- leads ---------- */

export const listLeads = (p: LeadListParams = {}) =>
  delay((): Paged<LeadListItem> => {
    const page = Math.max(1, p.page ?? 1)
    const pageSize = p.pageSize ?? 10
    const q = (p.q ?? '').trim().toLowerCase()
    let items = load().leads.map(toListItem)

    if (q) {
      items = items.filter((l) =>
        [l.fullName, l.email, l.phoneNumber, l.reasonForCall].some((v) => v.toLowerCase().includes(q)) ||
        l.phoneNumber.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'),
      )
    }
    if (p.status) items = items.filter((l) => l.status === p.status)
    if (p.appointmentStatus === 'unassigned') {
      const open: LeadStatus[] = ['new', 'contacted', 'follow_up_scheduled', 'in_progress']
      items = items.filter((l) => open.includes(l.status) && !(l.appointment && ACTIVE.includes(l.appointment.status)))
    } else if (p.appointmentStatus === 'none') items = items.filter((l) => !l.appointment)
    else if (p.appointmentStatus) items = items.filter((l) => l.appointment?.status === p.appointmentStatus)

    const dir = p.dir === 'asc' ? 1 : -1
    const sort = p.sort ?? 'createdAt'
    items.sort((a, b) => {
      if (sort === 'name') return a.fullName.localeCompare(b.fullName) * (p.dir === 'desc' ? -1 : 1)
      if (sort === 'followUp') {
        const av = a.appointment?.scheduledStartAt ?? ''
        const bv = b.appointment?.scheduledStartAt ?? ''
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
        return av.localeCompare(bv) * (p.dir === 'desc' ? -1 : 1)
      }
      return a.createdAt.localeCompare(b.createdAt) * dir
    })

    const total = items.length
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize }
  })

export const getLead = (id: string) =>
  delay((): LeadDetail => {
    const d = load()
    const lead = d.leads.find((l) => l.id === id)
    if (!lead) throw new ApiError('NOT_FOUND', 'This lead no longer exists. It may have been deleted.')
    return {
      lead,
      calls: d.calls.filter((c) => c.leadId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      appointments: d.appointments.filter((a) => a.leadId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      activity: d.activity.filter((a) => a.leadId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  })

export interface LeadInput {
  fullName: string
  email: string
  phoneNumber: string
  reasonForCall: string
  notes?: string
  priority: Priority
}

export const createLead = (input: LeadInput) =>
  delay(() => {
    const d = load()
    const user = actor()
    if (d.leads.some((l) => l.email.toLowerCase() === input.email.toLowerCase())) {
      throw new ApiError('DUPLICATE', 'A lead with this email already exists. Open that lead instead of creating another.')
    }
    const lead: Lead = {
      id: newId('lead'),
      ...input,
      notes: input.notes ?? '',
      status: 'new',
      source: 'manual',
      timeZone: d.settings.timeZone,
      internalNotes: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    d.leads.unshift(lead)
    log({ leadId: lead.id, callId: null, appointmentId: null, action: 'lead.created', details: 'Lead added manually', actor: user.name })
    save()
    return lead
  }, 350)

export const updateLead = (id: string, patch: Partial<Omit<LeadInput, never>> & { status?: LeadStatus }) =>
  delay(() => {
    const d = load()
    const user = actor()
    const lead = d.leads.find((l) => l.id === id)
    if (!lead) throw new ApiError('NOT_FOUND', 'This lead no longer exists.')
    if (patch.status && !canTransition(lead.status, patch.status)) {
      throw new ApiError('INVALID_TRANSITION', `A ${LEAD_STATUS_LABEL[lead.status].toLowerCase()} lead cannot move straight to ${LEAD_STATUS_LABEL[patch.status].toLowerCase()}.`)
    }
    const changes: string[] = []
    if (patch.status && patch.status !== lead.status) changes.push(`status ${LEAD_STATUS_LABEL[lead.status]} → ${LEAD_STATUS_LABEL[patch.status]}`)
    if (patch.priority && patch.priority !== lead.priority) changes.push(`priority ${lead.priority} → ${patch.priority}`)
    for (const k of ['fullName', 'email', 'phoneNumber', 'reasonForCall', 'notes'] as const) {
      if (patch[k] !== undefined && patch[k] !== lead[k]) changes.push(`${k === 'fullName' ? 'name' : k === 'phoneNumber' ? 'phone' : k === 'reasonForCall' ? 'reason' : k} updated`)
    }
    Object.assign(lead, patch, { updatedAt: nowIso() })
    if (changes.length) log({ leadId: id, callId: null, appointmentId: null, action: 'lead.updated', details: changes.join('; '), actor: user.name })
    save()
    return lead
  }, 260)

export const deleteLead = (id: string) =>
  delay(() => {
    requireAdmin()
    const d = load()
    const lead = d.leads.find((l) => l.id === id)
    if (!lead) throw new ApiError('NOT_FOUND', 'This lead no longer exists.')
    d.leads = d.leads.filter((l) => l.id !== id)
    d.calls = d.calls.filter((c) => c.leadId !== id)
    d.appointments = d.appointments.filter((a) => a.leadId !== id)
    d.activity = d.activity.filter((a) => a.leadId !== id)
    log({ leadId: null, callId: null, appointmentId: null, action: 'lead.deleted', details: `Deleted lead ${lead.fullName} and related records` })
    save()
    return true
  }, 300)

export const addNote = (leadId: string, body: string) =>
  delay(() => {
    const d = load()
    const user = actor()
    const lead = d.leads.find((l) => l.id === leadId)
    if (!lead) throw new ApiError('NOT_FOUND', 'This lead no longer exists.')
    lead.internalNotes.unshift({ id: newId('note'), authorName: user.name, body: body.trim(), createdAt: nowIso() })
    log({ leadId, callId: null, appointmentId: null, action: 'lead.note_added', details: 'Added an internal note', actor: user.name })
    save()
    return lead
  }, 200)

/* ---------- calls ---------- */

export const listCalls = (p: { q?: string; recording?: RecordingStatus | '' } = {}) =>
  delay((): CallListItem[] => {
    const d = load()
    const q = (p.q ?? '').trim().toLowerCase()
    return d.calls
      .map((c) => ({ ...c, leadName: d.leads.find((l) => l.id === c.leadId)?.fullName ?? 'Unknown caller' }))
      .filter((c) => (!p.recording || c.recordingStatus === p.recording) && (!q || c.leadName.toLowerCase().includes(q) || c.vapiCallId.toLowerCase().includes(q)))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  })

export const getCall = (id: string) =>
  delay(() => {
    const d = load()
    const call = d.calls.find((c) => c.id === id)
    if (!call) throw new ApiError('NOT_FOUND', 'This call could not be found.')
    return { call, lead: d.leads.find((l) => l.id === call.leadId) ?? null, appointment: d.appointments.find((a) => a.callId === id) ?? null }
  })

/** Simulates asking the backend to re-fetch a recording that is still processing. */
export const refreshRecording = (callId: string) =>
  delay(() => {
    const call = load().calls.find((c) => c.id === callId)
    if (!call) throw new ApiError('NOT_FOUND', 'This call could not be found.')
    if (call.recordingStatus === 'processing') {
      call.recordingStatus = 'available'
      call.processingStatus = 'processed'
      save()
    }
    return call
  }, 700)

/* ---------- appointments ---------- */

const withLead = (a: Appointment): AppointmentWithLead => {
  const lead = load().leads.find((l) => l.id === a.leadId)
  return { ...a, leadName: lead?.fullName ?? 'Unknown', leadEmail: lead?.email ?? '', leadPhone: lead?.phoneNumber ?? '' }
}

export const listAppointments = (p: { from?: string; to?: string; status?: AppointmentStatus | '' } = {}) =>
  delay((): AppointmentWithLead[] => {
    const from = p.from ? new Date(p.from).getTime() : -Infinity
    const to = p.to ? new Date(p.to).getTime() : Infinity
    return load()
      .appointments.filter((a) => {
        if (p.status && a.status !== p.status) return false
        if (!a.scheduledStartAt) return !p.from && !p.to
        const t = new Date(a.scheduledStartAt).getTime()
        return t >= from && t < to
      })
      .map(withLead)
      .sort((a, b) => (a.scheduledStartAt ?? '').localeCompare(b.scheduledStartAt ?? ''))
  })

export const getAppointment = (id: string) =>
  delay((): AppointmentDetail => {
    const d = load()
    const appointment = d.appointments.find((a) => a.id === id)
    if (!appointment) throw new ApiError('NOT_FOUND', 'This appointment could not be found.')
    const lead = d.leads.find((l) => l.id === appointment.leadId)
    if (!lead) throw new ApiError('NOT_FOUND', 'The lead for this appointment no longer exists.')
    return {
      appointment,
      lead,
      call: appointment.callId ? d.calls.find((c) => c.id === appointment.callId) ?? null : null,
      activity: d.activity.filter((a) => a.appointmentId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  })

export const getAvailability = (dateStr: string, opts: { excludeAppointmentId?: string; requestedAt?: string } = {}) =>
  delay((): AvailabilityResult => {
    const d = load()
    const day = parseDateInput(dateStr)
    const busy = busyBlocks(opts.excludeAppointmentId)
    const now = new Date()
    const reason = closedReason(day, d.settings)
    const slots = daySlots(day, d.settings, busy, now).map((s) => toSlotInfo(s)!)
    let before: SlotInfo | null = null
    let after: SlotInfo | null = null
    if (opts.requestedAt) {
      const alt = nearestAlternatives(new Date(opts.requestedAt), d.settings, busy, now)
      before = toSlotInfo(alt.before)
      after = toSlotInfo(alt.after)
    }
    return { date: dateStr, slots, closedReason: reason, before, after }
  }, 200)

/** Re-checks availability and "reserves" a slot. Fails loudly instead of faking success. */
function reserve(startAt: string, excludeAppointmentId?: string): { start: Date; end: Date; eventId: string } {
  const d = load()
  requireConnection()
  const start = new Date(startAt)
  if (!isSlotAvailable(start, d.settings, busyBlocks(excludeAppointmentId), new Date())) {
    throw new ApiError('SLOT_TAKEN', 'That time is no longer available. Pick another open slot.')
  }
  return {
    start,
    end: addMinutes(start, d.settings.appointmentDurationMinutes),
    eventId: `evt_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`,
  }
}

const fmtWhen = (d: Date) =>
  `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`

export const createAppointment = (input: { leadId: string; startAt: string; source?: 'manual' }) =>
  delay((): Appointment => {
    const d = load()
    const user = actor()
    const lead = d.leads.find((l) => l.id === input.leadId)
    if (!lead) throw new ApiError('NOT_FOUND', 'This lead no longer exists.')
    // Replace any appointment still waiting for a slot instead of creating a second one.
    const waiting = d.appointments.find((a) => a.leadId === lead.id && a.status === 'rescheduling_required')
    if (d.appointments.some((a) => a.leadId === lead.id && ACTIVE.includes(a.status))) {
      throw new ApiError('DUPLICATE', 'This lead already has an active appointment. Reschedule it instead.')
    }
    const r = reserve(input.startAt)
    const appt: Appointment = waiting ?? {
      id: newId('appt'), leadId: lead.id, callId: null, googleCalendarEventId: null, requestedStartAt: null,
      scheduledStartAt: null, scheduledEndAt: null, timeZone: d.settings.timeZone, status: 'confirmed',
      assignmentSource: 'manual', confirmationStatus: 'reserved', rescheduleCount: 0, cancelReason: null,
      createdAt: nowIso(), updatedAt: nowIso(),
    }
    Object.assign(appt, {
      scheduledStartAt: r.start.toISOString(), scheduledEndAt: r.end.toISOString(), googleCalendarEventId: r.eventId,
      status: 'confirmed', assignmentSource: 'manual', confirmationStatus: 'reserved', updatedAt: nowIso(),
    })
    if (!waiting) d.appointments.push(appt)
    if (['new', 'contacted'].includes(lead.status)) lead.status = 'follow_up_scheduled'
    lead.updatedAt = nowIso()
    log({ leadId: lead.id, callId: null, appointmentId: appt.id, action: 'appointment.confirmed', details: `Scheduled manually for ${fmtWhen(r.start)}; Google Calendar event created`, actor: user.name })
    save()
    return appt
  }, 650)

export const autoAssignAppointment = (leadId: string) =>
  delay((): Appointment => {
    const d = load()
    const user = actor()
    const lead = d.leads.find((l) => l.id === leadId)
    if (!lead) throw new ApiError('NOT_FOUND', 'This lead no longer exists.')
    if (d.appointments.some((a) => a.leadId === leadId && ACTIVE.includes(a.status))) {
      throw new ApiError('DUPLICATE', 'This lead already has an active appointment, so nothing was assigned.')
    }
    requireConnection()
    const slot = earliestSlot(d.settings, busyBlocks(), new Date())
    if (!slot) throw new ApiError('NO_SLOT', 'No open slot was found within the scheduling window. Widen the window in Business settings.')
    const r = reserve(slot.start.toISOString())
    const waiting = d.appointments.find((a) => a.leadId === leadId && a.status === 'rescheduling_required')
    const appt: Appointment = waiting ?? {
      id: newId('appt'), leadId, callId: null, googleCalendarEventId: null, requestedStartAt: null,
      scheduledStartAt: null, scheduledEndAt: null, timeZone: d.settings.timeZone, status: 'auto_assigned',
      assignmentSource: 'automatic', confirmationStatus: 'reserved', rescheduleCount: 0, cancelReason: null,
      createdAt: nowIso(), updatedAt: nowIso(),
    }
    Object.assign(appt, {
      scheduledStartAt: r.start.toISOString(), scheduledEndAt: r.end.toISOString(), googleCalendarEventId: r.eventId,
      status: 'auto_assigned', assignmentSource: 'automatic', confirmationStatus: 'reserved', updatedAt: nowIso(),
    })
    if (!waiting) d.appointments.push(appt)
    if (['new', 'contacted'].includes(lead.status)) lead.status = 'follow_up_scheduled'
    lead.updatedAt = nowIso()
    for (const c of d.calls) if (c.leadId === leadId && c.processingStatus === 'failed') c.processingStatus = 'processed'
    log({ leadId, callId: null, appointmentId: appt.id, action: 'appointment.auto_assigned', details: `Earliest valid slot reserved: ${fmtWhen(r.start)}`, actor: user.name })
    save()
    return appt
  }, 800)

export const rescheduleAppointment = (id: string, startAt: string) =>
  delay((): Appointment => {
    const d = load()
    const user = actor()
    const appt = d.appointments.find((a) => a.id === id)
    if (!appt) throw new ApiError('NOT_FOUND', 'This appointment could not be found.')
    if (!ACTIVE.includes(appt.status) && appt.status !== 'rescheduling_required') {
      throw new ApiError('INVALID_STATE', `A ${appt.status.replace('_', ' ')} appointment cannot be rescheduled.`)
    }
    if (appt.rescheduleCount >= d.settings.maxReschedules) {
      throw new ApiError('LIMIT', `This appointment has already been rescheduled ${d.settings.maxReschedules} times, which is the limit in Business settings.`)
    }
    const r = reserve(startAt, appt.id)
    const previous = appt.scheduledStartAt ? fmtWhen(new Date(appt.scheduledStartAt)) : 'unscheduled'
    Object.assign(appt, {
      scheduledStartAt: r.start.toISOString(), scheduledEndAt: r.end.toISOString(),
      googleCalendarEventId: appt.googleCalendarEventId ?? r.eventId,
      status: 'confirmed', confirmationStatus: 'reserved', assignmentSource: 'manual',
      rescheduleCount: appt.rescheduleCount + 1, updatedAt: nowIso(),
    })
    log({ leadId: appt.leadId, callId: null, appointmentId: id, action: 'appointment.rescheduled', details: `Moved from ${previous} to ${fmtWhen(r.start)}; Google Calendar event updated`, actor: user.name })
    save()
    return appt
  }, 650)

export const cancelAppointment = (id: string, reason: string) =>
  delay((): Appointment => {
    const d = load()
    const user = actor()
    const appt = d.appointments.find((a) => a.id === id)
    if (!appt) throw new ApiError('NOT_FOUND', 'This appointment could not be found.')
    if (!ACTIVE.includes(appt.status) && appt.status !== 'rescheduling_required') {
      throw new ApiError('INVALID_STATE', 'Only active appointments can be cancelled.')
    }
    if (appt.scheduledStartAt) {
      const hoursAway = (new Date(appt.scheduledStartAt).getTime() - Date.now()) / 3_600_000
      if (hoursAway >= 0 && hoursAway < d.settings.cancellationCutoffHours && user.role !== 'admin') {
        throw new ApiError('CUTOFF', `Appointments inside ${d.settings.cancellationCutoffHours} hours can only be cancelled by an admin.`)
      }
    }
    appt.status = 'cancelled'
    appt.cancelReason = reason.trim() || 'Cancelled'
    appt.updatedAt = nowIso()
    log({ leadId: appt.leadId, callId: null, appointmentId: id, action: 'appointment.cancelled', details: `${appt.cancelReason}; Google Calendar event removed`, actor: user.name })
    appt.googleCalendarEventId = null
    save()
    return appt
  }, 450)

export const completeAppointment = (id: string) =>
  delay((): Appointment => {
    const d = load()
    const user = actor()
    const appt = d.appointments.find((a) => a.id === id)
    if (!appt) throw new ApiError('NOT_FOUND', 'This appointment could not be found.')
    if (!['confirmed', 'auto_assigned'].includes(appt.status)) throw new ApiError('INVALID_STATE', 'Only confirmed appointments can be marked complete.')
    appt.status = 'completed'
    appt.updatedAt = nowIso()
    const lead = d.leads.find((l) => l.id === appt.leadId)
    if (lead && ['new', 'follow_up_scheduled'].includes(lead.status)) lead.status = 'contacted'
    log({ leadId: appt.leadId, callId: null, appointmentId: id, action: 'appointment.completed', details: 'Follow-up marked complete', actor: user.name })
    save()
    return appt
  }, 300)

/* ---------- calendar & settings ---------- */

export const getConnection = () => delay((): CalendarConnection => load().connection)

export const connectCalendar = () =>
  delay((): CalendarConnection => {
    requireAdmin()
    const d = load()
    d.connection = { ...defaultConnection(new Date()), calendarId: d.settings.selectedCalendarId }
    log({ leadId: null, callId: null, appointmentId: null, action: 'calendar.connected', details: `Connected ${d.connection.googleAccountEmail}` })
    save()
    return d.connection
  }, 900)

export const disconnectCalendar = () =>
  delay((): CalendarConnection => {
    requireAdmin()
    const d = load()
    d.connection = { ...d.connection, connected: false, health: 'disconnected', tokenExpiresAt: null }
    log({ leadId: null, callId: null, appointmentId: null, action: 'calendar.disconnected', details: 'Google Calendar disconnected. New bookings are paused.' })
    save()
    return d.connection
  }, 450)

export const selectCalendar = (calendarId: string) =>
  delay((): CalendarConnection => {
    requireAdmin()
    const d = load()
    if (!d.connection.calendars.some((c) => c.id === calendarId)) throw new ApiError('NOT_FOUND', 'That calendar is not on the connected account.')
    d.connection.calendarId = calendarId
    d.settings.selectedCalendarId = calendarId
    log({ leadId: null, callId: null, appointmentId: null, action: 'calendar.selected', details: `Using calendar ${d.connection.calendars.find((c) => c.id === calendarId)?.name}` })
    save()
    return d.connection
  }, 300)

export const syncCalendar = () =>
  delay((): CalendarConnection => {
    const d = load()
    requireConnection()
    d.connection.lastSyncedAt = nowIso()
    save()
    return d.connection
  }, 900)

export const listExternalEvents = (from: string, to: string) =>
  delay((): ExternalEvent[] =>
    load().externalEvents.filter((e) => e.startAt >= from && e.startAt < to),
  )

export const getSettings = () => delay((): BusinessSettings => load().settings)

export const updateSettings = (patch: BusinessSettings) =>
  delay((): BusinessSettings => {
    requireAdmin()
    const d = load()
    if (patch.openingTime >= patch.closingTime) throw new ApiError('VALIDATION', 'Closing time must be after opening time.')
    d.settings = { ...patch, selectedCalendarId: d.settings.selectedCalendarId }
    log({ leadId: null, callId: null, appointmentId: null, action: 'settings.updated', details: 'Business scheduling settings updated' })
    save()
    return d.settings
  }, 450)

/* ---------- dashboard ---------- */

export const getDashboardSummary = () =>
  delay((): DashboardSummary => {
    const d = load()
    const now = Date.now()
    const open: LeadStatus[] = ['new', 'contacted', 'follow_up_scheduled', 'in_progress']
    const hasActive = (id: string) => d.appointments.some((a) => a.leadId === id && ACTIVE.includes(a.status))
    return {
      totalLeads: d.leads.length,
      newLeads: d.leads.filter((l) => l.status === 'new').length,
      awaitingFollowUp: d.leads.filter((l) => open.includes(l.status)).length,
      scheduledAppointments: d.appointments.filter(
        (a) => ['confirmed', 'auto_assigned'].includes(a.status) && a.scheduledStartAt && new Date(a.scheduledStartAt).getTime() >= now,
      ).length,
      completedFollowUps: d.appointments.filter((a) => a.status === 'completed').length,
      unassignedFollowUps: d.leads.filter((l) => open.includes(l.status) && !hasActive(l.id)).length,
    }
  })

export const getDashboardActivity = (limit = 12) =>
  delay((): Array<ActivityLog & { leadName: string | null }> => {
    const d = load()
    return d.activity.slice(0, limit).map((a) => ({ ...a, leadName: a.leadId ? d.leads.find((l) => l.id === a.leadId)?.fullName ?? null : null }))
  })

export const getCallsByDay = (days = 14) =>
  delay((): CallsByDay[] => {
    const d = load()
    const today = startOfDay(new Date())
    return Array.from({ length: days }, (_, i) => {
      const day = addDays(today, i - (days - 1))
      const todays = d.calls.filter((c) => isSameDay(new Date(c.startedAt), day))
      const booked = todays.filter((c) => d.appointments.some((a) => a.callId === c.id && ['confirmed', 'auto_assigned', 'completed', 'pending'].includes(a.status))).length
      return { date: toDateInput(day), calls: todays.length, booked }
    })
  })

export const getAttention = () =>
  delay((): AttentionItem[] => {
    const d = load()
    const items: AttentionItem[] = []
    for (const a of d.appointments) {
      const lead = d.leads.find((l) => l.id === a.leadId)
      if (!lead) continue
      if (a.status === 'rescheduling_required') {
        items.push({ id: a.id, leadId: lead.id, leadName: lead.fullName, kind: 'unassigned', detail: 'No slot could be reserved. Assign a time or let the system retry.', at: a.updatedAt })
      } else if (a.status === 'pending') {
        items.push({ id: a.id, leadId: lead.id, leadName: lead.fullName, kind: 'pending_reservation', detail: 'Waiting for the Google Calendar reservation to finish.', at: a.updatedAt })
      }
    }
    for (const c of d.calls) {
      if (c.processingStatus === 'failed' && !items.some((i) => i.leadId === c.leadId)) {
        const lead = d.leads.find((l) => l.id === c.leadId)
        if (lead) items.push({ id: c.id, leadId: lead.id, leadName: lead.fullName, kind: 'processing_failed', detail: 'Call processing failed. The lead is saved.', at: c.updatedAt })
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at))
  })
