/**
 * Agent 4 — DeFi Sentiment Analyzer
 *
 * POST /api/v1/agents-internal/wasi-defi-sentiment
 * Body (new):    { token: "AVAX", description? }
 * Body (legacy): { token_name, token_symbol, description? } or { input: string (JSON) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { analyzeSentiment } from '@/lib/defi-risk/sentiment'
import { resolveToken, getTokenList } from '@/lib/defi-risk/tokenRegistry'

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenName: string   = ''
  let tokenSymbol: string = ''
  // Unwrap gateway input wrapper
  let params: Record<string, unknown> = body
  if (typeof body.input === 'string') {
    try {
      params = JSON.parse(body.input) as Record<string, unknown>
    } catch {
      params = { token: body.input }
    }
  }

  const description: string | undefined = typeof params.description === 'string' ? params.description : undefined

  // ── New: resolve by `token` field (auto-fills name + symbol) ─────────────
  const tokenInput = String(params.token ?? '').trim()
  if (tokenInput) {
    const info = resolveToken(tokenInput)
    if (info) {
      tokenName   = info.name
      tokenSymbol = info.symbol
    } else {
      // Unknown token: use the input as name/symbol
      tokenName   = tokenInput
      tokenSymbol = tokenInput.toUpperCase().split(/\s+/)[0]
    }
  }

  // ── Legacy fields (override if provided) ─────────────────────────────────
  if (!tokenName) {
    tokenName   = String(params.token_name   ?? params.tokenName   ?? '').trim()
    tokenSymbol = String(params.token_symbol ?? params.tokenSymbol ?? '').trim()
  }

  if (!tokenName) {
    return NextResponse.json({
      error: 'Provide token (e.g. "AVAX") or token_name',
      supported_tokens: getTokenList().map(t => t.symbol),
    }, { status: 400 })
  }

  const startMs = Date.now()
  const result  = await analyzeSentiment(tokenName, tokenSymbol, description)

  return NextResponse.json({
    result,
    meta: { agent: 'wasi-defi-sentiment', latency_ms: Date.now() - startMs, powered_by: 'groq-llama' },
  })
}

export async function GET() {
  const supported = getTokenList().map(t => ({ symbol: t.symbol, name: t.name }))

  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-defi-sentiment',
    input: {
      example: { token: 'AVAX' },
      example_custom: { token: 'SafeMoonElonGem', description: '100x guaranteed returns!' },
      example_legacy: { token_name: 'USD Coin', token_symbol: 'USDC' },
    },
    supported_tokens: supported,
  })
}
