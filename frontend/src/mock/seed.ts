/**
 * Deterministic demo data. Everything is generated relative to "now" so the dashboard
 * always looks current. This file is only used by the mock API and is replaced by the
 * real backend later.
 */
import { addDays, addMinutes, startOfDay, toDateInput, withTime } from '@/lib/dates'
import type {
  ActivityLog,
  Appointment,
  AppointmentStatus,
  AssignmentSource,
  BusinessSettings,
  Call,
  CalendarConnection,
  ConfirmationStatus,
  ExternalEvent,
  Lead,
  LeadStatus,
  Priority,
  TranscriptSegment,
  User,
} from '@/lib/types'
import { daySlots, type BusyBlock, type Slot } from './scheduler'

export interface Db {
  version: number
  seededAt: string
  leads: Lead[]
  calls: Call[]
  appointments: Appointment[]
  activity: ActivityLog[]
  externalEvents: ExternalEvent[]
  settings: BusinessSettings
  connection: CalendarConnection
}

export const DB_VERSION = 1

export const DEMO_USERS: Array<User & { password: string }> = [
  { id: 'u-admin', name: 'Dana Whitfield', email: 'admin@buslead.test', role: 'admin', password: 'buslead-demo' },
  { id: 'u-agent', name: 'Marcus Lee', email: 'agent@buslead.test', role: 'agent', password: 'buslead-demo' },
]

export const BUSINESS_NAME = 'Northline Services'

export const defaultSettings = (): BusinessSettings => ({
  timeZone: 'America/New_York',
  workingDays: [1, 2, 3, 4, 5],
  openingTime: '09:00',
  closingTime: '17:00',
  appointmentDurationMinutes: 30,
  bufferMinutes: 15,
  minimumNoticeMinutes: 120,
  maximumSchedulingDays: 30,
  selectedCalendarId: 'cal-primary',
  holidays: [
    { date: '2026-11-26', label: 'Thanksgiving' },
    { date: '2026-12-25', label: 'Christmas Day' },
    { date: '2027-01-01', label: "New Year's Day" },
  ],
  allowCallerReschedule: true,
  rescheduleCutoffHours: 24,
  cancellationCutoffHours: 12,
  maxReschedules: 3,
  recordingRetentionDays: 90,
})

export const defaultConnection = (now: Date): CalendarConnection => ({
  connected: true,
  googleAccountEmail: 'frontdesk@northline.example',
  calendarId: 'cal-primary',
  calendars: [
    { id: 'cal-primary', name: 'Northline follow-ups', primary: true },
    { id: 'cal-team', name: 'Team calendar', primary: false },
    { id: 'cal-personal', name: 'Dana (personal)', primary: false },
  ],
  tokenExpiresAt: addMinutes(now, 47).toISOString(),
  lastSyncedAt: addMinutes(now, -6).toISOString(),
  health: 'healthy',
})

/* ---------- seeded randomness ---------- */

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'Priya Raman', 'Tomás Herrera', 'Hannah Okafor', 'Liam Brennan', 'Mei-Ling Chow', 'Jorge Castellanos',
  'Aisha Rahman', 'Connor Walsh', 'Sofia Lindqvist', 'Dmitri Volkov', 'Grace Adeyemi', 'Ethan Park',
  'Rosa Delgado', 'Noah Fitzgerald', 'Yuki Tanaka', 'Camille Beaumont', 'Isaiah Brooks', 'Leila Haddad',
  'Owen McAllister', 'Fatima Zahra', 'Julian Ortega', 'Beatrice Novak', 'Kwame Mensah', 'Elena Petrova',
  'Marcus Holloway', 'Anika Sharma', 'Declan Murphy', 'Zainab Yusuf', 'Hugo Lambert', 'Tessa Ward',
  'Rahul Mehta', 'Ingrid Solberg', 'Caleb Turner', 'Naomi Feldman', 'Andre Boucher', 'Lucia Moretti',
  'Sam Oyelaran', 'Harper Quinn', 'Viktor Hale', 'Amara Nwosu', 'Pedro Alves', 'Janelle Cooper',
]

const REASONS: Array<[string, string]> = [
  ['Wants a quote for a full office cleaning contract', 'Three floors, about 9,000 square feet, needs it weekly.'],
  ['Asking about annual maintenance plans', 'Currently on a pay-per-visit arrangement with another provider.'],
  ['Booking a product consultation', 'Interested in the premium tier for a team of twelve.'],
  ['Needs a follow-up on an earlier estimate', 'Received the estimate last week and has a few questions on scope.'],
  ['Requesting a demo for their operations team', 'Prefers a late-afternoon slot so the whole team can join.'],
  ['Wants to renew an expiring service agreement', 'Agreement ends at the end of next month.'],
  ['Comparing pricing for a multi-location setup', 'Four locations across two states.'],
  ['Reporting an issue with a recent installation', 'Would like someone to call back before sending a technician.'],
  ['Partnership inquiry from a regional supplier', 'Supplies parts to three other businesses nearby.'],
  ['Asking whether the service covers weekends', 'Runs a small retail shop and is closed Mondays.'],
  ['Needs help choosing between two packages', 'Budget is fixed, wants to understand the trade-offs.'],
  ['Wants to add a second site to the account', 'Opening a new location in the spring.'],
  ['Referred by an existing client', 'Referred by Hannah at a neighboring business.'],
  ['Questions about contract length and cancellation', 'Wants to avoid a long commitment on the first year.'],
  ['Requesting a callback about onboarding timelines', 'Needs everything running before the end of the quarter.'],
  ['Interested in a seasonal service package', 'Looking for something that starts in November.'],
]

const DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example', 'work.example']

const CAL_USERS = [
  { id: 'u-admin', name: 'Dana Whitfield' },
  { id: 'u-agent', name: 'Marcus Lee' },
]

type Scenario = 'booked' | 'alt' | 'hangup_auto' | 'hangup_failed' | 'completed' | 'cancelled' | 'pending' | 'manual'

const SCENARIOS: Scenario[] = [
  'booked', 'alt', 'hangup_auto', 'completed', 'booked', 'hangup_failed', 'completed', 'pending',
  'booked', 'cancelled', 'hangup_auto', 'manual', 'completed', 'alt', 'booked', 'hangup_auto',
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')
const b32 = (rnd: () => number, n: number) =>
  Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(rnd() * 32)]).join('')

const spokenEmail = (e: string) => e.replace('@', ' at ').replace(/\./g, ' dot ')
const spokenPhone = (p: string) => p.replace(/\D/g, '').slice(1).split('').join(' ')
const slotWords = (d: Date) =>
  `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} Eastern`

interface TranscriptInput {
  name: string
  email: string
  phone: string
  reason: string
  extra: string
  requested: Date | null
  booked: Date | null
  alt: { requestedBusy: boolean; offered: Date[] } | null
  hangup: boolean
}

function buildTranscript(i: TranscriptInput): TranscriptSegment[] {
  const first = i.name.split(' ')[0]
  const lines: Array<['assistant' | 'caller', string]> = [
    ['assistant', `Thanks for calling ${BUSINESS_NAME}. I'm the virtual receptionist, and I can take a few details and arrange a follow-up with the team. May I have your full name?`],
    ['caller', `Hi, yes, it's ${i.name}.`],
    ['assistant', `Thank you, ${first}. What's the best email address to reach you?`],
    ['caller', spokenEmail(i.email)],
    ['assistant', `I have ${spokenEmail(i.email)}. Is that right?`],
    ['caller', 'Yes, that is correct.'],
    ['assistant', 'And a callback phone number?'],
    ['caller', spokenPhone(i.phone)],
    ['assistant', `Let me read that back: ${spokenPhone(i.phone)}. Did I get that right?`],
    ['caller', 'You did.'],
    ['assistant', 'What is the reason for your call today?'],
    ['caller', `${i.reason}. ${i.extra}`],
  ]
  if (i.requested) {
    lines.push(
      ['assistant', 'When would you like us to follow up with you?'],
      ['caller', `How about ${slotWords(i.requested)}?`],
    )
  } else {
    lines.push(['assistant', 'When would you like us to follow up with you?'])
  }
  if (i.hangup) {
    lines.push(['assistant', 'Let me check what we have available around then.'])
  } else if (i.alt) {
    const [a, b] = i.alt.offered
    lines.push(
      ['assistant', `I'm sorry, that time is already taken. The closest openings are ${slotWords(a)}${b ? `, or ${slotWords(b)}` : ''}. Which would you prefer?`],
      ['caller', `The first one works.`],
      ['assistant', `I have reserved ${slotWords(a)} for you. You'll get a calendar invitation at ${i.email}. Is there anything else I can help with?`],
      ['caller', 'No, that is everything. Thank you.'],
      ['assistant', `Thank you for calling, ${first}. Have a good day.`],
    )
  } else if (i.booked) {
    lines.push(
      ['assistant', `That time is open. I have reserved ${slotWords(i.booked)} for you. You'll get a calendar invitation at ${i.email}. Is there anything else I can help with?`],
      ['caller', 'No, that is all. Thanks.'],
      ['assistant', `Thank you for calling, ${first}. Have a good day.`],
    )
  }
  let t = 0
  return lines.map(([speaker, text]) => {
    const seg = { speaker, startSec: Math.round(t), text }
    t += Math.max(2.5, text.length / 15) + 1.2
    return seg
  })
}

/* ---------- builder ---------- */

export function seedDb(now: Date = new Date()): Db {
  const rnd = mulberry32(20261020)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
  const int = (min: number, max: number) => Math.floor(min + rnd() * (max - min + 1))
  const iso = (d: Date) => d.toISOString()

  const settings = defaultSettings()
  const connection = defaultConnection(now)

  // External calendar events that make some slots unavailable.
  const externalEvents: ExternalEvent[] = []
  for (let d = -21; d <= 30; d++) {
    const day = addDays(startOfDay(now), d)
    if (!settings.workingDays.includes(day.getDay())) continue
    if (day.getDay() === 3) {
      externalEvents.push({ id: `ext-${d}-lunch`, title: 'Team lunch', startAt: iso(withTime(day, '12:00')), endAt: iso(withTime(day, '13:00')) })
    }
    if (rnd() < 0.35) {
      const h = pick(['10:30', '14:00', '15:30'])
      externalEvents.push({
        id: `ext-${d}-x`,
        title: pick(['Vendor call', 'Dentist (personal)', 'Site visit', 'Accounting review']),
        startAt: iso(withTime(day, h)),
        endAt: iso(addMinutes(withTime(day, h), 60)),
      })
    }
  }
  const busy: BusyBlock[] = externalEvents.map((e) => ({ start: new Date(e.startAt), end: new Date(e.endAt), kind: 'external' }))

  // Slot pools.
  const futureSlots: Slot[] = []
  for (let d = 0; d <= 21; d++) futureSlots.push(...daySlots(addDays(startOfDay(now), d), settings, busy, now).filter((s) => s.available))
  const pastSlots: Slot[] = []
  for (let d = -18; d <= -1; d++) {
    pastSlots.push(...daySlots(addDays(startOfDay(now), d), settings, busy, new Date(0), { ignoreWindow: true }).filter((s) => s.available))
  }
  let cursor = 0
  const takeFuture = () => {
    cursor += int(1, 6)
    const s = futureSlots[Math.min(cursor, futureSlots.length - 1)]
    cursor += 1
    return s
  }
  const takePast = () => pastSlots.splice(Math.floor(rnd() * pastSlots.length), 1)[0]

  const leads: Lead[] = []
  const calls: Call[] = []
  const appointments: Appointment[] = []
  const activity: ActivityLog[] = []
  let actSeq = 0
  const act = (a: Omit<ActivityLog, 'id'>) => activity.push({ id: `act-${++actSeq}`, ...a })

  NAMES.forEach((fullName, idx) => {
    const scenario = SCENARIOS[idx % SCENARIOS.length]
    const n = idx + 1
    const leadId = `lead-${String(n).padStart(3, '0')}`
    const callId = `call-${String(n).padStart(3, '0')}`
    const apptId = `appt-${String(n).padStart(3, '0')}`
    const [reason, extra] = REASONS[(idx * 5 + 3) % REASONS.length]
    const email = `${slug(fullName)}@${DOMAINS[idx % DOMAINS.length]}`
    const phone = `+1${pick(['212', '646', '917', '718', '347'])}55501${String(int(10, 99))}`
    const priority: Priority = pick(['low', 'medium', 'medium', 'high'])

    let slot: Slot | null = null
    let createdAt: Date
    let leadStatus: LeadStatus = 'new'
    let apptStatus: AppointmentStatus | null = null
    let source: AssignmentSource = 'caller'
    let confirmation: ConfirmationStatus = 'reserved'
    let requested: Date | null = null
    let hangup = false
    let altOffered: Date[] = []
    let processing: Call['processingStatus'] = 'processed'
    let recording: Call['recordingStatus'] = rnd() < 0.9 ? 'available' : 'unavailable'
    let cancelReason: string | null = null
    let hasCall = true

    switch (scenario) {
      case 'booked':
        slot = takeFuture()
        createdAt = addMinutes(now, -int(30, 60 * 24 * 5))
        leadStatus = 'follow_up_scheduled'
        apptStatus = 'confirmed'
        requested = slot.start
        break
      case 'alt': {
        slot = takeFuture()
        createdAt = addMinutes(now, -int(60, 60 * 24 * 4))
        leadStatus = 'follow_up_scheduled'
        apptStatus = 'confirmed'
        requested = addMinutes(slot.start, 45 * pick([1, 2]))
        const second = futureSlots[Math.min(futureSlots.indexOf(slot) + 3, futureSlots.length - 1)]
        altOffered = [slot.start, second.start]
        break
      }
      case 'hangup_auto':
        slot = takeFuture()
        createdAt = addMinutes(now, -int(60, 60 * 24 * 3))
        leadStatus = 'follow_up_scheduled'
        apptStatus = 'auto_assigned'
        source = 'automatic'
        hangup = true
        requested = rnd() < 0.5 ? addMinutes(slot.start, 90) : null
        break
      case 'hangup_failed':
        createdAt = addMinutes(now, -int(20, 60 * 8))
        leadStatus = 'new'
        apptStatus = 'rescheduling_required'
        source = 'automatic'
        confirmation = 'failed'
        hangup = true
        break
      case 'completed':
        slot = takePast()
        createdAt = addDays(slot.start, -int(1, 4))
        leadStatus = pick<LeadStatus>(['qualified', 'converted', 'contacted', 'unqualified', 'closed', 'in_progress'])
        apptStatus = 'completed'
        requested = slot.start
        break
      case 'cancelled':
        slot = futureSlots[int(2, 20)]
        createdAt = addMinutes(now, -int(60 * 24, 60 * 24 * 6))
        leadStatus = pick<LeadStatus>(['contacted', 'closed'])
        apptStatus = 'cancelled'
        cancelReason = pick(['Caller asked to cancel', 'Caller found another provider', 'Duplicate request'])
        requested = slot.start
        break
      case 'pending':
        slot = takeFuture()
        createdAt = addMinutes(now, -int(3, 28))
        leadStatus = 'new'
        apptStatus = 'pending'
        confirmation = 'pending'
        requested = slot.start
        processing = 'processing'
        recording = 'processing'
        break
      case 'manual':
        createdAt = addMinutes(now, -int(60 * 24, 60 * 24 * 7))
        leadStatus = 'contacted'
        source = 'manual'
        hasCall = false
        if (idx > 20) {
          slot = takeFuture()
          apptStatus = 'confirmed'
        }
        break
    }

    const lead: Lead = {
      id: leadId,
      fullName,
      email,
      phoneNumber: phone,
      reasonForCall: reason,
      notes: extra,
      status: leadStatus,
      priority,
      source: hasCall ? 'phone' : 'manual',
      timeZone: settings.timeZone,
      internalNotes: [],
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
    }
    if (rnd() < 0.35 && leadStatus !== 'new') {
      lead.internalNotes.push({
        id: `note-${n}-1`,
        authorName: pick(CAL_USERS).name,
        body: pick([
          'Left a voicemail confirming the time. Will try again tomorrow morning.',
          'Wants pricing in writing before the call. Sent the standard sheet.',
          'Decision maker is their operations lead; loop her in on the follow-up.',
          'Spoke briefly. Very interested, mostly needs a clear timeline.',
        ]),
        createdAt: iso(addMinutes(createdAt, int(60, 60 * 20))),
      })
    }

    leads.push(lead)

    if (hasCall) {
      const callStart = createdAt
      const hungUpAt = hangup
      const transcript = buildTranscript({
        name: fullName, email, phone, reason, extra,
        requested, booked: scenario === 'booked' || scenario === 'completed' || scenario === 'cancelled' || scenario === 'pending' ? slot?.start ?? null : null,
        alt: scenario === 'alt' ? { requestedBusy: true, offered: altOffered } : null,
        hangup: hungUpAt,
      })
      const last = transcript[transcript.length - 1]
      const duration = Math.round(last.startSec + Math.max(3, last.text.length / 15) + 2)
      const failedProcessing = scenario === 'hangup_failed'
      const call: Call = {
        id: callId,
        leadId,
        vapiCallId: `vapi_${b32(rnd, 12)}`,
        startedAt: iso(callStart),
        endedAt: iso(new Date(callStart.getTime() + duration * 1000)),
        durationSeconds: duration,
        callStatus: 'completed',
        processingStatus: failedProcessing ? 'failed' : processing,
        transcript: scenario === 'pending' ? null : transcript,
        recordingStatus: recording,
        callerDisconnected: hangup,
        extractedData: {
          fullName,
          email,
          phoneNumber: phone,
          reasonForCall: reason,
          preferredDate: requested ? toDateInput(requested) : null,
          preferredTime: requested ? `${String(requested.getHours()).padStart(2, '0')}:${String(requested.getMinutes()).padStart(2, '0')}` : null,
          timeZone: settings.timeZone,
          appointmentStatus: apptStatus ?? 'none',
        },
        createdAt: iso(callStart),
        updatedAt: iso(callStart),
      }
      calls.push(call)
      act({ leadId, callId, appointmentId: null, action: 'call.received', details: `Call received from ${phone}`, actor: 'Vapi', createdAt: iso(callStart) })
      act({ leadId, callId, appointmentId: null, action: 'lead.created', details: 'Lead created from call data', actor: 'Vapi', createdAt: iso(addMinutes(callStart, duration / 60)) })
      if (failedProcessing) {
        act({ leadId, callId, appointmentId: null, action: 'call.processing_failed', details: 'Google Calendar was unavailable. The lead is saved and scheduling will retry.', actor: 'System', createdAt: iso(addMinutes(callStart, duration / 60 + 1)) })
      }
    } else {
      act({ leadId, callId: null, appointmentId: null, action: 'lead.created', details: 'Lead added manually', actor: pick(CAL_USERS).name, createdAt: iso(createdAt) })
    }

    if (apptStatus) {
      const start = slot?.start ?? null
      const appt: Appointment = {
        id: apptId,
        leadId,
        callId: hasCall ? callId : null,
        googleCalendarEventId: confirmation === 'reserved' && start && apptStatus !== 'cancelled' ? `evt_${b32(rnd, 20)}` : null,
        requestedStartAt: requested ? iso(requested) : null,
        scheduledStartAt: start && apptStatus !== 'rescheduling_required' ? iso(start) : null,
        scheduledEndAt: start && apptStatus !== 'rescheduling_required' ? iso(slot!.end) : null,
        timeZone: settings.timeZone,
        status: apptStatus,
        assignmentSource: source,
        confirmationStatus: confirmation,
        rescheduleCount: scenario === 'alt' ? 0 : rnd() < 0.12 ? 1 : 0,
        cancelReason,
        createdAt: iso(addMinutes(createdAt, 3)),
        updatedAt: iso(addMinutes(createdAt, 3)),
      }
      appointments.push(appt)
      if (start && ['confirmed', 'auto_assigned', 'pending'].includes(apptStatus)) {
        busy.push({ start, end: slot!.end, kind: 'appointment' })
      }
      const at = iso(addMinutes(createdAt, 4))
      if (apptStatus === 'confirmed') {
        act({ leadId, callId: hasCall ? callId : null, appointmentId: apptId, action: 'appointment.confirmed', details: `${source === 'manual' ? 'Scheduled manually' : scenario === 'alt' ? 'Caller accepted an alternative time' : 'Requested time was open'}; Google Calendar event created`, actor: source === 'manual' ? 'Dana Whitfield' : 'Vapi', createdAt: at })
      } else if (apptStatus === 'auto_assigned') {
        act({ leadId, callId, appointmentId: apptId, action: 'appointment.auto_assigned', details: 'Caller hung up before choosing a time. Earliest valid slot reserved.', actor: 'System', createdAt: at })
      } else if (apptStatus === 'rescheduling_required') {
        act({ leadId, callId, appointmentId: apptId, action: 'appointment.rescheduling_required', details: 'No slot could be reserved. Retrying automatically.', actor: 'System', createdAt: at })
      } else if (apptStatus === 'pending') {
        act({ leadId, callId, appointmentId: apptId, action: 'appointment.pending', details: 'Waiting for the Google Calendar reservation to finish', actor: 'System', createdAt: at })
      } else if (apptStatus === 'completed') {
        act({ leadId, callId, appointmentId: apptId, action: 'appointment.confirmed', details: 'Caller booked a follow-up; Google Calendar event created', actor: 'Vapi', createdAt: at })
        act({ leadId, callId: null, appointmentId: apptId, action: 'appointment.completed', details: 'Follow-up marked complete', actor: pick(CAL_USERS).name, createdAt: iso(addMinutes(slot!.end, 20)) })
      } else if (apptStatus === 'cancelled') {
        act({ leadId, callId, appointmentId: apptId, action: 'appointment.cancelled', details: cancelReason ?? 'Cancelled', actor: pick(CAL_USERS).name, createdAt: iso(addMinutes(createdAt, 60 * 5)) })
      }
    }
  })

  // Newest leads first for stable ids in the UI.
  return {
    version: DB_VERSION,
    seededAt: iso(now),
    leads,
    calls,
    appointments,
    activity: activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    externalEvents,
    settings,
    connection,
  }
}
