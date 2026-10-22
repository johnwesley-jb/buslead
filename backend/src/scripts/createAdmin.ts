/**
 * Creates the first admin from INITIAL_ADMIN_* in .env (the password never appears in a command line or in logs).
 *   npm run admin:create                 -> creates the account if it does not exist
 *   npm run admin:create -- --reset      -> resets the password of an existing account
 * After the first sign-in, remove INITIAL_ADMIN_PASSWORD from .env.
 */
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../services/auth'
import { getSettingsRow } from '../services/settings'

async function main() {
  const { INITIAL_ADMIN_EMAIL: email, INITIAL_ADMIN_PASSWORD: password, INITIAL_ADMIN_NAME: name } = env
  if (!email || !password) throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in .env first.')
  if (password.length < 12) throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters.')
  await getSettingsRow()

  const reset = process.argv.includes('--reset')
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing && !reset) {
    console.log(`An account for ${email} already exists. Use --reset to change its password.`)
    return
  }
  const passwordHash = await hashPassword(password)
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, active: true, role: 'admin', failedLogins: 0, lockedUntil: null } })
    await prisma.session.deleteMany({ where: { userId: existing.id } })
    console.log(`Password reset for ${email}. Existing sessions were signed out.`)
  } else {
    await prisma.user.create({ data: { email: email.toLowerCase(), name: name || 'Admin', passwordHash, role: 'admin' } })
    console.log(`Admin account created for ${email}.`)
  }
  console.log('Now remove INITIAL_ADMIN_PASSWORD from .env.')
}

main()
  .catch((e) => {
    console.error((e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
