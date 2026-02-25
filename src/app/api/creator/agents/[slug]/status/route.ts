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

// HU-1.2: 'draft' added to support multi-step publish flow
const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'draft']),
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
    .select('id, creator_id, status')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await serviceClient
    .from('agents')
    .update({ status: result.data.status, updated_at: new Date().toISOString() })
    .eq('id', existing.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // HU-1.2: registerAgentOnChain — fire-and-forget when status → 'active'
  if (result.data.status === 'active') {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('wallet_address')
      .eq('id', user.id)
      .single()

    if (profile?.wallet_address) {
      // Get agent price for on-chain registration
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
        console.error('[status] registerAgentOnChain failed:', err)
      )
    }
  }

  return NextResponse.json({ status: result.data.status })
}
