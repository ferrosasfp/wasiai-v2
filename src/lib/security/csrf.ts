/**
 * csrf.ts — CSRF protection via Origin header validation
 *
 * S-02: Validates the Origin header against the allowed site URL.
 * Apply to all API routes that mutate state (POST, PUT, DELETE).
 *
 * Usage:
 *   const csrfError = validateCsrf(request)
 *   if (csrfError) return csrfError
 */
import { type NextRequest, NextResponse } from 'next/server'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')
  .trim()
  .replace(/\/$/, '')

// Build list of allowed origins (add staging/preview URLs here if needed)
const ALLOWED_ORIGINS = new Set([
  SITE_URL,
  // Allow localhost during development
  ...(process.env.NODE_ENV === 'development'
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
].filter(Boolean))

/**
 * Returns a 403 NextResponse if the request origin is not allowed,
 * or null if the request is valid.
 *
 * Note: Only checks browser-initiated requests (those with an Origin header).
 * Server-to-server calls (no Origin) pass through — they are CORS-safe by nature.
 */
export function validateCsrf(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin')

  // No origin header = non-browser request (server-to-server, curl, etc.)
  // These are safe to pass through — CORS prevents cross-origin browser attacks
  if (!origin) return null

  if (!ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json(
      { error: 'Forbidden: invalid origin' },
      { status: 403 },
    )
  }

  return null
}
