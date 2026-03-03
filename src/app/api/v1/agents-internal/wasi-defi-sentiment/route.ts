/**
 * Agent 4 — DeFi Sentiment Analyzer
 *
 * POST /api/v1/agents-internal/wasi-defi-sentiment
 * Body: { token_name, token_symbol, description? } or { input: string (JSON) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { analyzeSentiment } from '@/lib/defi-risk/sentiment'

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenName: string
  let tokenSymbol: string
  let description: string | undefined

  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      tokenName   = parsed.token_name?.trim()   ?? ''
      tokenSymbol = parsed.token_symbol?.trim() ?? ''
      description = parsed.description
    } catch {
      tokenName   = body.input.trim()
      tokenSymbol = ''
    }
  } else {
    tokenName   = String(body.token_name   ?? body.tokenName   ?? '').trim()
    tokenSymbol = String(body.token_symbol ?? body.tokenSymbol ?? '').trim()
    description = typeof body.description === 'string' ? body.description : undefined
  }

  if (!tokenName) {
    return NextResponse.json({ error: 'token_name required' }, { status: 400 })
  }

  const startMs = Date.now()
  const result  = await analyzeSentiment(tokenName, tokenSymbol, description)

  return NextResponse.json({
    result,
    meta: { agent: 'wasi-defi-sentiment', latency_ms: Date.now() - startMs, powered_by: 'groq-llama' },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-defi-sentiment',
    input: {
      example: { token_name: 'SafeMoonElonGem', token_symbol: 'SMEG', description: '100x guaranteed returns!' },
    },
  })
}
