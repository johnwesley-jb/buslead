import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Import the loader only; it must not read process.env at import time in a way that fails the test run.
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/x'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.SESSION_SECRET ??= 's'.repeat(40)
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.VAPI_WEBHOOK_SECRET ??= 'w'.repeat(40)

const good = () => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 's'.repeat(40),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  VAPI_WEBHOOK_SECRET: 'w'.repeat(40),
})

test('accepts a minimal valid configuration and applies defaults', async () => {
  const { loadEnv } = await import('../src/config/env')
  const e = loadEnv(good() as never)
  assert.equal(e.PORT, 4000)
  assert.equal(e.cookieSecure, false)
  assert.equal(e.AUTO_ASSIGN_UNBOOKED, true)
})

test('empty optional values are treated as unset', async () => {
  const { loadEnv } = await import('../src/config/env')
  const e = loadEnv({ ...good(), GOOGLE_CLIENT_ID: '', COOKIE_SECURE: '', VAPI_API_KEY: '', PUBLIC_API_URL: '' } as never)
  assert.equal(e.GOOGLE_CLIENT_ID, undefined)
  assert.equal(e.PUBLIC_API_URL, undefined)
})

test('rejects weak or malformed secrets without echoing their values', async () => {
  const { loadEnv } = await import('../src/config/env')
  assert.throws(() => loadEnv({ ...good(), SESSION_SECRET: 'short' } as never), /SESSION_SECRET/)
  assert.throws(() => loadEnv({ ...good(), ENCRYPTION_KEY: 'not-32-bytes' } as never), /ENCRYPTION_KEY/)
  assert.throws(() => loadEnv({ ...good(), VAPI_WEBHOOK_SECRET: 'tiny' } as never), /VAPI_WEBHOOK_SECRET/)
  try {
    loadEnv({ ...good(), SESSION_SECRET: 'short-secret-value' } as never)
  } catch (e) {
    assert.ok(!String((e as Error).message).includes('short-secret-value'))
  }
})

test('SESSION_SECRET and VAPI_WEBHOOK_SECRET must differ', async () => {
  const { loadEnv } = await import('../src/config/env')
  assert.throws(() => loadEnv({ ...good(), SESSION_SECRET: 'x'.repeat(40), VAPI_WEBHOOK_SECRET: 'x'.repeat(40) } as never), /different/)
})

test('secure cookies default on in production', async () => {
  const { loadEnv } = await import('../src/config/env')
  assert.equal(loadEnv({ ...good(), NODE_ENV: 'production' } as never).cookieSecure, true)
  assert.equal(loadEnv({ ...good(), NODE_ENV: 'production', COOKIE_SECURE: 'false' } as never).cookieSecure, false)
})
