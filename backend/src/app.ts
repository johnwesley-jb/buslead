import express from 'express'
import { pinoHttp } from 'pino-http'
import { randomUUID } from 'node:crypto'
import { env } from './config/env'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { errorHandler, notFoundHandler } from './middleware/common'
import { apiLimiter, corsPolicy, csrfGuard, noStore, securityHeaders, tunnelGuard } from './middleware/security'
import { appointments } from './routes/appointments'
import { auth } from './routes/auth'
import { calendar } from './routes/calendar'
import { calls } from './routes/calls'
import { dashboard } from './routes/dashboard'
import { leads } from './routes/leads'
import { settings } from './routes/settings'
import { users } from './routes/users'
import { webhooks } from './routes/webhooks'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', env.TRUST_PROXY)

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID(),
      // Query strings can carry OAuth codes, and bodies carry personal data: log neither.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  )
  app.use(tunnelGuard)
  app.use(securityHeaders)
  app.use(corsPolicy)
  app.use(noStore)

  // Liveness only; reveals nothing about the system.
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ ok: true })
    } catch {
      res.status(503).json({ ok: false })
    }
  })

  // Bearer-authenticated, cookie-free, with its own body parser and rate limit. Mounted before CSRF and the JSON parser.
  app.use('/api/webhooks', webhooks)

  app.use(express.json({ limit: '100kb' }))
  app.use('/api', apiLimiter, csrfGuard)
  app.use('/api/auth', auth)
  app.use('/api/users', users)
  app.use('/api/leads', leads)
  app.use('/api/calls', calls)
  app.use('/api/appointments', appointments)
  app.use('/api/calendar', calendar)
  app.use('/api/settings', settings)
  app.use('/api/dashboard', dashboard)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
