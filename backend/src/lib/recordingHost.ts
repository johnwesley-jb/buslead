/**
 * SSRF guard for the recording proxy. The server only ever fetches https URLs whose host is on an allowlist,
 * has no credentials in the URL, and uses the default port. Redirects are never followed.
 * Allowlist entries: "storage.vapi.ai" matches exactly; ".vapi.ai" matches any subdomain.
 */
export function isAllowedRecordingUrl(raw: string, allowlist: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  const host = u.hostname.toLowerCase()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host === 'localhost') return false // no IP literals
  return allowlist
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => (rule.startsWith('.') ? host.endsWith(rule) && host.length > rule.length : host === rule))
}
