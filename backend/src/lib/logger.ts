import pino from 'pino'
import { env } from '../config/env'

/**
 * Structured logs. Secrets and personal data are redacted by path; never log request bodies,
 * transcripts, phone numbers or emails. Log IDs instead.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-vapi-secret"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.access_token',
      '*.refresh_token',
      '*.email',
      '*.phoneNumber',
    ],
    censor: '[redacted]',
  },
  transport: env.isProd ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
})
