/**
 * Agent 3 — Smart Contract Auditor (Groq/llama-3.3-70b-versatile)
 * NOTE: Kite AI unavailable as of 2026-02-28. Using Groq as permanent fallback.
 *       See DT-001 for reactivation when Kite AI launches public API.
 *
 * POST /api/v1/agents-internal/wasi-contract-auditor
 * Body (new):    { token: "AVAX", contract_source? }
 * Body (legacy): { token_address, contract_source? } or { input: string (JSON) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'
import { auditContract } from '@/lib/defi-risk/auditor'
import { resolveTokenAddress, getTokenList } from '@/lib/defi-risk/tokenRegistry'

export async function POST(request: NextRequest) {
  const authError = verifyInternalSecret(request)
  if (authError) return authError

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenAddress: string = ''
  let contractSource: string | undefined

  // Unwrap gateway input wrapper
  let params: Record<string, unknown> = body
  if (typeof body.input === 'string') {
    try {
      params = JSON.parse(body.input) as Record<string, unknown>
    } catch {
      params = { token: body.input }
    }
  }

  contractSource = typeof params.contract_source === 'string' ? params.contract_source : undefined

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

  // ── Legacy fields ─────────────────────────────────────────────────────────
  if (!tokenAddress) {
    tokenAddress = String(params.token_address ?? params.tokenAddress ?? '').trim()
  }

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Provide token (e.g. "AVAX") or valid token_address (0x...)' }, { status: 400 })
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
  const supported = getTokenList().map(t => ({ symbol: t.symbol, name: t.name, address: t.address }))

  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-contract-auditor',
    input: {
      example: { token: 'USDC', contract_source: 'optional ABI or Solidity source' },
      example_legacy: { token_address: '0x5425890298aed601595a70AB815c96711a31Bc65', contract_source: 'optional ABI or Solidity source' },
    },
    supported_tokens: supported,
  })
}
