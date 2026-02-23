import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { registerAgentOnChain } from '@/lib/contracts/marketplaceClient'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app').trim().replace(/\/$/, '')
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { CHAIN_NETWORKS } from '@/lib/chain'

const createModelSchema = z.object({
  name: z.string().min(3),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  category: z.enum(['nlp', 'vision', 'audio', 'code', 'multimodal', 'data']),
  price_per_call: z.number().min(0.01).max(100),
  endpoint_url: z.string().url(),
  capabilities: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputType: z.string(),
    outputType: z.string(),
  })).optional().default([]),
  cover_image: z.string().url().optional().nullable(),
})

export async function POST(request: NextRequest) {
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
