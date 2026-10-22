import { Readable } from 'node:stream'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env'
import { AppError, notFound } from '../lib/errors'
import { logger } from '../lib/logger'
import { isAllowedRecordingUrl } from '../lib/recordingHost'
import { prisma } from '../lib/prisma'
import { me, requireAuth, requireRole } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { heavyLimiter } from '../middleware/security'
import { logActivity } from '../services/audit'
import { processEndOfCall } from '../services/callProcessing'
import { toAppointment, toCall, toLead } from '../services/serializers'
import { refreshCallFromVapi } from '../services/vapiApi'

export const calls = Router()
calls.use(requireAuth)

calls.get(
  '/',
  wrap(async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().max(100).default(''), recording: z.enum(['available', 'processing', 'unavailable', '']).default('') }), req.query)
    const rows = await prisma.call.findMany({
      where: {
        ...(q.recording ? { recordingStatus: q.recording } : {}),
        ...(q.q ? { OR: [{ vapiCallId: { contains: q.q, mode: 'insensitive' } }, { lead: { fullName: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      },
      include: { lead: { select: { fullName: true } } },
      orderBy: { startedAt: 'desc' },
      take: 300,
    })
    res.json(rows.map((c) => ({ ...toCall(c), leadName: c.lead.fullName })))
  }),
)

calls.get(
  '/:id',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const call = await prisma.call.findUnique({ where: { id }, include: { lead: { include: { internalNotes: true } }, appointments: { orderBy: { createdAt: 'desc' }, take: 1 } } })
    if (!call) throw notFound('This call could not be found.')
    res.json({ call: toCall(call), lead: toLead(call.lead), appointment: call.appointments[0] ? toAppointment(call.appointments[0]) : null })
  }),
)

/**
 * Streams the audio through the API after the user is authenticated. The upstream URL (which may be a long-lived
 * public link) never reaches the browser. HTTP Range is forwarded so the player can seek.
 */
calls.get(
  '/:id/recording',
  heavyLimiter,
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const call = await prisma.call.findUnique({ where: { id }, select: { id: true, leadId: true, recordingUrl: true } })
    if (!call?.recordingUrl) throw notFound('No recording is available for this call.')
    if (!isAllowedRecordingUrl(call.recordingUrl, env.RECORDING_HOST_ALLOWLIST)) {
      logger.warn({ callId: id }, 'recording host is not on the allowlist')
      throw new AppError(502, 'RECORDING_BLOCKED', 'This recording is stored on a host that is not allowed. Ask an admin to review RECORDING_HOST_ALLOWLIST.')
    }

    const range = req.get('range')
    const headers: Record<string, string> = {}
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range

    const ctrl = new AbortController()
    res.on('close', () => ctrl.abort())
    let upstream: Response
    try {
      upstream = await fetch(call.recordingUrl, { headers, redirect: 'manual', signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(60_000)]) })
    } catch {
      throw new AppError(502, 'RECORDING_UNREACHABLE', 'The recording could not be fetched right now. Try again shortly.')
    }
    if (upstream.status === 404 || upstream.status === 403) {
      await prisma.call.update({ where: { id }, data: { recordingStatus: 'unavailable' } })
      throw notFound('This recording is no longer available.')
    }
    if (!upstream.body || (upstream.status !== 200 && upstream.status !== 206)) throw new AppError(502, 'RECORDING_UNREACHABLE', 'The recording could not be fetched right now. Try again shortly.')

    if (!range || /^bytes=0-/.test(range)) await logActivity({ leadId: call.leadId, callId: id, action: 'call.recording_played', details: 'Recording opened', actor: me(req).name })

    const type = upstream.headers.get('content-type') ?? ''
    res.status(upstream.status)
    res.setHeader('Content-Type', /^audio\//i.test(type) ? type : 'application/octet-stream')
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    res.setHeader('Content-Disposition', 'inline; filename="call-recording"')
    res.setHeader('Cache-Control', 'private, no-store')
    Readable.fromWeb(upstream.body as never).on('error', () => res.destroy()).pipe(res)
  }),
)

/** Re-reads a call from Vapi (recording link, transcript). Used when the recording was still processing. */
calls.post(
  '/:id/refresh-recording',
  heavyLimiter,
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    res.json(toCall(await refreshCallFromVapi(id)))
  }),
)

/** Admin: re-run processing from the stored webhook payload. */
calls.post(
  '/:id/reprocess',
  requireRole('admin'),
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const call = await prisma.call.findUnique({ where: { id }, select: { vapiCallId: true } })
    if (!call) throw notFound('This call could not be found.')
    const event = await prisma.webhookEvent.findUnique({ where: { key: `eoc:${call.vapiCallId}` } })
    if (!event) throw new AppError(404, 'NO_PAYLOAD', 'The original Vapi report is no longer stored (it may have been purged by retention).')
    await processEndOfCall(event.payload)
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'processed', processedAt: new Date(), error: null } })
    res.json(toCall(await prisma.call.findUniqueOrThrow({ where: { id } })))
  }),
)
