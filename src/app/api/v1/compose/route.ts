/**
 * /api/v1/compose — WKH-66 thin-proxy wrapper.
 *
 * Cuando `V2_DELEGATE_TO_A2A` incluye `compose`, este endpoint reenvía el
 * request al servicio canónico wasiai-a2a (Fastify, Railway). Cuando NO está
 * activo, responde 503 (la lógica legacy de pipeline v2 fue removida en
 * WKH-66 — ver doc/sdd/072-wkh-66-v2-thin-proxy/sdd.md).
 *
 * Pre-check AC-11: requests con `start_from_step` se rechazan con 422 antes
 * de tocar upstream — el modo retry no se soporta en proxy mode.
 */
import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isDelegated, forwardRequest } from '@/lib/proxy/forward-handler'

export const maxDuration = 200

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isDelegated('compose')) {
    return NextResponse.json(
      {
        error: 'COMPOSE_DISABLED',
        detail:
          'Legacy compose handler removed in WKH-66. Set V2_DELEGATE_TO_A2A=compose to enable proxy mode.',
      },
      { status: 503 },
    )
  }

  // AC-11: pre-check retry mode (start_from_step) — 422 estable.
  // Lectura del body es single-shot en NextRequest, así que reconstruimos
  // un nuevo NextRequest después si vamos a forwardear.
  const bodyText = await req.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    /* leave null — body may not be JSON; forward as-is */
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed !== null &&
    'start_from_step' in (parsed as Record<string, unknown>) &&
    (parsed as Record<string, unknown>).start_from_step !== undefined
  ) {
    return NextResponse.json(
      {
        error: 'RETRY_MODE_NOT_SUPPORTED',
        detail: 'pipeline retry not available in proxy mode',
      },
      { status: 422 },
    )
  }

  // Reconstruir NextRequest con el body ya leído (NextRequest body es single-shot).
  // `duplex: 'half'` es requerido por undici cuando body es un stream-able value.
  // El tipo RequestInit de Next difiere del DOM-lib (signal: AbortSignal | undefined,
  // sin `null`), por eso construimos el init y casteamos vía `unknown`.
  const initWithBody = {
    method: req.method,
    headers: req.headers,
    body: bodyText,
    duplex: 'half',
  }
  const proxiedReq = new NextRequest(
    req.url,
    initWithBody as unknown as ConstructorParameters<typeof NextRequest>[1],
  )

  return forwardRequest(proxiedReq, `${env.WASIAI_A2A_BASE_URL}/compose`)
}
