import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import type { ZodTypeAny, z } from 'zod'
import { Prisma } from '@prisma/client'
import { AppError, badRequest } from '../lib/errors'
import { logger } from '../lib/logger'

/** Wraps async handlers so rejections reach the error middleware. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next)
  }

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const first = r.error.issues[0]
    const where = first.path.length ? `${first.path.join('.')}: ` : ''
    throw badRequest(`${where}${first.message}`, 'VALIDATION', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  return r.data
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })
}

/** Central error handler. Only AppError messages reach the client; everything else is a generic 500. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } })
  }
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION', message: err.issues[0]?.message ?? 'Invalid request.' } })
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body.' } })
  if ((err as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body is too large.' } })
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } })
  }
  logger.error({ err: { name: (err as Error)?.name, message: (err as Error)?.message, stack: (err as Error)?.stack }, method: req.method, path: req.path }, 'unhandled error')
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again.' } })
}
