/**
 * /api/v1/orchestrate — WKH-66 thin-proxy wrapper.
 *
 * Cuando `V2_DELEGATE_TO_A2A` incluye `orchestrate`, este endpoint reenvía
 * al servicio canónico wasiai-a2a. Cuando NO está activo, responde 503
 * (la lógica legacy fue removida en WKH-66 — ver SDD).
 */
import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isDelegated, forwardRequest } from '@/lib/proxy/forward-handler'

export const maxDuration = 200

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isDelegated('orchestrate')) {
    return NextResponse.json(
      {
        error: 'ORCHESTRATE_DISABLED',
        detail:
          'Legacy orchestrate handler removed in WKH-66. Set V2_DELEGATE_TO_A2A=orchestrate to enable proxy mode.',
      },
      { status: 503 },
    )
  }
  return forwardRequest(req, `${env.WASIAI_A2A_BASE_URL}/orchestrate`)
}
