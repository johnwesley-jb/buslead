/** Returns an E.164 number, or null when the input cannot be one. US numbers default to +1 (same rule as the dashboard). */
export function normalizePhone(input: string): string | null {
  const trimmed = (input ?? '').trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
