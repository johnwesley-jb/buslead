import 'dotenv/config'
import { z } from 'zod'

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(emptyToUndef, s.optional())
const bool = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.enum(['true', 'false']).transform((v) => v === 'true'),
)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: opt(z.string().url()),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32
    } catch {
      return false
    }
  }, 'ENCRYPTION_KEY must be 32 random bytes, base64 encoded'),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(24 * 60).default(120),
  COOKIE_SECURE: opt(bool),

  VAPI_API_KEY: opt(z.string().min(10)),
  VAPI_WEBHOOK_SECRET: z.string().min(32, 'VAPI_WEBHOOK_SECRET must be at least 32 characters'),
  VAPI_ASSISTANT_ID: opt(z.string()),
  RECORDING_HOST_ALLOWLIST: z.string().default('storage.vapi.ai,.vapi.ai'),

  GOOGLE_CLIENT_ID: opt(z.string()),
  GOOGLE_CLIENT_SECRET: opt(z.string()),
  GOOGLE_REDIRECT_URI: z.string().url().default('http://localhost:4000/api/calendar/callback'),
  GOOGLE_OAUTH_TESTING_MODE: z.preprocess(emptyToUndef, bool.default('true')),

  AUTO_ASSIGN_UNBOOKED: z.preprocess(emptyToUndef, bool.default('true')),

  INITIAL_ADMIN_NAME: opt(z.string()),
  INITIAL_ADMIN_EMAIL: opt(z.string().email()),
  INITIAL_ADMIN_PASSWORD: opt(z.string()),
})

export type Env = z.infer<typeof schema> & { cookieSecure: boolean; isProd: boolean }

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    // Names and reasons only. Values are never printed.
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example.`)
  }
  const e = parsed.data
  const isProd = e.NODE_ENV === 'production'
  if (e.SESSION_SECRET === e.VAPI_WEBHOOK_SECRET) throw new Error('SESSION_SECRET and VAPI_WEBHOOK_SECRET must be different values.')
  return { ...e, isProd, cookieSecure: e.COOKIE_SECURE ?? isProd }
}

export const env: Env = loadEnv(process.env)

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
