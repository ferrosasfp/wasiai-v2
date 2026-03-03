/**
 * GET /api/v1/escrow/[escrowId]/status
 *
 * Returns escrow status for authenticated payer.
 * Auth: Bearer JWT (Supabase user session) or X-API-Key
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase/server'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ escrowId: string }> },
) {
  const { escrowId } = await params
  const svc = createServiceClient()

  // ── Auth: resolve user from JWT ────────────────────────────────────────────
  let userId: string | null = null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    userId = user.id
  } else {
    // Try API key fallback
    const apiKey = request.headers.get('X-API-Key') ?? request.headers.get('x-api-key')
    if (apiKey) {
      const keyHash = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey)),
      ).toString('hex')
      const { data: keyData } = await svc
        .from('agent_keys')
        .select('user_id')
        .eq('key_hash', keyHash)
        .eq('status', 'active')
        .single()
      if (keyData) userId = keyData.user_id
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Authentication required' },
      { status: 401, headers: CORS },
    )
  }

  // ── Query escrow_transactions ──────────────────────────────────────────────
  const { data: escrow, error } = await svc
    .from('escrow_transactions')
    .select('*')
    .eq('escrow_id', escrowId)
    .eq('payer_user_id', userId)
    .single()

  if (error || !escrow) {
    return NextResponse.json(
      { error: 'not_found', message: 'Escrow not found or not authorized' },
      { status: 404, headers: CORS },
    )
  }

  return NextResponse.json(
    {
      escrow_id:   escrow.escrow_id,
      status:      escrow.status,
      amount_usdc: String(escrow.amount_usdc),
      agent_slug:  escrow.agent_slug,
      created_at:  escrow.created_at,
      released_at: escrow.released_at ?? null,
      result_data: escrow.result_data ?? null,
    },
    { status: 200, headers: CORS },
  )
}
