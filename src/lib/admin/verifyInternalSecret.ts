import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * V-12 (audit 2026-06-25): constant-time comparison of the provided secret
 * against the configured one. Length-guarded because timingSafeEqual throws on
 * unequal-length buffers. Replaces the timing-leaky `provided !== secret`.
 */
function constantTimeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * NA-005: Verifica que el request incluye el INTERNAL_API_SECRET correcto.
 * Usado para proteger endpoints /api/v1/agents-internal/*.
 *
 * Header esperado: x-internal-secret: <INTERNAL_API_SECRET>
 *
 * Retorna null si es válido, o un NextResponse 401/500 si no.
 */
export function verifyInternalSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'INTERNAL_API_SECRET not configured' }, { status: 500 })
  }

  const provided = request.headers.get('x-internal-secret')?.trim()
  if (!provided || !constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
