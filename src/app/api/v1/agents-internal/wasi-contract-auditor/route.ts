/**
 * Agent 3 — Smart Contract Auditor (Groq/llama-3.3-70b-versatile)
 * NOTE: Kite AI unavailable as of 2026-02-28. Using Groq as permanent fallback.
 *       See DT-001 for reactivation when Kite AI launches public API.
 *
 * POST /api/v1/agents-internal/wasi-contract-auditor
 * Body: { token_address, contract_source? } or { input: string (JSON) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { auditContract } from '@/lib/defi-risk/auditor'

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenAddress: string
  let contractSource: string | undefined

  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      tokenAddress   = parsed.token_address?.trim() ?? ''
      contractSource = parsed.contract_source
    } catch {
      tokenAddress = body.input.trim()
    }
  } else {
    tokenAddress   = String(body.token_address ?? body.tokenAddress ?? '').trim()
    contractSource = typeof body.contract_source === 'string' ? body.contract_source : undefined
  }

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Valid token_address required' }, { status: 400 })
  }

  const startMs = Date.now()
  const result  = await auditContract(tokenAddress, contractSource)

  return NextResponse.json({
    result,
    meta: {
      agent:      'wasi-contract-auditor',
      latency_ms: Date.now() - startMs,
      powered_by: 'groq-llama',
      note:       'Kite AI API not available as of 2026-02-28. Using Groq/llama-3.3-70b-versatile.',
    },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-contract-auditor',
    input: {
      example: { token_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', contract_source: 'optional ABI or Solidity source' },
    },
  })
}
