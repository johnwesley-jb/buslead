import { Router } from 'express'
import { z } from 'zod'
import { AppError, notFound } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { me, requireAuth, requireRole } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { logActivity } from '../services/audit'
import { destroyOtherSessions, hashPassword } from '../services/auth'
import { passwordSchema } from './auth'

/** Admin-only account management. There is no public sign-up: admins create every account. */
export const users = Router()
users.use(requireAuth, requireRole('admin'))

const publicUser = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const

users.get(
  '/',
  wrap(async (_req, res) => {
    res.json(await prisma.user.findMany({ select: publicUser, orderBy: { createdAt: 'asc' } }))
  }),
)

users.post(
  '/',
  wrap(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['admin', 'agent']), password: passwordSchema }), req.body)
    if (await prisma.user.findUnique({ where: { email: b.email } })) throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists.')
    const u = await prisma.user.create({ data: { name: b.name, email: b.email, role: b.role, passwordHash: await hashPassword(b.password) }, select: publicUser })
    await logActivity({ action: 'user.created', details: `Created ${b.role} account for ${b.name}`, actor: me(req).name })
    res.status(201).json(u)
  }),
)

users.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id)
    const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), role: z.enum(['admin', 'agent']).optional(), active: z.boolean().optional(), password: passwordSchema.optional() }), req.body)
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw notFound('User not found.')
    // An admin cannot lock themselves out or demote themselves; that avoids ending up with no admin.
    if (id === me(req).id && (b.active === false || (b.role && b.role !== 'admin'))) throw new AppError(400, 'VALIDATION', 'You cannot deactivate or demote your own account.')
    const u = await prisma.user.update({
      where: { id },
      data: { name: b.name, role: b.role, active: b.active, ...(b.password ? { passwordHash: await hashPassword(b.password), failedLogins: 0, lockedUntil: null } : {}) },
      select: publicUser,
    })
    if (b.active === false || b.password) await destroyOtherSessions(id) // takes effect immediately
    await logActivity({ action: 'user.updated', details: `Updated account for ${target.name}${b.password ? ' (password reset)' : ''}${b.active === false ? ' (deactivated)' : ''}`, actor: me(req).name })
    res.json(u)
  }),
)
