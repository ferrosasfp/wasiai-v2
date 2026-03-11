/**
 * Agent 2 — On-Chain Token Analyzer
 *
 * POST /api/v1/agents-internal/wasi-onchain-analyzer
 * Body (new):    { token: "AVAX" }            ← symbol, name, address, or free text
 * Body (legacy): { token_address: "0x..." }   ← still works
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { analyzeOnChain } from '@/lib/defi-risk/onchain'
import { resolveTokenAddress, getTokenList } from '@/lib/defi-risk/tokenRegistry'

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Unwrap gateway input wrapper
  let params: Record<string, unknown> = body
  if (typeof body.input === 'string') {
    try {
      params = JSON.parse(body.input) as Record<string, unknown>
    } catch {
      params = { token: body.input }
    }
  }

  let tokenAddress: string = ''

  // ── New: resolve by `token` field ─────────────────────────────────────────
  const tokenInput = String(params.token ?? '').trim()
  if (tokenInput) {
    const resolved = resolveTokenAddress(tokenInput)
    if (resolved) {
      tokenAddress = resolved
    } else {
      return NextResponse.json({
        error: `Cannot resolve "${tokenInput}" to a known token address`,
        tip: 'Use a symbol like "AVAX", "USDC", or a raw 0x address',
        supported_tokens: getTokenList().map(t => t.symbol),
      }, { status: 400 })
    }
  }

  // ── Legacy field ──────────────────────────────────────────────────────────
  if (!tokenAddress) {
    tokenAddress = String(params.token_address ?? params.tokenAddress ?? '').trim()
  }

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Provide token (e.g. "AVAX") or valid token_address (0x...)' }, { status: 400 })
  }

  const startMs = Date.now()
  const result = await analyzeOnChain(tokenAddress)

  return NextResponse.json({
    result,
    meta: { agent: 'wasi-onchain-analyzer', latency_ms: Date.now() - startMs, powered_by: 'avalanche-rpc' },
  })
}

export async function GET() {
  const supported = getTokenList().map(t => ({ symbol: t.symbol, name: t.name, address: t.address }))

  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-onchain-analyzer',
    input: {
      example: { token: 'AVAX' },
      example_legacy: { token_address: '0xd00ae08403B9bbb9124bB305C09058E32C39A48c' },
    },
    supported_tokens: supported,
  })
}
