import { Queue } from 'bullmq'
import type { JobsOptions } from 'bullmq'
import { logger } from '../lib/logger'
import { makeRedis } from '../lib/redis'

export const QUEUE_NAME = 'buslead'

export type JobName = 'reserve-retry' | 'auto-assign' | 'process-webhook' | 'reconcile' | 'retention' | 'sweep'

let queue: Queue | null = null
export function getQueue() {
  queue ??= new Queue(QUEUE_NAME, { connection: makeRedis() })
  return queue
}

const defaults: JobsOptions = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 7 * 86_400, count: 1000 },
}

/**
 * Enqueue a background job. Never throws: if Redis is down the caller's request must still succeed, and the
 * periodic sweep (see worker.ts) re-discovers anything that was left unfinished in the database.
 * `jobId` makes enqueueing idempotent (BullMQ ignores a second job with the same id while one exists).
 */
export async function enqueue(name: JobName, data: Record<string, unknown>, opts: JobsOptions & { jobId?: string } = {}) {
  try {
    await getQueue().add(name, data, { ...defaults, ...opts })
    return true
  } catch (e) {
    logger.error({ err: (e as Error).message, job: name }, 'could not enqueue job (Redis unavailable?); the sweep will pick it up')
    return false
  }
}

export async function closeQueue() {
  await queue?.close().catch(() => undefined)
}
