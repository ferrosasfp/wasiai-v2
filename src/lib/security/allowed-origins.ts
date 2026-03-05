/**
 * allowed-origins.ts — Validación de origins seguros
 *
 * NG-001 + NG-004: Centraliza allowlist de hosts para OAuth callbacks y Server Actions.
 * Patrón: Allowlist > Blocklist. Nunca confiar en headers no validados.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? ''

const ALLOWED_HOSTS = [
  SITE_URL ? new URL(SITE_URL).host : null,
  'localhost:3000',
  'localhost:3001',
].filter(Boolean) as string[]

/**
 * NG-001: Para uso en Route Handlers donde tenemos el Request object.
 * Valida x-forwarded-host (Vercel) contra allowlist antes de usarlo.
 */
export function getSafeOrigin(request: Request): string {
  const isLocalEnv = process.env.NODE_ENV === 'development'

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost && ALLOWED_HOSTS.includes(forwardedHost)) {
    return `${isLocalEnv ? 'http' : 'https'}://${forwardedHost}`
  }

  try {
    const requestUrl  = new URL(request.url)
    const requestHost = requestUrl.host
    if (ALLOWED_HOSTS.includes(requestHost)) {
      return requestUrl.origin
    }
  } catch { /* URL inválida — caer al fallback */ }

  // Fallback seguro
  return SITE_URL || new URL(request.url).origin
}

/**
 * NG-004: Para uso en Server Actions donde no tenemos el Request object,
 * sino los headers() de Next.js.
 */
export function getSafeOriginFromHeaders(headersList: Headers): string {
  const origin = headersList.get('origin')
  if (origin) {
    try {
      const host = new URL(origin).host
      if (ALLOWED_HOSTS.includes(host)) return origin
    } catch { /* URL inválida */ }
  }

  // Fallback seguro
  return SITE_URL || 'http://localhost:3000'
}
