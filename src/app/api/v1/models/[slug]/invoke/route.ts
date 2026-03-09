import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
const X402_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, PAYMENT-SIGNATURE, Authorization',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, PAYMENT-REQUIRED',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const
import { keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'
import { signReceipt } from '@/lib/receipts/signReceipt'
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { getState, wrapWithCircuitBreaker } from '@/lib/circuit-breaker/CircuitBreaker'
import { retryWithBackoff } from '@/lib/circuit-breaker/retryWithBackoff'
import { getInvokeLimit, getIdentifier, checkRateLimit, checkCreatorRateLimits, getSharedRedis } from '@/lib/ratelimit'
import { CHAIN_NAME, IS_MAINNET } from '@/lib/chain'
import { logger } from '@/lib/logger'

import { calcPlatformOverhead } from '@/lib/pricing/overhead'
import { triggerAgentEvent } from '@/lib/webhooks/triggerAgentEvent'

// x402 recipient = the marketplace contract (it splits 90/10 internally)
const CONTRACT_ADDRESS = process.env.MARKETPLACE_CONTRACT_ADDRESS ?? ''
const CHAIN_ID_NUM     = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

const CHAIN      = CHAIN_ID_NUM === 43114 ? 'avalanche' : 'avalanche-testnet'
const USDC_ADDR  = CHAIN_ID_NUM === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'   // Avalanche mainnet USDC
  : '0x5425890298aed601595a70AB815c96711a31Bc65'   // Avalanche Fuji USDC (Circle test token)

import { SITE_URL } from '@/lib/constants'

/**
 * Build x402 payment requirements manually.
 * Bypasses SDK's getChainByName() which doesn't know 'avalanche-testnet'.
 */
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

// WAS-134: x402 utilities inlineadas — eliminada dependencia de uvd-x402-sdk
function extractPaymentFromHeaders(headers: Headers | Record<string, string | string[] | undefined>): Record<string, string> | null {
  const normalized: Record<string, string> = {}
  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Object.entries(headers)
  for (const [key, value] of entries) {
    if (typeof value === 'string') normalized[key.toLowerCase()] = value
    else if (Array.isArray(value) && value.length > 0) normalized[key.toLowerCase()] = value[0]
  }
  const payment = normalized['x-payment'] ?? normalized['payment-signature'] ?? null
  if (!payment) return null
  try { return JSON.parse(Buffer.from(payment, 'base64').toString('utf-8')) }
  catch { return null }
}

// ── A-01: Extracted helpers (each < 50 lines, golden path logic unchanged) ───

type SupabaseServiceClient = ReturnType<typeof createServiceClient>
type SettlementResult = { verified: boolean; settled: boolean; transactionHash?: string; error?: string }

/**
 * Returns 402 instructions response (probe / no payment path).
 */
function build402Instructions(model: Record<string, unknown>, priceStr: string, resourceUrl: string): NextResponse {
  const requirements = buildRequirements({
    amount: priceStr,
    recipient: CONTRACT_ADDRESS,
    resource: resourceUrl,
    description: `Access to ${model.name as string} on WasiAI`,
    mimeType: 'application/json',
  })
  return NextResponse.json(
    { x402Version: 1, ...requirements, model: { slug: model.slug, name: model.name, category: model.category }, docs: 'https://wasiai.io/docs/agents#x402' },
    { status: 402, headers: { 'Content-Type': 'application/json', ...X402_CORS_HEADERS } },
  )
}

/**
 * Verify + settle x402 payment via native settler (WAS-134).
 * settlePaymentDirectly() covers Fuji (43113) and mainnet (43114) — no external facilitator.
 */
interface X402PaymentHeader {
  x402Version?: number
  scheme?: string
  network?: string
  payload?: {
    signature?: string
    authorization?: {
      from?: string
      to?: string
      value?: string
      validAfter?: string | number
      validBefore?: string | number
      nonce?: string
    }
  }
  [key: string]: unknown
}

async function settleX402(paymentHeader: X402PaymentHeader, _model: Record<string, unknown>, priceStr: string): Promise<SettlementResult | NextResponse> {
  const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
  if (!evmPayload?.authorization || !evmPayload?.signature) {
    return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
  }
  const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
  return settlePaymentDirectly(evmPayload, atomicRequired)
}

// WAS-132: recordOnChain() eliminado — Supabase agent_calls es la fuente de verdad.
// recordInvocationOnChain() on-chain era auditoría duplicada con costo de gas por invocación.

/**
 * POST /api/v1/models/:slug/invoke
 *
 * Two auth paths:
 *   A) x-agent-key  → budget-based, no on-chain payment per call
 *   B) X-PAYMENT    → real x402, WasiAI-native settlement on Avalanche
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
  const { slug } = await params
  // Use service client to bypass RLS — invoke is a payment API, not auth-aware
  const supabase = createServiceClient()

  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const rlId  = getIdentifier(request)
  const rlHit = await checkRateLimit(getInvokeLimit(), rlId)
  if (rlHit) return rlHit

  // ── 1. Detect auth path early, then parallelize lookups ─────────────────
  // P-02: Run model + agent-key lookups in parallel to cut TTFB
  const rawAgentKey = request.headers.get('x-agent-key')
  const keyHash = rawAgentKey
    ? createHash('sha256').update(rawAgentKey).digest('hex')
    : null

  const [{ data: model, error: modelError }, keyRowResult] = await Promise.all([
    supabase.from('agents').select('*').eq('slug', slug).single(),
    keyHash
      ? supabase
          .from('agent_keys')
          .select('id, key_hash, is_active, budget_usdc, spent_usdc')
          .eq('key_hash', keyHash)
          .eq('is_active', true)
          .single()
      : Promise.resolve(null),
  ])

  if (modelError || !model) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }

  // HU-8.4: Creator-configurable rate limiting — check AFTER model load, BEFORE payment
  // Use api_key prefix when available, fall back to IP — avoids shared 'anon' bucket
  const consumerKey = rawAgentKey
    ? rawAgentKey.substring(0, 24)
    : request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? 'anon'
  const creatorRlId = `${slug}:${consumerKey}`

  // AR-fix: fail-open — checkCreatorRateLimits retorna null si Upstash no está disponible
  const rlResponse = await checkCreatorRateLimits(slug, model.max_rpm ?? 60, model.max_rpd ?? 1000, creatorRlId)
  if (rlResponse) return rlResponse

  // S-03: Explicit agent status check — must be active before any payment processing
  if (model.status !== 'active') {
    return NextResponse.json(
      { error: 'agent_unavailable', message: 'This agent is currently paused' },
      { status: 503 },
    )
  }

  // WAS-73: Circuit Breaker check — block if CB is open
  const cbState = await getState(slug)
  if (cbState === 'open') {
    return NextResponse.json(
      { error: 'agent_circuit_open', message: 'Agent temporarily unavailable', retry_after_seconds: 30 },
      { status: 503, headers: { 'Retry-After': '30' } },
    )
  }

  // HU-073: use price_per_call (what the user pays) as the base price.
  // creator_price is a legacy field that may be misconfigured; price_per_call is the source of truth.
  // The 10% platform fee is deducted at withdrawal time by the contract, not here.
  const creatorPrice = Number(model.price_per_call)
  const { overhead, breakdown, circuitBreaker } = await calcPlatformOverhead(creatorPrice)

  if (circuitBreaker) {
    return NextResponse.json(
      {
        error:               'agent_temporarily_unavailable',
        code:                'operational_cost_exceeds_price',
        retry_after_seconds: 300,
      },
      { status: 503, headers: { 'Retry-After': '300' } },
    )
  }

  const totalPrice = Math.round((creatorPrice + overhead) * 1_000_000) / 1_000_000
  const priceStr   = totalPrice.toFixed(6)
  const resourceUrl = `${SITE_URL}/api/v1/models/${slug}/invoke`

  // ── 2. Route A: Agent Key (budget-based) ─────────────────────────────────
  if (rawAgentKey) {
    const keyRow = keyRowResult?.data ?? null

    if (!keyRow) {
      return NextResponse.json(
        { error: 'Invalid or inactive agent key', code: 'invalid_key' },
        { status: 401 },
      )
    }

    // NA-203: Redis mutex per-key — prevents concurrent double-spend from same key
    // (on-chain nonce is the stronger fix, but this prevents backend races without re-deploy)
    let keyMutexAcquired = false
    const mutexKey = `invoke:mutex:${keyRow.id}`
    try {
      const redis = getSharedRedis()
      const acquired = await redis.set(mutexKey, '1', { nx: true, ex: 15 }) // 15s TTL
      if (!acquired) {
        return NextResponse.json(
          { error: 'Concurrent invocation in progress for this key', code: 'concurrent_invocation' },
          { status: 429, headers: { 'Retry-After': '5' } }
        )
      }
      keyMutexAcquired = true
    } catch (err) {
      // NG-105: Redis unavailable — fail-closed to prevent double-spend
      logger.error('[invoke] Redis mutex unavailable — rejecting request', {
        keyId: keyRow.id,
        error: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: 'Service temporarily unavailable. Please retry.' },
        {
          status: 503,
          headers: { 'Retry-After': '5' },
        },
      )
    }

    // NG-008: Pre-flight soft check for user-friendly error (non-atomic, for UX only)
    const remaining = Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc)
    if (remaining < totalPrice) {
      return NextResponse.json(
        {
          error: 'Agent key budget exhausted',
          code: 'budget_exceeded',
          budget: keyRow.budget_usdc,
          spent: keyRow.spent_usdc,
          remaining,
          needed: totalPrice,
          action: 'Top up your agent key budget at /en/agent-keys',
        },
        {
          status: 402,
          headers: { 'Retry-After': '0' }, // A2A-10: refill and retry immediately
        },
      )
    }

    const result = await callUpstream(model, request, slug)

    // Track receipt signature (non-fatal if it fails)
    let receiptSignature: string | null = null
    let callId: string | null = null

    if (result.status === 'success') {
      // 1. Log call to DB first to get the call ID
      const { id: insertedId } = await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)
      callId = insertedId ?? null
      // HAL-027: Mismo timestamp para receipt y called_at — auditoría consistente
      const receiptTimestamp = Math.floor(Date.now() / 1000)

      // 2. Sign a cryptographic receipt for the caller to audit
      if (callId && keyRow.key_hash) {
        receiptSignature = await signReceipt({
          keyId:      keyHashToBytes32(keyRow.key_hash),
          callId,
          agentSlug:  slug,
          amountUsdc: creatorPrice,   // receipt certifica lo que va al creator, NO totalPrice
          timestamp:  receiptTimestamp,
        }).catch(err => {
          logger.warn('[invoke] signReceipt failed (non-fatal)', { err: String(err).slice(0, 200) })
          return null
        })

        // 3. Save signature to DB (best effort)
        if (receiptSignature) {
          // Best-effort: save receipt signature in background
          void Promise.resolve(
            supabase
              .from('agent_calls')
              .update({ receipt_signature: receiptSignature })
              .eq('id', callId)
          ).catch(err => logger.warn('[invoke] receipt_signature update failed', { err }))
        }
      }

      // 4. NG-008: Atomic check+deduct — previene race condition TOCTOU
      // Si dos llamadas concurrentes pasan el soft check de arriba, solo una
      // podrá decrementar el balance (la otra recibirá false y el cobro se revierte)
      const { data: deducted } = await supabase.rpc('check_and_deduct_budget', {
        p_key_id: keyRow.id,
        p_amount: totalPrice,
      })
      if (!deducted) {
        // Race condition: otro request cobró primero — no cobrar dos veces
        logger.warn('[invoke] check_and_deduct_budget failed (concurrent call drained budget)', { keyId: keyRow.id })
        // La llamada ya fue exitosa — logearla sin cobro para auditoría
      }
    } else {
      // Log failed call (no receipt needed)
      await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)
    }

    // WAS-74: Fire-and-forget webhook trigger — never await, never blocks TTFB
    if (model.creator_id) {
      void triggerAgentEvent(
        result.status === 'success' ? 'agent.invoked' : 'agent.error',
        model.id as string,
        model.creator_id as string,
        {
          slug: slug as string,
          status: result.status,
          latency_ms: result.latencyMs,
        }
      ).catch(() => { /* non-fatal */ })
    }

    // NA-203: Liberar mutex antes de retornar
    if (keyMutexAcquired) {
      try { await getSharedRedis().del(mutexKey) } catch { /* non-fatal */ }
    }

    return buildResponse(model, result, undefined, receiptSignature ?? undefined, { creatorPrice, overhead, totalPrice, breakdown })
  }

  // ── 3. Route B: x402 Payment (WasiAI-native settlement) ────────────────
  // WAS-134: settlePaymentDirectly() covers Fuji + mainnet — no external facilitator/bundler
  const headers = Object.fromEntries(request.headers.entries())
  const paymentHeader = extractPaymentFromHeaders(headers) as X402PaymentHeader | null

  if (!paymentHeader) {
    // No payment — return 402 with x402 payment instructions
    return build402Instructions(model, priceStr, resourceUrl)
  }

  // ── 5. Verify + Settle (Route B) ───────────────────────────────────────
  const settlementOrError = await settleX402(paymentHeader, model, priceStr)

  // If helper returned a NextResponse (error), return it directly
  if (settlementOrError instanceof NextResponse) return settlementOrError

  const settlement = settlementOrError as SettlementResult

  if (!settlement.verified) {
    logger.error('[invoke] payment verification failed', settlement)
    return NextResponse.json(
      {
        error: 'Payment verification failed',
        code: 'payment_invalid',
        reason: settlement.error,
        // S-10: Only expose debug info in development — never in production
        ...(process.env.NODE_ENV === 'development'
          ? { debug: { chain: CHAIN, usdc: USDC_ADDR, contract: CONTRACT_ADDRESS } }
          : {}),
      },
      { status: 402 },
    )
  }

  // ── 6. Payment valid — call the upstream model ────────────────────────────
  const result = await callUpstream(model, request, slug)
  await logCall(supabase, model, 'human', null, settlement.transactionHash ?? null, result, null, slug)

  // WAS-74: Fire-and-forget webhook trigger — never await, never blocks TTFB
  if (model.creator_id) {
    void triggerAgentEvent(
      result.status === 'success' ? 'agent.invoked' : 'agent.error',
      model.id as string,
      model.creator_id as string,
      {
        slug: slug as string,
        status: result.status,
        latency_ms: result.latencyMs,
      }
    ).catch(() => { /* non-fatal */ })
  }

  // HU-067: Contabilidad off-chain de earnings — fire-and-forget, nunca bloquea TTFB
  if (result.status === 'success' && model.creator_id) {
    void Promise.resolve(
      supabase.rpc('increment_pending_earnings', {
        p_user_id: model.creator_id as string,
        p_amount:  creatorPrice,
      })
    ).catch((err: unknown) => logger.error('[invoke] increment_pending_earnings failed', { err }))
  }

  return buildResponse(model, result, settlement.transactionHash, undefined, { creatorPrice, overhead, totalPrice, breakdown })
  } catch (err) {
    logger.error('[invoke] unhandled error', { err })
    // S-10: Never expose raw error details in production
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' ? { detail: String(err) } : {}),
      },
      { status: 500, headers: X402_CORS_HEADERS }
    )
  }
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
    invoke_url: `${SITE_URL}/api/v1/models/${slug}/invoke`,
    payment: {
      price: model.price_per_call,
      currency: 'USDC',
      chain: CHAIN_NAME,
      chain_id: CHAIN_ID_NUM,
      protocol: 'x402',
      settlement: 'wasiai-native',
      // USDC: native (mainnet) or Circle test token (Fuji)
      usdc_contract: IS_MAINNET
        ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
        : '0x5425890298aed601595a70AB815c96711a31Bc65',
      marketplace_contract: CONTRACT_ADDRESS,
      treasury: process.env.WASIAI_TREASURY_ADDRESS ?? '',
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function callUpstream(model: Record<string, unknown>, request: NextRequest, slug: string) {
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
    // WAS-73: wrapWithCircuitBreaker handles success/failure counting.
    // retryWithBackoff handles network-level retries (TypeError/AbortError/TimeoutError).
    // B-01: HTTP 5xx throws so wrapWithCircuitBreaker calls recordFailure correctly.
    // HTTP 4xx does NOT throw — caller error, not provider failure.
    const upstream = await wrapWithCircuitBreaker(
      slug,
      async () => {
        const res = await retryWithBackoff(
          () => fetch(model.endpoint_url as string, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000), // PERF-02: 10s max, no infinite hangs
          })
        )
        if (!res.ok && res.status >= 500) {
          throw new Error(`Upstream HTTP ${res.status}`)
        }
        return res
      },
      model.user_id as string
    )
    data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    if (!upstream.ok) status = 'error'
  } catch (err) {
    data = { error: 'Upstream unreachable', detail: String(err) }
    status = 'error'
  }

  return { data, status, latencyMs: Date.now() - startMs }
}

async function logCall(
  supabase: SupabaseServiceClient,
  model: Record<string, unknown>,
  callerType: 'human' | 'agent',
  agentId: string | null,
  txHash: string | null,
  result: { status: string; latencyMs: number },
  keyId?: string | null,
  agentSlug?: string | null,
): Promise<{ id?: string }> {
  // PERF-06: supabase is already resolved — no redundant await
  const [insertResult] = await Promise.all([
    supabase.from('agent_calls').insert({
      agent_id:        model.id,
      caller_type:     callerType,
      caller_agent_id: agentId,
      amount_paid:     model.price_per_call,
      tx_hash:         txHash,
      status:          result.status,
      latency_ms:      result.latencyMs,
      key_id:          keyId ?? null,
      agent_slug:      agentSlug ?? null,
    }).select('id').single(),
    result.status === 'success'
      ? supabase.rpc('increment_agent_stats', {
          p_agent_id: model.id,
          p_amount:   model.price_per_call,
        })
      : Promise.resolve(),
  ])
  // HAL-021: callId viene directamente del insert (no de búsqueda posterior)
  // Esto previene race conditions donde dos llamadas concurrentes podrían
  // obtener el mismo callId si se buscara por ORDER BY called_at DESC LIMIT 1
  return { id: (insertResult.data as { id?: string } | null)?.id }
}

interface PricingInfo {
  creatorPrice: number
  overhead:     number
  totalPrice:   number
  breakdown:    { gas: number }
}

function buildResponse(
  model: Record<string, unknown>,
  result: { data: unknown; status: string; latencyMs: number },
  txHash?: string,
  receiptSignature?: string,
  pricingInfo?: PricingInfo,
) {
  return NextResponse.json(
    {
      result: result.data,
      meta: {
        model: model.slug,
        latency_ms: result.latencyMs,
        charged: result.status === 'success'
          ? (pricingInfo?.totalPrice ?? Number(model.price_per_call))
          : 0,
        charged_breakdown: result.status === 'success' && pricingInfo
          ? { creator: pricingInfo.creatorPrice, overhead: pricingInfo.overhead }
          : undefined,
        currency: 'USDC',
        chain: CHAIN_NAME,
        tx_hash: txHash ?? null,
        status: result.status,
      },
      // Cryptographic receipt — lets the caller audit that this call was real.
      // Verify with: verifyReceipt(receipt, signature) from @/lib/receipts/signReceipt
      receipt: receiptSignature
        ? { signature: receiptSignature }
        : undefined,
      // AC9: desglose de precios
      pricing: pricingInfo
        ? {
            creator_price:     pricingInfo.creatorPrice,
            platform_overhead: pricingInfo.overhead,
            total:             pricingInfo.totalPrice,
            breakdown:         pricingInfo.breakdown,
          }
        : undefined,
    },
    { headers: X402_CORS_HEADERS },
  )
}
