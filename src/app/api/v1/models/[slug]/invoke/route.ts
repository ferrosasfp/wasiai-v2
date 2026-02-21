import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Agent-to-Agent invocation endpoint.
 * Supports x402 payment flow on Avalanche.
 * 
 * POST /api/v1/models/:slug/invoke
 * Headers:
 *   x-payment: <x402-payment-proof>  (for paid calls)
 *   x-agent-key: <api-key>           (optional, for budget-based access)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  // 1. Look up the model
  const { data: model, error: modelError } = await supabase
    .from('models')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (modelError || !model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }

  // 2. Check payment (x402 or agent key)
  const paymentHeader = request.headers.get('x-payment')
  const agentKey = request.headers.get('x-agent-key')

  if (!paymentHeader && !agentKey) {
    // Return 402 Payment Required with pricing info
    return NextResponse.json(
      {
        error: 'Payment required',
        price: model.price_per_call,
        currency: model.currency,
        chain: model.chain,
        accepts: ['x402/usdc-avalanche'],
        model: { slug: model.slug, name: model.name },
      },
      {
        status: 402,
        headers: {
          'x-price': model.price_per_call.toString(),
          'x-currency': model.currency,
          'x-chain': model.chain,
          'x-accepts': 'x402/usdc-avalanche',
        },
      },
    )
  }

  // 3. Parse request body
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 4. Forward request to model endpoint
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
    result = await upstream.json()
  } catch {
    callStatus = 'error'
    result = { error: 'Upstream model failed' }
  }

  const latencyMs = Date.now() - startMs

  // 5. Log the call
  await supabase.from('model_calls').insert({
    model_id: model.id,
    caller_type: agentKey ? 'agent' : 'human',
    agent_id: agentKey ? agentKey.substring(0, 16) : null,
    amount_paid: model.price_per_call,
    tx_hash: paymentHeader ?? null,
    status: callStatus,
    latency_ms: latencyMs,
  })

  // 6. Update model stats
  await supabase
    .from('models')
    .update({
      total_calls: model.total_calls + 1,
      total_revenue: Number(model.total_revenue) + model.price_per_call,
    })
    .eq('id', model.id)

  return NextResponse.json({
    result,
    meta: {
      model: model.slug,
      latency_ms: latencyMs,
      charged: model.price_per_call,
      currency: model.currency,
    },
  })
}

/**
 * GET /api/v1/models/:slug/invoke
 * Returns model info (machine-readable, for agent discovery)
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
      protocol: 'x402',
    },
  })
}
