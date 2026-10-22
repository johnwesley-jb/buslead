import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@prisma/client'
import { SESSION_COOKIE, parseCookies } from '../lib/cookies'
import { forbidden, unauthorized } from '../lib/errors'
import { resolveSession } from '../services/auth'
import type { SessionUser } from '../services/auth'

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { user: SessionUser; sessionId: string }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    const s = await resolveSession(token)
    if (!s) return next(unauthorized())
    req.auth = s
    next()
  } catch (e) {
    next(e)
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    if (!roles.includes(req.auth.user.role)) return next(forbidden('Only admins can do this.'))
    next()
  }

export const me = (req: Request) => {
  if (!req.auth) throw unauthorized()
  return req.auth.user
}
