/**
 * POST /api/v1/agents/:slug/introspect
 *
 * Returns a signed COB (Capability Object Bundle) for debugging.
 * Three depth levels: shallow=$0.10, mid=$0.25, full=$0.50 USDC.
 *
 * Auth dual:
 *   A) x-agent-key  → budget-based
 *   B) X-PAYMENT    → x402 native settlement
 *
 * Follows same pattern as /api/v1/models/[slug]/invoke/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
import { logger } from '@/lib/logger'
import { SITE_URL } from '@/lib/constants'
import { buildCOB } from '@/lib/introspect/buildCOB'
import type { IntrospectDepth } from '@/lib/introspect/buildCOB'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { assertPaymentType } from '@/lib/validation/payment-type'
import { getInvokeLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

// ── Constants ─────────────────────────────────────────────────────────────

const X402_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, PAYMENT-SIGNATURE, Authorization',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, PAYMENT-REQUIRED',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const

const CONTRACT_ADDRESS = process.env.MARKETPLACE_CONTRACT_ADDRESS ?? ''
const CHAIN_ID_NUM     = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const CHAIN            = CHAIN_ID_NUM === 43114 ? 'avalanche' : 'avalanche-testnet'
const USDC_ADDR        = CHAIN_ID_NUM === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  : '0x5425890298aed601595a70AB815c96711a31Bc65'

const INTROSPECT_PRICE: Record<IntrospectDepth, number> = {
  shallow: 0.10,
  mid:     0.25,
  full:    0.50,
}

const VALID_DEPTHS: IntrospectDepth[] = ['shallow', 'mid', 'full']

// ── Types ─────────────────────────────────────────────────────────────────

type SupabaseServiceClient = ReturnType<typeof createServiceClient>

interface IntrospectRequest {
  runtime:              string
  target:               string
  depth:                IntrospectDepth
  breakpoints?:         string[]
  timeout_ms?:          number
  max_response_size_mb?: number
}

interface X402PaymentHeader {
  x402Version?: number
  scheme?:      string
  network?:     string
  payload?:     X402EVMPayload
  [key: string]: unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildRequirements(options: {
  amount: string
  recipient: string
  resource: string
  description: string
  mimeType: string
}) {
  const atomicAmount = Math.round(parseFloat(options.amount) * 1_000_000).toString()
  return {
    scheme: 'exact' as const,
    network: CHAIN,
    maxAmountRequired: atomicAmount,
    resource: options.resource,
    description: options.description,
    mimeType: options.mimeType,
    payTo: options.recipient,
    maxTimeoutSeconds: 300,
    asset: USDC_ADDR,
  }
}

function build402Response(slug: string, depth: IntrospectDepth): NextResponse {
  const priceStr = INTROSPECT_PRICE[depth].toFixed(6)
  const resourceUrl = `${SITE_URL}/api/v1/agents/${slug}/introspect`
  const requirements = buildRequirements({
    amount:      priceStr,
    recipient:   CONTRACT_ADDRESS,
    resource:    resourceUrl,
    description: `Introspect agent ${slug} (${depth}) on WasiAI`,
    mimeType:    'application/json',
  })
  return NextResponse.json(
    {
      x402Version: 1,
      ...requirements,
      agent: { slug, depth },
      docs: 'https://wasiai.io/docs/agents#introspect',
    },
    { status: 402, headers: { 'Content-Type': 'application/json', ...X402_CORS_HEADERS } },
  )
}

function extractPaymentFromHeaders(headers: Headers): X402PaymentHeader | null {
  const normalized: Record<string, string> = {}
  for (const [key, value] of headers.entries()) {
    normalized[key.toLowerCase()] = value
  }
  const payment = normalized['x-payment'] ?? normalized['payment-signature'] ?? null
  if (!payment) return null
  try {
    return JSON.parse(Buffer.from(payment, 'base64').toString('utf-8')) as X402PaymentHeader
  } catch {
    return null
  }
}

async function logCall(
  supabase: SupabaseServiceClient,
  model: Record<string, unknown>,
  callerType: 'human' | 'agent',
  txHash: string | null,
  result: { status: string; latencyMs: number },
  keyId?: string | null,
  agentSlug?: string | null,
  nonce?: string | null,
): Promise<{ id?: string }> {
  assertPaymentType('api_key')
  const [insertResult] = await Promise.all([
    supabase.from('agent_calls').insert({
      agent_id:        model.id,
      caller_type:     callerType,
      caller_agent_id: null,
      amount_paid:     model.price_per_call,
      tx_hash:         txHash,
      status:          result.status,
      latency_ms:      result.latencyMs,
      key_id:          keyId ?? null,
      agent_slug:      agentSlug ?? null,
      nonce:           nonce ?? null,
      payment_type:    'api_key',
    }).select('id').single(),
  ])
  return { id: (insertResult.data as { id?: string } | null)?.id }
}

async function callUpstreamIntrospect(
  model: Record<string, unknown>,
  body: IntrospectRequest,
): Promise<{ data: unknown; status: 'success' | 'error'; latencyMs: number; timedOut: boolean }> {
  // SEC-01: Validate endpoint URL to prevent SSRF
  try {
    await validateEndpointUrlAsync(model.endpoint_url as string)
  } catch (err) {
    return { data: { error: 'Invalid model endpoint', detail: String(err) }, status: 'error', latencyMs: 0, timedOut: false }
  }

  const timeoutMs = Math.min(body.timeout_ms ?? 5000, 30_000)
  const startMs = Date.now()

  try {
    const res = await fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...((model.webhook_secret as string | null) ? {
          'Authorization': `Bearer ${model.webhook_secret}`,
          'X-WasiAI-Agent-Id': model.id as string,
        } : {}),
      },
      body: JSON.stringify({ ...body, __introspect: true }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const latencyMs = Date.now() - startMs
    const data = res.ok ? await res.json() : { error: `Upstream ${res.status}` }
    return { data, status: res.ok ? 'success' : 'error', latencyMs, timedOut: false }
  } catch (err) {
    const latencyMs = Date.now() - startMs
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      data: { error: timedOut ? 'Upstream timeout' : 'Upstream unreachable', detail: String(err) },
      status: 'error',
      latencyMs,
      timedOut,
    }
  }
}

// ── OPTIONS (CORS preflight) ──────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: X402_CORS_HEADERS })
}

// ── POST ─────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    // ── 0. Rate limiting (SEC: S1 — WAS-078) ─────────────────────────────
    const rlId  = getIdentifier(request)
    const rlHit = await checkRateLimit(getInvokeLimit(), rlId)
    if (rlHit) return rlHit

    const { slug } = await params
    const supabase = createServiceClient()

    // ── 1. Parse + validate body ──────────────────────────────────────────
    let body: IntrospectRequest
    try {
      body = await request.json() as IntrospectRequest
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'invalid_body' },
        { status: 400, headers: X402_CORS_HEADERS },
      )
    }

    if (!body.depth || !VALID_DEPTHS.includes(body.depth)) {
      return NextResponse.json(
        { error: `Invalid depth. Must be one of: ${VALID_DEPTHS.join(', ')}`, code: 'invalid_depth' },
        { status: 400, headers: X402_CORS_HEADERS },
      )
    }

    if (!body.runtime || !body.target) {
      return NextResponse.json(
        { error: 'Missing required fields: runtime, target', code: 'missing_fields' },
        { status: 400, headers: X402_CORS_HEADERS },
      )
    }

    // ── 2. Lookup agent ───────────────────────────────────────────────────
    const rawAgentKey = request.headers.get('x-agent-key')
    const keyHash = rawAgentKey
      ? createHash('sha256').update(rawAgentKey).digest('hex')
      : null

    const [{ data: model, error: modelError }, keyRowResult] = await Promise.all([
      supabase.from('agents').select('id, slug, name, status, price_per_call, endpoint_url, webhook_secret, on_chain_registered, creator_wallet').eq('slug', slug).single(),
      keyHash
        ? supabase
            .from('agent_keys')
            .select('id, key_hash, is_active, budget_usdc, spent_usdc, allowed_slugs, allowed_categories')
            .eq('key_hash', keyHash)
            .eq('is_active', true)
            .single()
        : Promise.resolve(null),
    ])

    if (modelError || !model) {
      return NextResponse.json(
        { error: 'Agent not found', code: 'agent_not_found' },
        { status: 404, headers: X402_CORS_HEADERS },
      )
    }

    if (model.status !== 'active') {
      return NextResponse.json(
        { error: 'agent_unavailable', message: 'This agent is currently paused' },
        { status: 503, headers: X402_CORS_HEADERS },
      )
    }

    const price = INTROSPECT_PRICE[body.depth]
    const priceStr = price.toFixed(6)

    // ── 3. Route A: Agent Key ─────────────────────────────────────────────
    if (rawAgentKey) {
      const keyRow = keyRowResult?.data ?? null

      if (!keyRow) {
        return NextResponse.json(
          { error: 'Invalid or inactive agent key', code: 'invalid_key' },
          { status: 401, headers: X402_CORS_HEADERS },
        )
      }

      const remaining = Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc)
      if (remaining < price) {
        return NextResponse.json(
          {
            error:     'Agent key budget exhausted',
            code:      'budget_exceeded',
            budget:    keyRow.budget_usdc,
            spent:     keyRow.spent_usdc,
            remaining,
            needed:    price,
          },
          { status: 402, headers: X402_CORS_HEADERS },
        )
      }

      // BUG-02 fix: deduct budget atomically BEFORE calling upstream
      const deductResult = await supabase.rpc('check_and_deduct_budget', {
        p_key_id: keyRow.id,
        p_amount: price,
      })
      if (deductResult.error || deductResult.data === false) {
        logger.warn('[introspect] budget deduct failed or insufficient', { err: deductResult.error })
        return NextResponse.json({ error: 'insufficient_budget' }, { status: 402, headers: X402_CORS_HEADERS })
      }

      // Call upstream — budget already deducted
      const upstream = await callUpstreamIntrospect(model, body)

      // BUG-01 fix: truncated only on timeout, not on any error
      const cob = await buildCOB({
        agentSlug:       slug,
        depth:           body.depth,
        upstreamData:    upstream.timedOut ? upstream.data : (upstream.status === 'error' ? {} : upstream.data),
        latencyMs:       upstream.latencyMs,
        truncated:       upstream.timedOut === true,
        truncatedReason: upstream.timedOut === true ? 'timeout' : undefined,
        erc8004Identity: (model.on_chain_registered && model.creator_wallet)
          ? String(model.creator_wallet)
          : '',
      })

      // logCall with nonce=null (SDD §4.5 / S7-03 note)
      await logCall(supabase, model, 'agent', null, { status: upstream.status, latencyMs: upstream.latencyMs }, keyRow.id, slug, null)

      return NextResponse.json(
        { cob, meta: { depth: body.depth, price: priceStr, currency: 'USDC', agent_slug: slug } },
        { headers: X402_CORS_HEADERS },
      )
    }

    // ── 4. Route B: x402 Payment ──────────────────────────────────────────
    const paymentHeader = extractPaymentFromHeaders(request.headers)

    if (!paymentHeader) {
      logger.info('[introspect] probe', { slug, depth: body.depth })
      return build402Response(slug, body.depth)
    }

    // Verify + settle
    const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
    if (!evmPayload?.authorization || !evmPayload?.signature) {
      return NextResponse.json(
        { error: 'Invalid payment header', code: 'payment_invalid' },
        { status: 402, headers: X402_CORS_HEADERS },
      )
    }

    const atomicRequired = Math.round(price * 1_000_000).toString()
    const settlement = await settlePaymentDirectly(evmPayload, atomicRequired)

    if (!settlement.verified) {
      logger.error('[introspect] payment verification failed', { slug, settlement })
      return NextResponse.json(
        { error: 'Payment verification failed', code: 'payment_invalid', reason: settlement.error },
        { status: 402, headers: X402_CORS_HEADERS },
      )
    }

    // Payment valid — call upstream
    const upstream = await callUpstreamIntrospect(model, body)

    // BUG-01 fix: truncated only on timeout, not on any error
    const cob = await buildCOB({
      agentSlug:       slug,
      depth:           body.depth,
      upstreamData:    upstream.timedOut ? upstream.data : (upstream.status === 'error' ? {} : upstream.data),
      latencyMs:       upstream.latencyMs,
      truncated:       upstream.timedOut === true,
      truncatedReason: upstream.timedOut === true ? 'timeout' : undefined,
      erc8004Identity: (model.on_chain_registered && model.creator_wallet)
        ? String(model.creator_wallet)
        : '',
    })

    // logCall with nonce=null (x402 nonce not used for introspect per SDD §4.5)
    await logCall(supabase, model, 'human', settlement.transactionHash ?? null, { status: upstream.status, latencyMs: upstream.latencyMs }, null, slug, null)

    return NextResponse.json(
      {
        cob,
        meta: {
          depth:      body.depth,
          price:      priceStr,
          currency:   'USDC',
          agent_slug: slug,
          tx_hash:    settlement.transactionHash ?? null,
        },
      },
      { headers: X402_CORS_HEADERS },
    )
  } catch (err) {
    logger.error('[introspect] unhandled error', { err })
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' ? { detail: String(err) } : {}),
      },
      { status: 500, headers: X402_CORS_HEADERS },
    )
  }
}
