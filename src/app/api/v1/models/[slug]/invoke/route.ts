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

  // ── 1. Lookup model ───────────────────────────────────────────────────────
  const { data: model, error: modelError } = await supabase
    .from('models')
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
        },
        { status: 402 },
      )
    }

    const result = await callUpstream(model, request)

    if (result.status === 'success') {
      await supabase.rpc('increment_agent_key_spend', {
        p_key_id: keyRow.id,
        p_amount: model.price_per_call,
      })
    }

    await logCall(supabase, model, 'agent', rawAgentKey.substring(0, 16), null, result)
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
    .from('models')
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

  const startMs = Date.now()
  let data: unknown
  let status: 'success' | 'error' = 'success'

  try {
    const upstream = await fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    if (!upstream.ok) status = 'error'
  } catch (err) {
    data = { error: 'Upstream unreachable', detail: String(err) }
    status = 'error'
  }

  return { data, status, latencyMs: Date.now() - startMs }
}

async function logCall(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  model: Record<string, unknown>,
  callerType: 'human' | 'agent',
  agentId: string | null,
  txHash: string | null,
  result: { status: string; latencyMs: number },
) {
  await Promise.all([
    (await supabase).from('model_calls').insert({
      model_id: model.id,
      caller_type: callerType,
      agent_id: agentId,
      amount_paid: model.price_per_call,
      tx_hash: txHash,
      status: result.status,
      latency_ms: result.latencyMs,
    }),
    result.status === 'success'
      ? (await supabase)
          .from('models')
          .update({
            total_calls: (model.total_calls as number) + 1,
            total_revenue: Number(model.total_revenue) + Number(model.price_per_call),
          })
          .eq('id', model.id)
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
