/**
 * Build a CSP `connect-src` allowlist from `VITE_API_ORIGIN`.
 * Always includes `'self'`; when an API origin is set, also allows its HTTP(S)
 * origin and the matching WS(S) origin (Socket.IO).
 */
export function cspConnectSrc(apiOrigin: string | undefined): string {
  const parts = ["'self'"]
  const trimmed = apiOrigin?.trim()
  if (!trimmed) return parts.join(' ')

  try {
    const url = new URL(trimmed)
    parts.push(url.origin)
    parts.push(`${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`)
  } catch {
    // Invalid origin → same-origin only; leave the build usable.
  }

  return parts.join(' ')
}
