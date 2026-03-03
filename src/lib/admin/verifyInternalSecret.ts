import { NextRequest, NextResponse } from 'next/server'

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
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
