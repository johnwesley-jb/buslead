import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { decrypt, encrypt, hmacToken, randomToken, safeEqual } from '../src/lib/crypto'
import { isAllowedRecordingUrl } from '../src/lib/recordingHost'
import { normalizePhone } from '../src/lib/phone'
import { isBlockedOnPublicHost } from '../src/lib/tunnel'

const key = randomBytes(32).toString('base64')

test('AES-GCM round trip and unique IV', () => {
  const a = encrypt('refresh-token-value', key)
  const b = encrypt('refresh-token-value', key)
  assert.notEqual(a, b)
  assert.ok(!a.includes('refresh-token-value'))
  assert.equal(decrypt(a, key), 'refresh-token-value')
})

test('tampered or wrong-key ciphertext is rejected', () => {
  const c = encrypt('secret', key)
  const parts = c.split('.')
  const flipped = [parts[0], parts[1], parts[2], Buffer.from('x' + Buffer.from(parts[3], 'base64url').toString('latin1').slice(1), 'latin1').toString('base64url')].join('.')
  assert.throws(() => decrypt(flipped, key))
  assert.throws(() => decrypt(c, randomBytes(32).toString('base64')))
  assert.throws(() => decrypt('garbage', key))
})

test('session token hashing is keyed and deterministic', () => {
  const t = randomToken()
  assert.equal(hmacToken(t, 'a'.repeat(32)), hmacToken(t, 'a'.repeat(32)))
  assert.notEqual(hmacToken(t, 'a'.repeat(32)), hmacToken(t, 'b'.repeat(32)))
  assert.notEqual(randomToken(), randomToken())
  assert.ok(randomToken().length >= 43)
})

test('safeEqual compares values of different length without throwing', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', 'x'), false)
})

test('recording proxy only allows https hosts on the allowlist', () => {
  const list = 'storage.vapi.ai,.vapi.ai'
  assert.equal(isAllowedRecordingUrl('https://storage.vapi.ai/a.wav', list), true)
  assert.equal(isAllowedRecordingUrl('https://cdn.vapi.ai/a.wav', list), true)
  assert.equal(isAllowedRecordingUrl('http://storage.vapi.ai/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://evil.com/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://vapi.ai.evil.com/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://evilvapi.ai/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://storage.vapi.ai@evil.com/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://user:pw@storage.vapi.ai/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://storage.vapi.ai:8443/a.wav', list), false)
  assert.equal(isAllowedRecordingUrl('https://169.254.169.254/latest/meta-data', list), false)
  assert.equal(isAllowedRecordingUrl('https://localhost/a.wav', 'localhost'), false)
  assert.equal(isAllowedRecordingUrl('not a url', list), false)
  assert.equal(isAllowedRecordingUrl('https://x.vapi.ai/a', ''), false)
})

test('phone normalisation', () => {
  assert.equal(normalizePhone('(555) 123-4567'), '+15551234567')
  assert.equal(normalizePhone('1 555 123 4567'), '+15551234567')
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958')
  assert.equal(normalizePhone('12345'), null)
  assert.equal(normalizePhone(''), null)
})

test('tunnel guard: only the webhook and health are served on the public hostname', () => {
  const pub = 'abc.ngrok-free.app'
  assert.equal(isBlockedOnPublicHost(pub, '/api/webhooks/vapi', pub), false)
  assert.equal(isBlockedOnPublicHost(pub, '/health', pub), false)
  assert.equal(isBlockedOnPublicHost(pub, '/api/auth/login', pub), true)
  assert.equal(isBlockedOnPublicHost(pub, '/api/leads', pub), true)
  assert.equal(isBlockedOnPublicHost('ABC.ngrok-free.app', '/api/auth/login', pub), true)
  assert.equal(isBlockedOnPublicHost('localhost:4000', '/api/auth/login', pub), false)
  assert.equal(isBlockedOnPublicHost(pub, '/api/auth/login', undefined), false)
})
