import argon2 from 'argon2'
import type { Role } from '@prisma/client'
import { env } from '../config/env'
import { hmacToken, randomToken } from '../lib/crypto'
import { prisma } from '../lib/prisma'

/** Argon2id with OWASP-recommended parameters (19 MiB, 2 passes, 1 lane). */
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON)

// Verified against when the account does not exist, so response time does not reveal which emails are registered.
let dummyHash: Promise<string> | undefined
export const verifyPassword = async (hash: string | null, pw: string) => {
  try {
    if (!hash) {
      dummyHash ??= hashPassword(randomToken())
      await argon2.verify(await dummyHash, pw)
      return false
    }
    return await argon2.verify(hash, pw)
  } catch {
    return false
  }
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000)
  await prisma.session.create({
    data: { userId, tokenHash: hmacToken(token, env.SESSION_SECRET), expiresAt, ip: meta.ip?.slice(0, 64), userAgent: meta.userAgent?.slice(0, 256) },
  })
  return { token, maxAgeSeconds: Math.floor((expiresAt.getTime() - Date.now()) / 1000) }
}

/** Returns the signed-in user for a cookie token, or null. Enforces absolute and idle expiry. */
export async function resolveSession(token: string | undefined): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token || token.length > 128) return null
  const session = await prisma.session.findUnique({ where: { tokenHash: hmacToken(token, env.SESSION_SECRET) }, include: { user: true } })
  if (!session) return null
  const now = Date.now()
  const idleLimit = session.lastSeenAt.getTime() + env.SESSION_IDLE_MINUTES * 60_000
  if (session.expiresAt.getTime() <= now || idleLimit <= now || !session.user.active) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined)
  }
  const { id, name, email, role } = session.user
  return { user: { id, name, email, role }, sessionId: session.id }
}

export const destroySession = (sessionId: string) => prisma.session.deleteMany({ where: { id: sessionId } })

export const destroyOtherSessions = (userId: string, keepSessionId?: string) =>
  prisma.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } })

export const purgeExpiredSessions = () => prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
