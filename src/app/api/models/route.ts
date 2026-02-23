import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { registerAgentOnChain } from '@/lib/contracts/marketplaceClient'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { validateCsrf } from '@/lib/security/csrf'
// A-07: Use shared schema to keep client/server validation in sync
import { createModelSchema } from '@/lib/schemas/model.schema'

export async function POST(request: NextRequest) {
  // S-02: CSRF protection
  const csrfError = validateCsrf(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const result = createModelSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.issues },
      { status: 422 },
    )
  }

  // SEC-01: Block SSRF via endpoint_url
  try {
    validateEndpointUrl(result.data.endpoint_url)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('agents')
    .insert({ ...result.data, creator_id: user.id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Register agent on WasiAIMarketplace.sol (on-chain) ──────────────────
  // Best-effort: requires MARKETPLACE_CONTRACT_ADDRESS + OPERATOR_PRIVATE_KEY
  try {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('wallet_address')
      .eq('id', user.id)
      .single()

    if (profile?.wallet_address) {
      registerAgentOnChain({
        slug:             result.data.slug,
        pricePerCallUSDC: result.data.price_per_call,
        creatorWallet:    profile.wallet_address,
      }).catch(err => console.error('[publish] on-chain register failed:', err))
    }
  } catch {
    // Non-fatal
  }

  return NextResponse.json(data, { status: 201 })
}
