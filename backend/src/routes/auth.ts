import { Router } from 'express'
import { z } from 'zod'
import { SESSION_COOKIE, clearSecureCookie, parseCookies, setSecureCookie } from '../lib/cookies'
import { AppError, unauthorized } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { me, requireAuth } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { loginLimiter } from '../middleware/security'
import { logActivity } from '../services/audit'
import { createSession, destroyOtherSessions, destroySession, hashPassword, resolveSession, verifyPassword } from '../services/auth'

export const auth = Router()

export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(128, 'Use at most 128 characters')

const MAX_FAILED = 5
const LOCK_MINUTES = 15
// One message for every failure so the response never reveals whether an account exists or is locked.
const BAD_LOGIN = new AppError(401, 'INVALID_CREDENTIALS', 'That email and password do not match, or the account is temporarily locked. Check both and try again.')

auth.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128) }), req.body)
    const user = await prisma.user.findUnique({ where: { email } })
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date())
    const ok = await verifyPassword(user?.passwordHash ?? null, password) // always runs, even for unknown emails
    if (!user || !user.active || locked || !ok) {
      if (user && !locked) {
        const failed = user.failedLogins + 1
        await prisma.user.update({ where: { id: user.id }, data: failed >= MAX_FAILED ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed } })
        if (failed >= MAX_FAILED) await logActivity({ action: 'auth.locked', details: `Account locked for ${LOCK_MINUTES} minutes after repeated failures`, actor: user.name })
      }
      throw BAD_LOGIN
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } })

    // A fresh token on every login (no session fixation). Existing sessions of this user stay valid.
    const s = await createSession(user.id, { ip: req.ip, userAgent: req.get('user-agent') })
    setSecureCookie(res, SESSION_COOKIE, s.token, s.maxAgeSeconds)
    await logActivity({ action: 'auth.login', details: 'Signed in', actor: user.name })
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role })
  }),
)

auth.post(
  '/logout',
  wrap(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (token) {
      const s = await resolveSession(token)
      if (s) await destroySession(s.sessionId)
    }
    clearSecureCookie(res, SESSION_COOKIE)
    res.json({ ok: true })
  }),
)

auth.get('/me', requireAuth, (req, res) => res.json(me(req)))

auth.patch(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body)
    const u = await prisma.user.update({ where: { id: me(req).id }, data: { name }, select: { id: true, name: true, email: true, role: true } })
    res.json(u)
  }),
)

auth.post(
  '/change-password',
  requireAuth,
  loginLimiter,
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }), req.body)
    const user = await prisma.user.findUnique({ where: { id: me(req).id } })
    if (!user) throw unauthorized()
    if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new AppError(400, 'INVALID_CREDENTIALS', 'Your current password is not correct.')
    if (newPassword === currentPassword) throw new AppError(400, 'VALIDATION', 'Choose a password you have not used just now.')
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } })
    await destroyOtherSessions(user.id, req.auth!.sessionId) // other devices must sign in again
    await logActivity({ action: 'user.password_changed', details: 'Password changed; other sessions signed out', actor: user.name })
    res.json({ ok: true })
  }),
)
