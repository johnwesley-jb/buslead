import cors from 'cors'
import helmet from 'helmet'
import type { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../config/env'
import { AppError } from '../lib/errors'
import { isBlockedOnPublicHost } from '../lib/tunnel'

/** The API serves JSON only, so the CSP forbids everything. */
export const securityHeaders = helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
})

/** Exactly one allowed browser origin. No wildcards, ever, because credentials are enabled. */
export const corsPolicy = cors({
  origin: (origin, cb) => cb(null, !origin || origin === env.FRONTEND_ORIGIN),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
  maxAge: 600,
})

/** Responses contain personal data: never cache them in the browser or an intermediary. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

const publicHost = (() => {
  try {
    return env.PUBLIC_API_URL ? new URL(env.PUBLIC_API_URL).host : undefined
  } catch {
    return undefined
  }
})()

export function tunnelGuard(req: Request, res: Response, next: NextFunction) {
  if (isBlockedOnPublicHost(req.get('host'), req.path, publicHost)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })
  next()
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for cookie-authenticated requests, layered on SameSite=Lax:
 *  1. state-changing requests must carry a custom header (a cross-site form or <img> cannot set it, and a
 *     cross-site fetch that sets it triggers a CORS preflight, which only FRONTEND_ORIGIN passes);
 *  2. if the browser sent an Origin header it must be the dashboard origin.
 * Vapi webhooks use bearer authentication, not cookies, and are mounted before this middleware.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next()
  const origin = req.get('origin')
  if (origin && origin !== env.FRONTEND_ORIGIN) return next(new AppError(403, 'CSRF', 'Request origin is not allowed.'))
  if (req.get('x-requested-with') !== 'buslead') return next(new AppError(403, 'CSRF', 'Missing required request header.'))
  next()
}

const tooMany = (message: string) => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(429, 'RATE_LIMITED', message))

const common = { standardHeaders: 'draft-7' as const, legacyHeaders: false }

export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 300,
  handler: tooMany('Too many requests. Slow down and try again shortly.'),
})

export const loginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  handler: tooMany('Too many sign-in attempts. Try again in a few minutes.'),
})

export const webhookLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 600,
  handler: tooMany('Rate limit exceeded.'),
})

/** Expensive or externally billed endpoints (recording streams, Vapi lookups, Google calls). */
export const heavyLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 60,
  handler: tooMany('Too many requests. Try again in a minute.'),
})
