/**
 * Agent 1 — Chainlink Price Feed Reader
 * Internal endpoint — auth/payment enforced by the WasiAI gateway layer
 *
 * POST /api/v1/agents-internal/wasi-chainlink-price
 * Body (new):    { token: "AVAX" }                        ← symbol, name, or address
 * Body (legacy): { feed_address, token_symbol? }          ← still works
 * Body (gateway): { input: string (JSON or token string) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { readChainlinkFeed } from '@/lib/defi-risk/chainlink'
import { resolveToken, getTokenList } from '@/lib/defi-risk/tokenRegistry'

const DEFAULT_FEED = (process.env.CHAINLINK_AVAX_USD_FEED ?? '').trim()

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let feedAddress: string = ''
  let tokenSymbol: string = 'UNKNOWN'

  // Unwrap gateway input wrapper
  let params: Record<string, unknown> = body
  if (typeof body.input === 'string') {
    try {
      params = JSON.parse(body.input) as Record<string, unknown>
    } catch {
      // treat input string as a token identifier
      params = { token: body.input }
    }
  }

  // ── New: resolve by `token` field (symbol / name / address / free text) ──
  const tokenInput = String(params.token ?? '').trim()
  if (tokenInput) {
    const info = resolveToken(tokenInput)
    if (info) {
      feedAddress = info.chainlinkFeed ?? ''
      tokenSymbol = info.symbol
      if (!feedAddress) {
        return NextResponse.json({
          error: `Token "${info.symbol}" has no known Chainlink feed on this network`,
          supported_tokens: getTokenList().filter(t => t.chainlinkFeed).map(t => t.symbol),
        }, { status: 400 })
      }
    } else if (/^0x[0-9a-fA-F]{40}$/.test(tokenInput)) {
      // Raw feed address passed directly via `token`
      feedAddress = tokenInput
    }
  }

  // ── Legacy fields (still work) ────────────────────────────────────────────
  if (!feedAddress) {
    feedAddress = String(params.feed_address ?? params.feedAddress ?? '').trim()
    tokenSymbol = String(params.token_symbol ?? params.tokenSymbol ?? tokenSymbol).trim()
  }

  // Fall back to default AVAX/USD feed
  if (!feedAddress) {
    if (!DEFAULT_FEED) {
      return NextResponse.json({
        error: 'Provide token (e.g. "AVAX") or feed_address. Set CHAINLINK_AVAX_USD_FEED for default.',
      }, { status: 400 })
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
  const supported = getTokenList()
    .filter(t => t.chainlinkFeed)
    .map(t => ({ symbol: t.symbol, name: t.name }))

  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-chainlink-price',
    name:   'Chainlink Price Feed Reader',
    input: {
      type: 'object',
      properties: {
        token:        { type: 'string', description: 'Token symbol, name, address, or free text (e.g. "AVAX", "precio de AVAX")' },
        feed_address: { type: 'string', description: '(legacy) Chainlink AggregatorV3 address' },
        token_symbol: { type: 'string', description: '(legacy) Human-readable token symbol' },
      },
      example: { token: 'AVAX' },
      example_legacy: { feed_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', token_symbol: 'AVAX' },
    },
    supported_tokens: supported,
  })
}
