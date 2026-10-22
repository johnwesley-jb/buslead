import test from 'node:test'
import assert from 'node:assert/strict'
import { bookAppointmentArgs, buildTranscript, callOutcome, checkAvailabilityArgs, cleanEmail, parseEndOfCallReport, parseToolCalls, transcriptFromText } from '../src/services/vapiParse'

const report = (over: Record<string, unknown> = {}) => ({
  message: {
    type: 'end-of-call-report',
    endedReason: 'customer-ended-call',
    call: { id: 'call_123', customer: { number: '+15551234567' } },
    startedAt: '2026-10-21T15:00:00.000Z',
    endedAt: '2026-10-21T15:02:30.000Z',
    artifact: {
      recordingUrl: 'https://storage.vapi.ai/rec.wav',
      messages: [
        { role: 'system', message: 'prompt text' },
        { role: 'bot', message: 'Thanks for calling. May I have your name?', secondsFromStart: 0.4 },
        { role: 'user', message: 'Ada Lovelace', secondsFromStart: 6.2 },
        { role: 'tool_calls', message: '' },
      ],
      structuredOutputs: { so_1: { name: 'Lead Intake', result: { fullName: 'Ada Lovelace', email: 'Ada At Example Dot com', reasonForCall: 'Quote' } } },
    },
    ...over,
  },
})

test('parses a full end-of-call-report', () => {
  const r = parseEndOfCallReport(report())!
  assert.equal(r.callId, 'call_123')
  assert.equal(r.customerNumber, '+15551234567')
  assert.equal(r.recordingUrl, 'https://storage.vapi.ai/rec.wav')
  assert.equal(r.endedReason, 'customer-ended-call')
  assert.equal(r.transcript?.length, 2)
  assert.deepEqual(r.transcript?.map((t) => t.speaker), ['assistant', 'caller'])
  assert.equal(r.structured.fullName, 'Ada Lovelace')
  assert.equal(r.structured.email, 'ada@example.com')
})

test('tolerates a minimal report with missing artifact and wrong types', () => {
  const r = parseEndOfCallReport({ message: { type: 'end-of-call-report', call: { id: 'c1' }, artifact: 'oops', startedAt: 42 } })!
  assert.equal(r.callId, 'c1')
  assert.equal(r.transcript, null)
  assert.equal(r.recordingUrl, undefined)
  assert.deepEqual(r.structured, {})
})

test('rejects reports without a call id and non-report messages', () => {
  assert.equal(parseEndOfCallReport({ message: { type: 'end-of-call-report' } }), null)
  assert.equal(parseEndOfCallReport({ message: { type: 'status-update', call: { id: 'x' } } }), null)
  assert.equal(parseEndOfCallReport(null), null)
  assert.equal(parseEndOfCallReport('string'), null)
})

test('falls back to the plain-text transcript and to other recording locations', () => {
  const r = parseEndOfCallReport({
    message: { type: 'end-of-call-report', call: { id: 'c2' }, artifact: { transcript: 'AI: Hello there\nUser: Hi, I need help', recording: { mono: { combinedUrl: 'https://storage.vapi.ai/m.wav' } } } },
  })!
  assert.equal(r.recordingUrl, 'https://storage.vapi.ai/m.wav')
  assert.equal(r.transcript?.length, 2)
  assert.equal(r.transcript?.[1].speaker, 'caller')
})

test('transcript timing: uses epoch time relative to start, then estimates, always monotonic', () => {
  const start = new Date('2026-10-21T15:00:00.000Z')
  const t = buildTranscript(
    [
      { role: 'assistant', message: 'one two three four five six', time: start.getTime() + 2000 },
      { role: 'user', message: 'reply without time' },
      { role: 'assistant', message: 'late', secondsFromStart: 30 },
    ],
    start,
  )!
  assert.equal(t[0].startSec, 2)
  assert.ok(t[1].startSec > t[0].startSec)
  assert.equal(t[2].startSec, 30)
  assert.ok(t.every((s, i) => i === 0 || s.startSec >= t[i - 1].startSec))
})

test('transcriptFromText ignores lines without a speaker', () => {
  assert.equal(transcriptFromText('no speakers here'), null)
  assert.equal(transcriptFromText(undefined), null)
})

test('call outcome from endedReason', () => {
  assert.equal(callOutcome('customer-ended-call'), 'completed')
  assert.equal(callOutcome('customer-did-not-answer'), 'missed')
  assert.equal(callOutcome('voicemail'), 'missed')
  assert.equal(callOutcome('pipeline-error-openai-llm-failed'), 'failed')
  assert.equal(callOutcome(undefined), 'completed')
})

test('parses tool-calls with object and string arguments', () => {
  const calls = parseToolCalls({
    message: {
      type: 'tool-calls',
      toolCallList: [
        { id: 'tc1', type: 'function', function: { name: 'check_availability', arguments: { date: '2026-10-27' } } },
        { id: 'tc2', type: 'function', function: { name: 'book_appointment', arguments: '{"date":"2026-10-27","time":"09:00"}' } },
        { id: 'tc3', function: { name: 'bad', arguments: '{not json' } },
        { function: { name: 'no-id' } },
      ],
    },
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[1].args, { date: '2026-10-27', time: '09:00' })
  assert.deepEqual(calls[2].args, {})
})

test('check_availability args validate the date and optional time', () => {
  assert.equal(checkAvailabilityArgs.safeParse({ date: '2026-10-27' }).success, true)
  assert.equal(checkAvailabilityArgs.safeParse({ date: 'next tuesday' }).success, false)
  assert.equal(checkAvailabilityArgs.safeParse({ date: '2026-10-27', time: '9:30' }).data?.time, '09:30')
  assert.equal(checkAvailabilityArgs.safeParse({ date: '2026-10-27', time: '25:00' }).success, false)
})

test('book_appointment args: cleans spoken email, rejects bad input', () => {
  const ok = bookAppointmentArgs.safeParse({ fullName: 'Ada Lovelace', email: 'Ada At Example Dot Com', reasonForCall: 'Quote', date: '2026-10-27', time: '9:00' })
  assert.equal(ok.success, true)
  assert.equal(ok.data?.email, 'ada@example.com')
  assert.equal(ok.data?.time, '09:00')
  assert.equal(bookAppointmentArgs.safeParse({ fullName: 'A', email: 'x', reasonForCall: 'y', date: '2026-10-27', time: '09:00' }).success, false)
  assert.equal(bookAppointmentArgs.safeParse({ fullName: 'Ada Lovelace', email: 'not-an-email', reasonForCall: 'Quote', date: '2026-10-27', time: '09:00' }).success, false)
})

test('cleanEmail', () => {
  assert.equal(cleanEmail('  John.Doe At Gmail Dot Com '), 'john.doe@gmail.com')
  assert.equal(cleanEmail('a@b.co'), 'a@b.co')
})
