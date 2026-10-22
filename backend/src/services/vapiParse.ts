/**
 * Defensive parsing of Vapi server messages. Only the fields Vapi documents for each message type are relied on;
 * everything else is optional, and every accessor tolerates missing or wrongly typed data. Pure functions: no I/O.
 */
import { z } from 'zod'
import { isDateStr } from '../lib/tz'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const date = (v: unknown): Date | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function getMessage(body: unknown): Obj | null {
  if (!isObj(body) || !isObj(body.message)) return null
  return body.message
}

export const messageType = (body: unknown): string | null => str(getMessage(body)?.type) ?? null

export function callIdOf(body: unknown): string | null {
  const m = getMessage(body)
  if (!m) return null
  const call = isObj(m.call) ? m.call : null
  return str(call?.id) ?? null
}

export function customerNumberOf(body: unknown): string | undefined {
  const m = getMessage(body)
  const call = m && isObj(m.call) ? m.call : null
  const customer = call && isObj(call.customer) ? call.customer : null
  return str(customer?.number)
}

/* ---------- lead details ---------- */

export interface LeadBag {
  fullName?: string
  email?: string
  phoneNumber?: string
  reasonForCall?: string
  notes?: string
  preferredDate?: string
  preferredTime?: string
}

const pick = (o: Obj, ...keys: string[]) => {
  for (const k of keys) {
    const v = str(o[k])
    if (v) return v
  }
  return undefined
}

/** Spoken-email cleanup: "john at example dot com" -> "john@example.com". Lowercases and trims. */
export function cleanEmail(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+/g, '')
}

export function leadBagFrom(o: unknown): LeadBag {
  if (!isObj(o)) return {}
  const email = pick(o, 'email', 'emailAddress')
  return {
    fullName: pick(o, 'fullName', 'name', 'full_name', 'customerName'),
    email: email ? cleanEmail(email) : undefined,
    phoneNumber: pick(o, 'phoneNumber', 'phone', 'phone_number'),
    reasonForCall: pick(o, 'reasonForCall', 'reason', 'reason_for_call', 'summary'),
    notes: pick(o, 'notes', 'additionalDetails', 'details'),
    preferredDate: pick(o, 'preferredDate', 'preferred_date', 'date'),
    preferredTime: pick(o, 'preferredTime', 'preferred_time', 'time'),
  }
}

/** First defined value wins, in the order given. */
export const mergeBags = (...bags: Array<LeadBag | undefined>): LeadBag => {
  const out: LeadBag = {}
  for (const b of bags) {
    if (!b) continue
    for (const k of Object.keys(b) as Array<keyof LeadBag>) if (out[k] === undefined && b[k] !== undefined) out[k] = b[k]
  }
  return out
}

/* ---------- end-of-call-report ---------- */

export interface TranscriptSegment {
  speaker: 'assistant' | 'caller'
  startSec: number
  text: string
}

export interface ParsedReport {
  callId: string
  customerNumber?: string
  startedAt?: Date
  endedAt?: Date
  endedReason?: string
  durationSeconds?: number
  recordingUrl?: string
  transcript: TranscriptSegment[] | null
  structured: LeadBag
}

export function recordingUrlFrom(artifact: Obj | null, message: Obj): string | undefined {
  const rec = artifact && isObj(artifact.recording) ? artifact.recording : null
  const mono = rec && isObj(rec.mono) ? rec.mono : null
  return (
    str(artifact?.recordingUrl) ??
    str(mono?.combinedUrl) ??
    str(rec?.stereoUrl) ??
    str(artifact?.stereoRecordingUrl) ??
    str(message.recordingUrl) ??
    str(message.stereoRecordingUrl)
  )
}

const BOT_ROLES = new Set(['assistant', 'bot', 'ai'])
const USER_ROLES = new Set(['user', 'customer', 'caller'])

export function buildTranscript(messages: unknown, startedAt?: Date): TranscriptSegment[] | null {
  if (!Array.isArray(messages)) return null
  const out: TranscriptSegment[] = []
  let cursor = 0
  for (const raw of messages) {
    if (!isObj(raw)) continue
    const role = str(raw.role)?.toLowerCase()
    const text = str(raw.message) ?? str(raw.content)
    if (!role || !text) continue
    const speaker = BOT_ROLES.has(role) ? 'assistant' : USER_ROLES.has(role) ? 'caller' : null
    if (!speaker) continue // system prompts, tool calls and tool results are not part of the conversation
    let at = num(raw.secondsFromStart)
    if (at === undefined) {
      const t = num(raw.time)
      if (t !== undefined && startedAt) at = (t - startedAt.getTime()) / 1000
    }
    if (at === undefined || at < 0 || !Number.isFinite(at)) at = cursor
    at = Math.max(at, 0)
    out.push({ speaker, startSec: Math.round(at * 10) / 10, text: text.slice(0, 4000) })
    // Without timestamps, estimate ~2.5 spoken words per second so the playback sync stays plausible.
    cursor = Math.max(cursor, at) + Math.max(1.5, text.split(/\s+/).length / 2.5)
  }
  return out.length ? out.sort((a, b) => a.startSec - b.startSec) : null
}

/** "AI: hi\nUser: hello" style transcripts, used only when no structured messages exist. */
export function transcriptFromText(text: string | undefined): TranscriptSegment[] | null {
  if (!text) return null
  const out: TranscriptSegment[] = []
  let t = 0
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(AI|Assistant|Bot|User|Customer|Caller)\s*:\s*(.+)$/i.exec(line)
    if (!m) continue
    const speaker = /^(ai|assistant|bot)$/i.test(m[1]) ? 'assistant' : 'caller'
    out.push({ speaker, startSec: Math.round(t * 10) / 10, text: m[2].trim().slice(0, 4000) })
    t += Math.max(1.5, m[2].split(/\s+/).length / 2.5)
  }
  return out.length ? out : null
}

function structuredBag(artifact: Obj | null, message: Obj): LeadBag {
  const bags: LeadBag[] = []
  const outputs = artifact && isObj(artifact.structuredOutputs) ? artifact.structuredOutputs : null
  if (outputs) for (const v of Object.values(outputs)) if (isObj(v) && isObj(v.result)) bags.push(leadBagFrom(v.result))
  const analysis = isObj(message.analysis) ? message.analysis : null
  if (analysis && isObj(analysis.structuredData)) bags.push(leadBagFrom(analysis.structuredData))
  return mergeBags(...bags)
}

export function parseEndOfCallReport(body: unknown): ParsedReport | null {
  const m = getMessage(body)
  if (!m || m.type !== 'end-of-call-report') return null
  const callId = callIdOf(body)
  if (!callId) return null
  const call = isObj(m.call) ? m.call : {}
  const artifact = isObj(m.artifact) ? m.artifact : null
  const startedAt = date(m.startedAt) ?? date(call.startedAt) ?? date(call.createdAt)
  const endedAt = date(m.endedAt) ?? date(call.endedAt)
  const durationSeconds = num(m.durationSeconds) ?? (num(m.durationMs) !== undefined ? Math.round((m.durationMs as number) / 1000) : undefined)
  const transcript =
    buildTranscript(artifact?.messages ?? m.messages, startedAt) ?? transcriptFromText(str(artifact?.transcript) ?? str(m.transcript))
  return {
    callId,
    customerNumber: customerNumberOf(body),
    startedAt,
    endedAt,
    endedReason: str(m.endedReason) ?? str(call.endedReason),
    durationSeconds,
    recordingUrl: recordingUrlFrom(artifact, m),
    transcript,
    structured: structuredBag(artifact, m),
  }
}

export type CallOutcome = 'completed' | 'missed' | 'failed'

export function callOutcome(endedReason: string | undefined): CallOutcome {
  const r = (endedReason ?? '').toLowerCase()
  if (!r) return 'completed'
  if (/(did-not-answer|no-answer|voicemail|busy)/.test(r)) return 'missed'
  if (/(error|failed|fail|invalid|unreachable|exceeded-max-duration-error)/.test(r)) return 'failed'
  return 'completed'
}

export const endedByCaller = (endedReason: string | undefined) => /customer-ended-call|customer-hung-up|caller-hung-up/i.test(endedReason ?? '')

/* ---------- tool calls ---------- */

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export function parseToolCalls(body: unknown): ToolCall[] {
  const m = getMessage(body)
  if (!m || m.type !== 'tool-calls') return []
  const list = Array.isArray(m.toolCallList) ? m.toolCallList : Array.isArray(m.toolCalls) ? m.toolCalls : []
  const out: ToolCall[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const id = str(raw.id)
    const fn = isObj(raw.function) ? raw.function : null
    const name = str(fn?.name) ?? str(raw.name)
    if (!id || !name) continue
    let args: unknown = fn?.arguments ?? raw.arguments ?? {}
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        args = {}
      }
    }
    out.push({ id, name, args })
  }
  return out
}

const dateField = z.string().trim().refine(isDateStr, 'date must look like 2026-10-27')
const timeField = z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'time must be 24-hour HH:mm, like 14:30')
const normTime = (t: string) => (t.length === 4 ? `0${t}` : t)

export const checkAvailabilityArgs = z.object({ date: dateField, time: timeField.optional().transform((t) => (t ? normTime(t) : undefined)) })

export const bookAppointmentArgs = z.object({
  fullName: z.string().trim().min(2, 'fullName is required').max(120),
  email: z.string().trim().transform(cleanEmail).pipe(z.string().email('email does not look valid; ask the caller to spell it').max(254)),
  phoneNumber: z.string().trim().max(32).optional(),
  reasonForCall: z.string().trim().min(2, 'reasonForCall is required').max(1000),
  notes: z.string().trim().max(2000).optional(),
  date: dateField,
  time: timeField.transform(normTime),
})
