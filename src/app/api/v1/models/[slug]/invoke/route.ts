import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import {
  FacilitatorClient,
  extractPaymentFromHeaders,
  buildErc8004PaymentRequirements,
  create402Response,
  X402_CORS_HEADERS,
} from 'uvd-x402-sdk/backend'
import { recordInvocationOnChain } from '@/lib/contracts/marketplaceClient'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { getInvokeLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

const TREASURY = process.env.WASIAI_TREASURY_ADDRESS ?? ''
const CHAIN    = 'avalanche'
const FACILITATOR_URL = 'https://facilitator.ultravioletadao.xyz'

/**
 * POST /api/v1/models/:slug/invoke
 *
 * Two auth paths:
 *   A) x-agent-key  → budget-based, no on-chain payment per call
 *   B) X-PAYMENT    → real x402 via Ultravioleta DAO facilitator (Avalanche)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const rlId  = getIdentifier(request)
  const rlHit = await checkRateLimit(getInvokeLimit(), rlId)
  if (rlHit) return rlHit

  // ── 1. Lookup model ───────────────────────────────────────────────────────
  const { data: model, error: modelError } = await supabase
    .from('agents')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (modelError || !model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }

  const priceStr = String(model.price_per_call)    // e.g. "0.02"
  const resourceUrl = `https://wasiai.io/api/v1/models/${slug}/invoke`

  // ── 2. Route A: Agent Key (budget-based) ─────────────────────────────────
  const rawAgentKey = request.headers.get('x-agent-key')

  if (rawAgentKey) {
    const hash = createHash('sha256').update(rawAgentKey).digest('hex')
    const { data: keyRow } = await supabase
      .from('agent_keys')
      .select('id, is_active, budget_usdc, spent_usdc')
      .eq('key_hash', hash)
      .eq('is_active', true)
      .single()

    if (!keyRow) {
      return NextResponse.json(
        { error: 'Invalid or inactive agent key', code: 'invalid_key' },
        { status: 401 },
      )
    }

    const remaining = Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc)
    if (remaining < model.price_per_call) {
      return NextResponse.json(
        {
          error: 'Agent key budget exhausted',
          code: 'budget_exceeded',
          budget: keyRow.budget_usdc,
          spent: keyRow.spent_usdc,
          remaining,
          needed: model.price_per_call,
          action: 'Top up your agent key budget at /en/agent-keys',
        },
        {
          status: 402,
          headers: { 'Retry-After': '0' }, // A2A-10: refill and retry immediately
        },
      )
    }

    const result = await callUpstream(model, request)

    if (result.status === 'success') {
      await supabase.rpc('increment_agent_key_spend', {
        p_key_id: keyRow.id,
        p_amount: model.price_per_call,
      })
    }

    await logCall(supabase, model, 'agent', null, null, result) // SEC-06: don't log key prefix
    return buildResponse(model, result)
  }

  // ── 3. Route B: x402 Payment (Ultravioleta DAO / Avalanche) ──────────────
  const headers = Object.fromEntries(request.headers.entries())
  const paymentHeader = extractPaymentFromHeaders(headers)

  if (!paymentHeader) {
    // No payment — return 402 with proper x402 payment instructions
    const { status, headers: h402, body } = create402Response({
      amount: priceStr,
      recipient: TREASURY,
      resource: resourceUrl,
      chainName: CHAIN,
      description: `Access to ${model.name} on WasiAI`,
      mimeType: 'application/json',
    })

    return NextResponse.json(
      {
        ...body,
        model: { slug: model.slug, name: model.name, category: model.category },
        docs: 'https://wasiai.io/docs/agents#x402',
      },
      {
        status,
        headers: { ...h402, ...X402_CORS_HEADERS },
      },
    )
  }

  // ── 4. Verify + Settle via Ultravioleta DAO facilitator ───────────────────
  const requirements = buildErc8004PaymentRequirements({
    amount: priceStr,
    recipient: TREASURY,
    resource: resourceUrl,
    chainName: CHAIN,
    description: `Access to ${model.name} on WasiAI`,
    mimeType: 'application/json',
  })

  const facilitator = new FacilitatorClient({ baseUrl: FACILITATOR_URL })
  const settlement = await facilitator.verifyAndSettle(paymentHeader, requirements)

  if (!settlement.verified) {
    return NextResponse.json(
      {
        error: 'Payment verification failed',
        code: 'payment_invalid',
        reason: settlement.error,
      },
      { status: 402 },
    )
  }

  // ── 5. Payment valid — call the upstream model ────────────────────────────
  const result = await callUpstream(model, request)
  await logCall(supabase, model, 'human', null, settlement.transactionHash ?? null, result)

  // ── 6. Record invocation on-chain (non-blocking) ──────────────────────────
  // The USDC is already in WasiAIMarketplace.sol (paid via x402).
  // recordInvocation() splits earnings: 90% creator, 10% treasury.
  if (result.status === 'success') {
    recordInvocationOnChain({
      slug:         slug,
      payerAddress: '0x0000000000000000000000000000000000000000', // extracted from payment header ideally
      amountUSDC:   model.price_per_call as number,
    }).catch(err => console.error('[invoke] on-chain recording failed silently:', err))
  }

  return buildResponse(model, result, settlement.transactionHash)
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
    invoke_url: `https://wasiai.io/api/v1/models/${slug}/invoke`,
    payment: {
      price: model.price_per_call,
      currency: 'USDC',
      chain: 'avalanche',
      chain_id: 43114,
      protocol: 'x402',
      facilitator: FACILITATOR_URL,
      usdc_contract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      treasury: TREASURY,
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function callUpstream(model: Record<string, unknown>, request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* empty body ok */ }

  // SEC-01: Validate endpoint URL to prevent SSRF
  try {
    validateEndpointUrl(model.endpoint_url as string)
  } catch (err) {
    return { data: { error: 'Invalid model endpoint', detail: String(err) }, status: 'error' as const, latencyMs: 0 }
  }

  const startMs = Date.now()
  let data: unknown
  let status: 'success' | 'error' = 'success'

  try {
    const upstream = await fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000), // PERF-02: 10s max, no infinite hangs
    })
    data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    if (!upstream.ok) status = 'error'
  } catch (err) {
    data = { error: 'Upstream unreachable', detail: String(err) }
    status = 'error'
  }

  return { data, status, latencyMs: Date.now() - startMs }
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function logCall(
  supabase: SupabaseClient,
  model: Record<string, unknown>,
  callerType: 'human' | 'agent',
  agentId: string | null,
  txHash: string | null,
  result: { status: string; latencyMs: number },
) {
  // PERF-06: supabase is already resolved — no redundant await
  await Promise.all([
    supabase.from('agent_calls').insert({
      agent_id: model.id,
      caller_type: callerType,
      caller_agent_id: agentId,
      amount_paid: model.price_per_call,
      tx_hash: txHash,
      status: result.status,
      latency_ms: result.latencyMs,
    }),
    result.status === 'success'
      ? supabase.rpc('increment_agent_stats', {
          p_agent_id: model.id,
          p_amount:   model.price_per_call,
        })
      : Promise.resolve(),
  ])
}

function buildResponse(
  model: Record<string, unknown>,
  result: { data: unknown; status: string; latencyMs: number },
  txHash?: string,
) {
  return NextResponse.json(
    {
      result: result.data,
      meta: {
        model: model.slug,
        latency_ms: result.latencyMs,
        charged: model.price_per_call,
        currency: 'USDC',
        chain: 'avalanche',
        tx_hash: txHash ?? null,
        status: result.status,
      },
    },
    { headers: X402_CORS_HEADERS },
  )
}
