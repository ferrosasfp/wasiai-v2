/**
 * Agent 1 — Chainlink Price Feed Reader
 * Internal endpoint — auth/payment enforced by the WasiAI gateway layer
 *
 * POST /api/v1/agents-internal/wasi-chainlink-price
 * Body: { input: string } where input = JSON string { feed_address, token_symbol? }
 *   OR  { feed_address: string, token_symbol?: string } (direct object)
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { readChainlinkFeed } from '@/lib/defi-risk/chainlink'

const DEFAULT_FEED = (process.env.CHAINLINK_AVAX_USD_FEED ?? '').trim()

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Support both { input: "..." } (gateway pattern) and { feed_address: "..." } (direct)
  let feedAddress: string
  let tokenSymbol: string = 'UNKNOWN'

  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      feedAddress  = parsed.feed_address?.trim() ?? ''
      tokenSymbol  = parsed.token_symbol?.trim() ?? 'UNKNOWN'
    } catch {
      feedAddress = body.input.trim()
    }
  } else {
    feedAddress = String(body.feed_address ?? body.feedAddress ?? '').trim()
    tokenSymbol = String(body.token_symbol ?? body.tokenSymbol ?? 'UNKNOWN').trim()
  }

  // Fall back to default AVAX/USD feed if none provided
  if (!feedAddress) {
    if (!DEFAULT_FEED) {
      return NextResponse.json({ error: 'feed_address required. Set CHAINLINK_AVAX_USD_FEED env var for default.' }, { status: 400 })
    }
    feedAddress = DEFAULT_FEED
    if (tokenSymbol === 'UNKNOWN') tokenSymbol = 'AVAX'
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(feedAddress)) {
    return NextResponse.json({ error: 'Invalid feed_address — must be a 40-hex EVM address' }, { status: 400 })
  }

  const startMs = Date.now()
  const result = await readChainlinkFeed(feedAddress, tokenSymbol)

  return NextResponse.json({
    result,
    meta: {
      agent:      'wasi-chainlink-price',
      latency_ms: Date.now() - startMs,
      powered_by: 'chainlink-on-chain',
    },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-chainlink-price',
    name:   'Chainlink Price Feed Reader',
    input: {
      type: 'object',
      properties: {
        feed_address:  { type: 'string', description: 'Chainlink AggregatorV3 address' },
        token_symbol:  { type: 'string', description: 'Human-readable token symbol' },
      },
      example: { feed_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', token_symbol: 'AVAX' },
    },
  })
}
