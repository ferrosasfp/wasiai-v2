import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleInvoke, X402_CORS_HEADERS } from '@/lib/invoke/handleInvoke'
import { CHAIN_NAME, IS_MAINNET } from '@/lib/chain'
import { SITE_URL } from '@/lib/constants'

// x402 recipient = the marketplace contract (it splits 90/10 internally)
const CONTRACT_ADDRESS = process.env.MARKETPLACE_CONTRACT_ADDRESS ?? ''
const CHAIN_ID_NUM     = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

/**
 * POST /api/v1/models/:slug/invoke
 *
 * H-5 (WKH-AUDIT-V2): la lógica vive en handleInvoke() para que
 * /api/v1/agents/[slug]/invoke pueda resolver in-process sin self-call HTTP.
 *
 * Two auth paths:
 *   A) x-agent-key  → budget-based, no on-chain payment per call
 *   B) X-PAYMENT    → real x402, WasiAI-native settlement on Avalanche
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  return handleInvoke(request, slug)
}

// ── GET: machine-readable spec ────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: model } = await supabase
    .from('agents')
    .select('name, slug, description, category, price_per_call, currency, chain, capabilities')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    schema: 'wasiai/model-spec/v1',
    ...model,
    invoke_url: `${SITE_URL}/api/v1/models/${slug}/invoke`,
    payment: {
      price: model.price_per_call,
      currency: 'USDC',
      chain: CHAIN_NAME,
      chain_id: CHAIN_ID_NUM,
      protocol: 'x402',
      settlement: 'wasiai-native',
      // USDC: native (mainnet) or Circle test token (Fuji)
      usdc_contract: IS_MAINNET
        ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
        : '0x5425890298aed601595a70AB815c96711a31Bc65',
      marketplace_contract: CONTRACT_ADDRESS,
      treasury: process.env.WASIAI_TREASURY_ADDRESS ?? '',
    },
  })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: X402_CORS_HEADERS })
}
