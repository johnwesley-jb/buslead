import express, { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Prisma } from '@prisma/client'
import { env } from '../config/env'
import { safeEqual } from '../lib/crypto'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { webhookLimiter } from '../middleware/security'
import { wrap } from '../middleware/common'
import { enqueue } from '../jobs/queues'
import { markCallProcessingFailed, processEndOfCall } from '../services/callProcessing'
import { handleToolCalls } from '../services/vapiTools'
import { callIdOf, messageType } from '../services/vapiParse'

export const webhooks = Router()

/**
 * Vapi authenticates with a Custom Credential of type Bearer: `Authorization: Bearer <VAPI_WEBHOOK_SECRET>`.
 * The legacy `X-Vapi-Secret` header is accepted too. Comparison is constant time. This route uses no cookies.
 */
function authorized(req: Request): boolean {
  const auth = req.get('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const legacy = req.get('x-vapi-secret') ?? ''
  return (bearer !== '' && safeEqual(bearer, env.VAPI_WEBHOOK_SECRET)) || (legacy !== '' && safeEqual(legacy, env.VAPI_WEBHOOK_SECRET))
}

// Authenticate BEFORE reading the body, so unauthenticated callers cannot make us buffer and parse 2 MB of JSON.
function requireWebhookAuth(req: Request, res: Response, next: NextFunction) {
  if (!authorized(req)) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
  next()
}

// Transcripts make end-of-call reports large; this is the only route that accepts a body above the global default.
webhooks.post(
  '/vapi',
  webhookLimiter,
  requireWebhookAuth,
  express.json({ limit: '2mb' }),
  wrap(async (req, res) => {
    const type = messageType(req.body)
    const callId = callIdOf(req.body)

    if (type === 'tool-calls') {
      // Vapi ignores non-200 responses for tool calls, so this always answers 200 with a result per call.
      return res.status(200).json(await handleToolCalls(req.body))
    }

    if (type === 'end-of-call-report') {
      if (!callId) return res.status(200).json({ received: true, ignored: 'no call id' })
      const key = `eoc:${callId}`
      // Idempotency: the unique key means a duplicate delivery never creates a second lead, call or appointment.
      let event = await prisma.webhookEvent.findUnique({ where: { key } })
      if (event?.status === 'processed') return res.status(200).json({ received: true, duplicate: true })
      event ??= await prisma.webhookEvent
        .create({ data: { key, type, vapiCallId: callId, payload: req.body as Prisma.InputJsonValue } })
        .catch(() => prisma.webhookEvent.findUniqueOrThrow({ where: { key } })) // lost a race with a concurrent delivery

      try {
        await processEndOfCall(req.body)
        await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 }, error: null } })
      } catch (e) {
        const message = (e as Error).message.slice(0, 300)
        logger.error({ callId, err: message }, 'end-of-call processing failed; queued for retry')
        await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'failed', attempts: { increment: 1 }, error: message } })
        await markCallProcessingFailed(callId, message)
        await enqueue('process-webhook', { eventId: event.id }, { jobId: `evt-${event.id}-${Date.now()}` })
      }
      return res.status(200).json({ received: true })
    }

    // status-update, transcript, speech-update, conversation-update, hang, ...: acknowledged and ignored.
    return res.status(200).json({ received: true })
  }),
)
