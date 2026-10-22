import { env } from '../config/env'
import { AppError, notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { buildTranscript, recordingUrlFrom } from './vapiParse'

/** Re-reads one call from the Vapi API and stores its recording link and transcript if we do not have them yet. */
export async function refreshCallFromVapi(callId: string) {
  const call = await prisma.call.findUnique({ where: { id: callId } })
  if (!call) throw notFound('This call could not be found.')
  if (!env.VAPI_API_KEY) throw new AppError(503, 'VAPI_NOT_CONFIGURED', 'VAPI_API_KEY is not set on the server.')

  let json: Record<string, unknown>
  try {
    const r = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(call.vapiCallId)}`, { headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` }, signal: AbortSignal.timeout(15_000) })
    if (r.status === 404) throw notFound('Vapi does not have this call.')
    if (!r.ok) throw new AppError(502, 'VAPI_ERROR', 'Vapi did not return the call. Try again shortly.')
    json = (await r.json()) as Record<string, unknown>
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError(502, 'VAPI_UNREACHABLE', 'Vapi could not be reached. Try again shortly.')
  }
  const artifact = json.artifact && typeof json.artifact === 'object' ? (json.artifact as Record<string, unknown>) : null
  const url = recordingUrlFrom(artifact, json)
  const transcript = call.transcript ? undefined : buildTranscript(artifact?.messages ?? json.messages, call.startedAt)
  return prisma.call.update({
    where: { id: callId },
    data: { ...(url ? { recordingUrl: url, recordingStatus: 'available' as const } : {}), ...(transcript ? { transcript: transcript as never } : {}) },
  })
}
