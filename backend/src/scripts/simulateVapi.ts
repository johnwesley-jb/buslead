/**
 * Sends fake Vapi webhooks to your LOCAL API so you can test the whole flow without making a phone call.
 *   npm run simulate -- availability 2026-10-27
 *   npm run simulate -- book 2026-10-27 10:30
 *   npm run simulate -- report            (end-of-call-report for the last simulated call)
 *   npm run simulate -- report --duplicate  (send it twice: the second delivery must be ignored)
 * It reads VAPI_WEBHOOK_SECRET from .env and talks to http://localhost:PORT, never to the public tunnel.
 */
import { env } from '../config/env'

const base = `http://localhost:${env.PORT}/api/webhooks/vapi`
const callId = process.env.SIM_CALL_ID || 'sim-call-0001'
const call = { id: callId, createdAt: new Date(Date.now() - 150_000).toISOString(), customer: { number: '+15555550123' } }

async function post(body: unknown) {
  const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.VAPI_WEBHOOK_SECRET}` }, body: JSON.stringify(body) })
  console.log(res.status, await res.text())
}

const tool = (name: string, args: Record<string, unknown>) => ({ message: { type: 'tool-calls', call, toolCallList: [{ id: `tc_${Date.now()}`, type: 'function', function: { name, arguments: args } }] } })

async function main() {
  const [cmd, a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'))
  if (cmd === 'availability') {
    if (!a) throw new Error('Usage: simulate availability YYYY-MM-DD [HH:mm]')
    await post(tool('check_availability', { date: a, ...(b ? { time: b } : {}) }))
  } else if (cmd === 'book') {
    if (!a || !b) throw new Error('Usage: simulate book YYYY-MM-DD HH:mm')
    await post(tool('book_appointment', { fullName: 'Simulated Caller', email: 'sim.caller@example.com', phoneNumber: '+15555550123', reasonForCall: 'Test call from the simulator', date: a, time: b }))
  } else if (cmd === 'report') {
    const report = {
      message: {
        type: 'end-of-call-report',
        endedReason: 'customer-ended-call',
        call,
        startedAt: call.createdAt,
        endedAt: new Date().toISOString(),
        artifact: {
          messages: [
            { role: 'bot', message: 'Thanks for calling. May I have your name?', secondsFromStart: 0.5 },
            { role: 'user', message: 'Simulated Caller.', secondsFromStart: 5 },
            { role: 'bot', message: 'Great, and a reason for the call?', secondsFromStart: 8 },
            { role: 'user', message: 'This is a test.', secondsFromStart: 12 },
          ],
        },
      },
    }
    await post(report)
    if (process.argv.includes('--duplicate')) await post(report)
  } else {
    console.log('Commands: availability <date> [time] | book <date> <time> | report [--duplicate]')
  }
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exitCode = 1
})
