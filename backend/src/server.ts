import { createApp } from './app'
import { env } from './config/env'
import { closeQueue } from './jobs/queues'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { getSettingsRow } from './services/settings'

async function main() {
  await prisma.$connect()
  await getSettingsRow() // makes sure the single settings row exists
  const app = createApp()
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Buslead API listening')
    if (env.PUBLIC_API_URL) logger.info(`Vapi server URL: ${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/webhooks/vapi`)
  })
  server.requestTimeout = 120_000
  server.headersTimeout = 20_000

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down')
    server.close(async () => {
      await closeQueue()
      await prisma.$disconnect()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 15_000).unref()
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

process.on('unhandledRejection', (reason) => logger.error({ reason: String(reason) }, 'unhandled rejection'))

main().catch((e) => {
  logger.error({ err: (e as Error).message }, 'failed to start')
  process.exit(1)
})
