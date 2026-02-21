import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'

/**
 * Agent-to-Agent invocation endpoint.
 * Supports x402 payment flow on Avalanche + Agent Key budget-based access.
 *
 * POST /api/v1/models/:slug/invoke
 * Headers:
 *   x-payment:   <x402-tx-hash>   (for direct on-chain payment)
 *   x-agent-key: <wasi_xxx...>    (for budget-based key access)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  // ── 1. Look up the model ──────────────────────────────────────────────────
  const { data: model, error: modelError } = await supabase
    .from('models')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (modelError || !model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }

  // ── 2. Auth: x-agent-key or x-payment ────────────────────────────────────
  const rawAgentKey = request.headers.get('x-agent-key')
  const paymentHeader = request.headers.get('x-payment')

  let validatedKeyId: string | null = null
  let callerType: 'agent' | 'human' = 'human'

  if (rawAgentKey) {
    // Validate key against DB + enforce budget
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

    validatedKeyId = keyRow.id
    callerType = 'agent'

  } else if (!paymentHeader) {
    // No auth at all → return 402 with pricing info for x402 flow
    return NextResponse.json(
      {
        error: 'Payment required',
        code: 'payment_required',
        price: model.price_per_call,
        currency: model.currency,
        chain: model.chain,
        chain_id: 43114,
        accepts: ['x402/usdc-avalanche'],
        recipient: process.env.WASIAI_TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
        model: { slug: model.slug, name: model.name },
        docs: 'https://wasiai.io/docs/agents#x402',
      },
      {
        status: 402,
        headers: {
          'x-price': model.price_per_call.toString(),
          'x-currency': model.currency,
          'x-chain': model.chain,
          'x-chain-id': '43114',
          'x-accepts': 'x402/usdc-avalanche',
        },
      },
    )
  }

  // ── 3. Parse request body ─────────────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 4. Forward to model endpoint ─────────────────────────────────────────
  if (!model.endpoint_url) {
    return NextResponse.json({ error: 'Model endpoint not configured' }, { status: 503 })
  }

  const startMs = Date.now()
  let result: unknown
  let callStatus = 'success'

  try {
    const upstream = await fetch(model.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!upstream.ok) {
      callStatus = 'error'
      result = { error: `Upstream returned ${upstream.status}` }
    } else {
      result = await upstream.json()
    }
  } catch (err) {
    callStatus = 'error'
    result = { error: 'Upstream model unreachable', detail: String(err) }
  }

  const latencyMs = Date.now() - startMs

  // ── 5. Deduct from agent key budget (if key-based) ───────────────────────
  if (validatedKeyId && callStatus === 'success') {
    await supabase.rpc('increment_agent_key_spend', {
      p_key_id: validatedKeyId,
      p_amount: model.price_per_call,
    })
  }

  // ── 6. Log the call ───────────────────────────────────────────────────────
  await supabase.from('model_calls').insert({
    model_id: model.id,
    caller_type: callerType,
    agent_id: validatedKeyId ? rawAgentKey!.substring(0, 16) : null,
    amount_paid: model.price_per_call,
    tx_hash: paymentHeader ?? null,
    status: callStatus,
    latency_ms: latencyMs,
  })

  // ── 7. Update model stats ─────────────────────────────────────────────────
  if (callStatus === 'success') {
    await supabase
      .from('models')
      .update({
        total_calls: model.total_calls + 1,
        total_revenue: Number(model.total_revenue) + model.price_per_call,
      })
      .eq('id', model.id)
  }

  return NextResponse.json({
    result,
    meta: {
      model: model.slug,
      latency_ms: latencyMs,
      charged: model.price_per_call,
      currency: model.currency,
      status: callStatus,
    },
  })
}

/**
 * GET /api/v1/models/:slug/invoke
 * Machine-readable model spec — for agent discovery.
 */
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
      currency: model.currency,
      chain: model.chain,
      chain_id: 43114,
      protocol: 'x402',
      treasury: process.env.WASIAI_TREASURY_ADDRESS ?? null,
    },
  })
}
