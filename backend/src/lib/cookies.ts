import type { Response } from 'express'
import { env } from '../config/env'

/** `__Host-` binds the cookie to this exact host over HTTPS with Path=/ and no Domain attribute. */
export const SESSION_COOKIE = env.cookieSecure ? '__Host-bl_session' : 'bl_session'
export const OAUTH_STATE_COOKIE = env.cookieSecure ? '__Host-bl_oauth' : 'bl_oauth'

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (!k || k in out) continue
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      /* ignore malformed */
    }
  }
  return out
}

export function setSecureCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  })
}

export function clearSecureCookie(res: Response, name: string) {
  res.clearCookie(name, { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/' })
}
