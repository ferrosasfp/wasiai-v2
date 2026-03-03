/**
 * Agent 2 — On-Chain Token Analyzer
 *
 * POST /api/v1/agents-internal/wasi-onchain-analyzer
 * Body: { input: string } where input = JSON { token_address }
 *   OR  { token_address: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { analyzeOnChain } from '@/lib/defi-risk/onchain'

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenAddress: string
  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      tokenAddress = parsed.token_address?.trim() ?? body.input.trim()
    } catch {
      tokenAddress = body.input.trim()
    }
  } else {
    tokenAddress = String(body.token_address ?? body.tokenAddress ?? '').trim()
  }

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Valid token_address (0x...) required' }, { status: 400 })
  }

  const startMs = Date.now()
  const result = await analyzeOnChain(tokenAddress)

  return NextResponse.json({
    result,
    meta: { agent: 'wasi-onchain-analyzer', latency_ms: Date.now() - startMs, powered_by: 'avalanche-rpc' },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-onchain-analyzer',
    input: {
      example: { token_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD' },
    },
  })
}
