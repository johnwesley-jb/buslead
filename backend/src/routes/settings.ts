import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { me, requireAuth, requireRole } from '../middleware/auth'
import { parse, wrap } from '../middleware/common'
import { logActivity } from '../services/audit'
import { getSettingsDto, settingsSchema } from '../services/settings'

export const settings = Router()
settings.use(requireAuth)

settings.get(
  '/',
  wrap(async (_req, res) => {
    res.json(await getSettingsDto())
  }),
)

settings.put(
  '/',
  requireRole('admin'),
  wrap(async (req, res) => {
    // `selectedCalendarId` is owned by the calendar connection and ignored here.
    const b = parse(settingsSchema, req.body)
    await prisma.businessSettings.upsert({ where: { id: 1 }, update: b, create: { id: 1, ...b } })
    await logActivity({ action: 'settings.updated', details: 'Business scheduling settings updated', actor: me(req).name })
    res.json(await getSettingsDto())
  }),
)
