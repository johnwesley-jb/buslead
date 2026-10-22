/**
 * When the API is reachable from the internet through a tunnel (ngrok, Cloudflare), only the Vapi webhook and the
 * liveness check may be served on that public hostname. Login, the dashboard API and OAuth stay local-only.
 * Do not enable "host header rewrite" in the tunnel, or this check cannot tell public requests from local ones.
 */
export function isBlockedOnPublicHost(host: string | undefined, path: string, publicHost: string | undefined): boolean {
  if (!publicHost || !host) return false
  if (host.toLowerCase() !== publicHost.toLowerCase()) return false
  return !(path === '/health' || path.startsWith('/api/webhooks/'))
}
