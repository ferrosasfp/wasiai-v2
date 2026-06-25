/**
 * /api/creator/agents/[slug]/status — PATCH (toggle active/paused/draft)
 *
 * S-02: CSRF validation.
 * Ownership check: creator_id must match authenticated user.
 * HU-1.2: Added 'draft' as valid status value.
 *         registerAgentOnChain moved here — fires when status → 'active'.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { registerAgentOnChain } from '@/lib/contracts/marketplaceClient'
import { probeEndpointSync } from '@/lib/agents/health-probe'
import { logger } from '@/lib/logger'
import { jsonError } from '@/lib/api/jsonError'

// HU-1.2: 'draft' added to support multi-step publish flow
const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'draft']),
  // WAS-160b: Optional registration type — set when publishing with wallet choice
  registration_type: z.enum(['off_chain', 'on_chain']).optional(),
  // WAS-160b: txHash from client-side selfRegisterAgent — used to verify on-chain registration
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const result = statusSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid status — must be "active", "paused", or "draft"' },
      { status: 400 },
    )
  }

  const serviceClient = createServiceClient()

  // Ownership check
  const { data: existing } = await serviceClient
    .from('agents')
    .select('id, creator_id, status, registration_type, endpoint_url')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // WAS-160b: Build update payload with optional registration fields
  const updatePayload: Record<string, unknown> = {
    status: result.data.status,
    updated_at: new Date().toISOString(),
  }

  // WAS-160b: If client already registered on-chain (tx_hash present), mark as on_chain
  if (result.data.registration_type === 'on_chain' && result.data.tx_hash) {
    updatePayload.registration_type = 'on_chain'
    updatePayload.on_chain_registered = true
    updatePayload.chain_registered_at = new Date().toISOString()
  } else if (result.data.registration_type === 'off_chain') {
    updatePayload.registration_type = 'off_chain'
  }

  if (result.data.status === 'active') {
    // WAS-282: block activation if creator account is pending_review
    const { data: profile } = await serviceClient
      .from('creator_profiles')
      .select('account_status')
      .eq('id', user.id)
      .single()

    if (profile?.account_status === 'pending_review') {
      return NextResponse.json(
        {
          error: 'Account pending review',
          code: 'account_pending_review',
          message: 'Your account is under review. Contact support to publish agents.',
        },
        { status: 403 },
      )
    }

    // WAS-277: Verificar endpoint antes de activar — endpoint_url ya viene del select inicial
    if (!existing.endpoint_url) {
      return NextResponse.json(
        { error: 'endpoint_url is required to activate an agent', code: 'missing_endpoint' },
        { status: 422 },
      )
    }

    const probeResult = await probeEndpointSync(existing.endpoint_url)

    if (!probeResult.passed) {
      // Guardar resultado del probe en DB (reviewing + health_check actualizado)
      await serviceClient.from('agents').update({
        status: 'reviewing',
        health_check: probeResult.healthCheck,
        last_checked_at: new Date().toISOString(),
      }).eq('id', existing.id)

      return NextResponse.json(
        {
          error: 'Endpoint health check failed',
          code: 'endpoint_probe_failed',
          detail: probeResult.healthCheck.message,
          fix: probeResult.healthCheck.fix,
          status: 'reviewing',
        },
        { status: 422 },
      )
    }

    // Probe passed — incluir health_check en el update
    updatePayload.health_check = probeResult.healthCheck
    updatePayload.last_checked_at = new Date().toISOString()
  }

  const { error } = await serviceClient
    .from('agents')
    .update(updatePayload)
    .eq('id', existing.id)

  if (error) return jsonError('db_error', 'Failed to update agent status', 500, { logDetail: error })

  // WAS-160b: Only fire-and-forget registerAgentOnChain for legacy flow (no client-side tx)
  // If registration_type was explicitly set, the client already handled on-chain registration
  if (result.data.status === 'active' && !result.data.registration_type) {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('wallet_address')
      .eq('id', user.id)
      .single()

    if (profile?.wallet_address) {
      const { data: agent } = await serviceClient
        .from('agents')
        .select('price_per_call')
        .eq('id', existing.id)
        .single()

      const pricePerCallUSDC = agent?.price_per_call ?? 0.02

      registerAgentOnChain({
        slug,
        pricePerCallUSDC,
        creatorWallet: profile.wallet_address,
      }).catch(err =>
        logger.error('[status] registerAgentOnChain failed', { err })
      )
    }
  }

  return NextResponse.json({ status: result.data.status })
}
