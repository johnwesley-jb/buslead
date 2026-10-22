import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** AES-256-GCM with a fresh 96-bit IV per message. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decrypt(payload: string, keyB64: string): string {
  const [v, iv, tag, ct] = payload.split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

/** 256 bits of randomness, URL safe. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Keyed hash for storing session tokens: a database leak alone cannot be replayed as cookies. */
export const hmacToken = (token: string, secret: string) => createHmac('sha256', secret).update(token).digest('hex')

/** Constant-time string comparison that does not leak length (both sides are hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
