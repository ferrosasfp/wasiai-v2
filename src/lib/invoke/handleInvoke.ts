import { NextRequest, NextResponse, after } from 'next/server'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
export const X402_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, PAYMENT-SIGNATURE, Authorization',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, PAYMENT-REQUIRED',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const
import { keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'
import { signReceipt } from '@/lib/receipts/signReceipt'
import { settlePaymentX402, type X402EVMPayload, type SettlePaymentX402Ctx } from '@/lib/contracts/usdcSettler'
import { fetchPinned, EndpointValidationError } from '@/lib/security/fetchPinned'
import { getState, wrapWithCircuitBreaker } from '@/lib/circuit-breaker/CircuitBreaker'
import { retryWithBackoff } from '@/lib/circuit-breaker/retryWithBackoff'
import { getInvokeLimit, getIdentifier, checkRateLimit, checkCreatorRateLimits, getSharedRedis } from '@/lib/ratelimit'
import { CHAIN_NAME } from '@/lib/chain'
import { logger } from '@/lib/logger'

import { calcPlatformOverhead, type GasSource } from '@/lib/pricing/overhead'
import { triggerAgentEvent } from '@/lib/webhooks/triggerAgentEvent'

// x402 recipient = the marketplace contract (it splits 90/10 internally)
const CONTRACT_ADDRESS = process.env.MARKETPLACE_CONTRACT_ADDRESS ?? ''
const CHAIN_ID_NUM     = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

const CHAIN      = CHAIN_ID_NUM === 43114 ? 'avalanche' : 'avalanche-testnet'
const USDC_ADDR  = CHAIN_ID_NUM === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'   // Avalanche mainnet USDC
  : '0x5425890298aed601595a70AB815c96711a31Bc65'   // Avalanche Fuji USDC (Circle test token)

import { SITE_URL } from '@/lib/constants'
import { isAgentInScope } from '@/lib/scope-check'
import { validateInput } from '@/lib/schema-validator'
import { assertPaymentType } from '@/lib/validation/payment-type'
// MNR-CR-4: shared with /api/v1/agents/[slug]/introspect/route.ts
import { buildRequirements } from '@/lib/x402/buildRequirements'

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
function build402Instructions(model: Record<string, unknown>, priceStr: string, resourceUrl: string, overheadInfo: { overhead: number; gas_source: GasSource }): NextResponse {
  const requirements = buildRequirements({
    amount: priceStr,
    recipient: CONTRACT_ADDRESS,
    resource: resourceUrl,
    description: `Access to ${model.name as string} on WasiAI`,
    mimeType: 'application/json',
    network: CHAIN,
    asset: USDC_ADDR,
  })
  const freeTrial = model.free_trial_enabled
    ? { available: true, endpoint: `/api/v1/agents/${model.slug as string}/trial`, limit: model.free_trial_limit }
    : undefined
  return NextResponse.json(
    {
      x402Version: 1,
      ...requirements,
      model: { slug: model.slug, name: model.name, category: model.category },
      docs: 'https://wasiai.io/docs/agents#x402',
      breakdown: {
        creator_price: Number(priceStr) - overheadInfo.overhead,
        gas_fee_usdc: overheadInfo.overhead,
        total: Number(priceStr),
        gas_estimated: overheadInfo.gas_source !== 'none',
      },
      ...(freeTrial ? { free_trial: freeTrial } : {}),
    },
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

async function settleX402(
  paymentHeader: X402PaymentHeader,
  model: Record<string, unknown>,
  priceStr: string,
  resourceUrl: string,
  requestId: string,
): Promise<SettlementResult | NextResponse> {
  const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
  if (!evmPayload?.authorization || !evmPayload?.signature) {
    return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
  }
  const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
  // WAS-V2-1: build ctx for the x402 wrapper. Constants reused from module scope (CD-AB-3).
  const ctx: SettlePaymentX402Ctx = {
    requestId,
    agentSlug:    model.slug as string,
    resourceUrl,
    atomicAmount: atomicRequired,
    asset:        USDC_ADDR as `0x${string}`,
    payTo:        CONTRACT_ADDRESS as `0x${string}`,
    network:      CHAIN as 'avalanche' | 'avalanche-testnet',
  }
  return settlePaymentX402(evmPayload, atomicRequired, ctx)
}

// WAS-132: recordOnChain() eliminado — Supabase agent_calls es la fuente de verdad.
// recordInvocationOnChain() on-chain era auditoría duplicada con costo de gas por invocación.

/**
 * handleInvoke — in-process invoke handler.
 *
 * H-5 (WKH-AUDIT-V2): la lógica del POST de /api/v1/models/[slug]/invoke se
 * movió aquí para que /api/v1/agents/[slug]/invoke pueda resolver in-process
 * sin self-call HTTP (fetch) ni NEXT_PUBLIC_SITE_URL.
 *
 * Two auth paths:
 *   A) x-agent-key  → budget-based, no on-chain payment per call
 *   B) X-PAYMENT    → real x402, WasiAI-native settlement on Avalanche
 */
export async function handleInvoke(request: NextRequest, slug: string): Promise<NextResponse> {
  try {
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
    supabase.from('agents').select('id, slug, status, name, endpoint_url, webhook_secret, price_per_call, creator_id, category, input_schema, max_rpd, max_rpm, free_trial_enabled, free_trial_limit, sandbox_enabled, metadata, capabilities').eq('slug', slug).single(),
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
  const { overhead, breakdown, circuitBreaker, gas_source } = await calcPlatformOverhead(creatorPrice)

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

    // WAS-186: Scope check — BEFORE any payment processing
    // AC3: empty array [] = no access (explicit early return)
    const hasSlugScope     = Array.isArray(keyRow.allowed_slugs)      && keyRow.allowed_slugs.length > 0
    const hasCategoryScope = Array.isArray(keyRow.allowed_categories) && keyRow.allowed_categories.length > 0
    const isEmptyScope     = (keyRow.allowed_slugs !== null      && !hasSlugScope)
                          || (keyRow.allowed_categories !== null && !hasCategoryScope)

    if (isEmptyScope) {
      return NextResponse.json(
        { error: 'Agent not in scope', code: 'agent_not_in_scope' },
        { status: 403 },
      )
    }

    const slugsForCheck      = hasSlugScope     ? keyRow.allowed_slugs      : null
    const categoriesForCheck = hasCategoryScope ? keyRow.allowed_categories : null

    if (!isAgentInScope(slug, model.category, slugsForCheck, categoriesForCheck)) {
      return NextResponse.json(
        { error: 'Agent not in scope', code: 'agent_not_in_scope' },
        { status: 403 },
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
          {
            error: 'Concurrent invocation in progress for this key',
            code: 'concurrent_invocation',
            retry_after_seconds: 5,
            hint: 'A call is already in progress for this key. Wait and retry.',
          },
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
        {
          error: 'Service temporarily unavailable. Please retry.',
          retry_after_seconds: 5,
        },
        {
          status: 503,
          headers: { 'Retry-After': '5' },
        },
      )
    }

    // V11 (audit 2026-06-25): try/finally — el mutex per-key SIEMPRE se libera,
    // incluso si algo lanza entre la adquisición y el return feliz. Sin esto un
    // throw dejaba el mutex colgado hasta el TTL (15s) bloqueando a la key.
    try {
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

      // WAS-200 (moved): Validate input AFTER auth — prevent schema info leak to unauthed callers
      if (model.input_schema) {
        let inputVal: unknown
        try {
          const rawBody = await request.clone().json()
          inputVal = rawBody.input ?? rawBody
        } catch {
          return NextResponse.json({ error: 'Invalid JSON body', code: 'invalid_body' }, { status: 400 })
        }
        const validErr = validateInput(model.input_schema as Record<string, unknown>, inputVal)
        if (validErr) {
          return NextResponse.json(
            { error: 'Input validation failed', code: 'input_invalid', details: [validErr] },
            { status: 422 },
          )
        }
      }

      const result = await callUpstream(model, request, slug)

      // Track receipt signature (non-fatal if it fails)
      let receiptSignature: string | null = null
      let callId: string | null = null

      if (result.status === 'success') {
        // V2 (audit 2026-06-25): cobrar ANTES de logear/firmar/responder.
        // Si dos llamadas concurrentes pasan el soft check, solo una podrá
        // decrementar el balance (atomic en DB). Si el débito devuelve false
        // (budget drenado por concurrencia) NO logueamos una call cobrada ni
        // firmamos un receipt de un cobro que no ocurrió → 402.
        assertPaymentType('api_key')
        const { data: deducted } = await supabase.rpc('check_and_deduct_budget', {
          p_key_id: keyRow.id,
          p_amount: totalPrice,
        })
        if (!deducted) {
          // Race condition: otro request cobró primero — no cobrar dos veces ni
          // emitir receipt firmado. La call upstream ya ocurrió, pero el caller
          // no fue cobrado, así que devolvemos 402 (refill y reintentar).
          logger.warn('[invoke] check_and_deduct_budget failed (concurrent call drained budget)', { keyId: keyRow.id })
          return NextResponse.json(
            {
              error: 'Agent key budget exhausted',
              code: 'budget_exceeded',
              action: 'Top up your agent key budget at /en/agent-keys',
            },
            {
              status: 402,
              headers: { 'Retry-After': '0' },
            },
          )
        }

        // 1. Log call to DB (cobro ya confirmado) to get the call ID
        const { id: insertedId } = await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug, null, 'api_key')
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
            after(async () => {
              try {
                await supabase
                  .from('agent_calls')
                  .update({ receipt_signature: receiptSignature })
                  .eq('id', callId)
              } catch (err) {
                logger.warn('[invoke] receipt_signature update failed', { err, slug })
              }
            })
          }
        }
      } else {
        // Log failed call (no receipt needed) — capture id for call_id exposure
        assertPaymentType('api_key')
        const { id: errCallId } = await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug, null, 'api_key')
        callId = errCallId ?? null
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

      return buildResponse(model, result, undefined, receiptSignature ?? undefined, { creatorPrice, overhead, totalPrice, breakdown, gas_source }, callId ?? undefined)
    } finally {
      // NA-203 + V11: liberar mutex pase lo que pase (return feliz, early return o throw)
      if (keyMutexAcquired) {
        try { await getSharedRedis().del(mutexKey) } catch { /* non-fatal */ }
      }
    }
  }

  // ── 2b. Sandbox shortcut (AC-5) ─────────────────────────────────────────
  // Rate limit already applied above. Sandbox never calls upstream, never decrements trial.
  if (request.headers.get('x-sandbox') === 'true' && model.sandbox_enabled) {
    const meta = model.metadata as Record<string, unknown> | null
    const exampleOutput: unknown = meta?.input_example ?? meta?.example_output ?? { message: 'Sandbox mode — no example output configured' }
    after(async () => {
      try {
        await createServiceClient().from('agent_calls').insert({
          agent_id: model.id,
          status: 'success',
          latency_ms: 0,
          payment_type: 'sandbox',
          agent_slug: model.slug as string,
          amount_paid: 0,
        })
      } catch { /* non-fatal */ }
    })
    return NextResponse.json(
      { result: exampleOutput, meta: { model: model.slug, sandbox: true, charged: 0 } },
      { status: 200, headers: X402_CORS_HEADERS },
    )
  }

  // ── 3. Route B: x402 Payment (WasiAI-native settlement) ────────────────
  // WAS-134: settlePaymentDirectly() covers Fuji + mainnet — no external facilitator/bundler
  const reqHeaders = Object.fromEntries(request.headers.entries())
  const paymentHeader = extractPaymentFromHeaders(reqHeaders) as X402PaymentHeader | null

  if (!paymentHeader) {
    // No payment — return 402 with x402 payment instructions
    logger.info('[x402] probe', { slug, ip: getIdentifier(request) })
    return build402Instructions(model, priceStr, resourceUrl, { overhead, gas_source })
  }

  // ── 5. Verify + Settle (Route B) ───────────────────────────────────────
  const settleStart = Date.now()
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const settlementOrError = await settleX402(paymentHeader, model, priceStr, resourceUrl, requestId)

  // If helper returned a NextResponse (error), return it directly
  if (settlementOrError instanceof NextResponse) {
    logger.info('[x402] settle_result', {
      slug,
      verified: false,
      settled: false,
      latency_ms: Date.now() - settleStart,
      error: 'payment_invalid',
    })
    return settlementOrError
  }

  const settlement = settlementOrError as SettlementResult
  logger.info('[x402] settle_result', {
    slug,
    verified: settlement.verified ?? false,
    settled: settlement.settled ?? false,
    latency_ms: Date.now() - settleStart,
    error: settlement.error ?? null,
  })

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

  // AC-6: verified:true settled:false → 502 (settle stage failed after verify ok).
  // MUST happen BEFORE any upstream call / logCall / pending earnings increment —
  // otherwise the client receives service without a confirmed on-chain payment.
  if (!settlement.settled) {
    logger.error('[invoke] payment settle failed after verify ok', { settlement, slug })
    return NextResponse.json(
      { error: 'Payment settlement failed', code: 'settle_failed', reason: settlement.error },
      { status: 502 },
    )
  }

  // ── 6. Payment valid — validate input then call upstream ─────────────────
  // WAS-200 (moved): Validate input AFTER payment auth — prevent schema info leak
  if (model.input_schema) {
    let inputVal: unknown
    try {
      const rawBody = await request.clone().json()
      inputVal = rawBody.input ?? rawBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'invalid_body' }, { status: 400 })
    }
    const validErr = validateInput(model.input_schema as Record<string, unknown>, inputVal)
    if (validErr) {
      return NextResponse.json(
        { error: 'Input validation failed', code: 'input_invalid', details: [validErr] },
        { status: 422 },
      )
    }
  }

  const result = await callUpstream(model, request, slug)
  logger.info('[x402] upstream_result', {
    slug,
    status: result.status,
    latency_ms: result.latencyMs,
    charged: result.status === 'success',
  })
  // WAS-132: Extract EIP-3009 nonce from payment authorization for idempotency
  const x402Nonce = (paymentHeader?.payload as X402EVMPayload | undefined)
    ?.authorization?.nonce ?? null

  assertPaymentType('x402')
  const logResult = await logCall(supabase, model, 'human', null, settlement.transactionHash ?? null, result, null, slug, x402Nonce, 'x402')
  // WAS-132: Unique constraint violation on nonce = replay attack — return 402
  if (logResult.error?.code === 'payment_already_used') {
    return NextResponse.json(
      { error: 'payment_already_used', code: 'payment_already_used' },
      { status: 402 },
    )
  }
  const callId = logResult.id

  // S6-01: Fire-and-forget — registrar failure "cobro sin servicio"
  if (settlement.settled && result.status !== 'success') {
    after(async () => {
      try {
        const res = await supabase.from('settlement_failures').insert({
          settlement_tx_hash: settlement.transactionHash ?? 'unknown',
          agent_slug: slug,
          amount_usdc: model.price_per_call,
          caller_wallet: null,
          error_reason: (typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? 'upstream_error')).slice(0, 500),
          agent_call_id: callId ?? null,
        })
        if (res.error) {
          logger.error('[invoke] settlement_failure insert DB error', { err: res.error.message, txHash: settlement.transactionHash, slug })
        } else {
          logger.warn('[invoke] settlement_failure recorded', { slug, txHash: settlement.transactionHash })
        }
      } catch (err: unknown) {
        logger.error('[invoke] settlement_failure insert failed', { err: String(err).slice(0, 200), txHash: settlement.transactionHash, slug })
      }
    })
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

  // HU-067: Contabilidad off-chain de earnings — fire-and-forget, nunca bloquea TTFB
  if (result.status === 'success' && model.creator_id) {
    after(async () => {
      try {
        await supabase.rpc('increment_pending_earnings', {
          p_user_id: model.creator_id as string,
          p_amount:  creatorPrice,
        })
      } catch (err: unknown) {
        logger.error('[invoke] increment_pending_earnings failed', { err, slug })
      }
    })
  }

  return buildResponse(model, result, settlement.transactionHash, undefined, { creatorPrice, overhead, totalPrice, breakdown, gas_source }, callId ?? undefined, { upstreamFailed: result.status === 'error' })
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

// ── Helpers ───────────────────────────────────────────────────────────────

async function callUpstream(model: Record<string, unknown>, request: NextRequest, slug: string) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* empty body ok */ }

  const startMs = Date.now()
  let data: unknown
  let status: 'success' | 'error' = 'success'
  // WAS-284: hint para mapear el error del upstream al HTTP status correcto en buildResponse
  let httpStatusHint: 422 | 502 | 503 | 504 | undefined = undefined

  // V3: pinned fetch — validateEndpointUrlAsync resolves+validates the IP and
  // fetchPinned connects to THAT IP (no DNS re-resolution), closing the
  // DNS-rebinding TOCTOU that could leak `webhook_secret` to an internal host.
  const upstreamBody = JSON.stringify(body)
  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((model.webhook_secret as string | null) ? {
      'Authorization': `Bearer ${model.webhook_secret}`,
      'X-WasiAI-Agent-Id': model.id as string,
    } : {}),
  }

  try {
    const upstream = await wrapWithCircuitBreaker(
      slug,
      async () => {
        const res = await retryWithBackoff(
          () => fetchPinned(model.endpoint_url as string, {
            method:    'POST',
            headers:   upstreamHeaders,
            body:      upstreamBody,
            timeoutMs: 10_000,
          })
        )
        if (!res.ok && res.status >= 500) {
          throw new Error(`Upstream HTTP ${res.status}`)
        }
        return res
      },
      model.user_id as string
    )
    if (upstream.ok) {
      data = await upstream.json()
    } else {
      status = 'error'
      // a3: un 4xx del upstream es un error de INPUT del caller (ej. el agente
      // rechaza el body por validación), NO un Bad Gateway. Lo propagamos como
      // 422 con el detalle real del agente (no enmascarado como 502), para que
      // el caller sepa QUÉ corregir. 5xx del upstream sí es 502 (el wrapper ya
      // lanza para >=500, así que acá normalmente es 4xx).
      let detail: unknown
      try {
        detail = await upstream.json()
      } catch {
        try {
          detail = (await upstream.text()).slice(0, 300)
        } catch {
          /* body ilegible */
        }
      }
      data = {
        error: `Upstream ${upstream.status}`,
        upstream_status: upstream.status,
        ...(detail !== undefined ? { detail } : {}),
      }
      httpStatusHint =
        upstream.status >= 400 && upstream.status < 500 ? 422 : 502
    }
  } catch (err) {
    status = 'error'
    // V3: SSRF/DNS-rebinding rejection from fetchPinned → invalid endpoint, not a
    // transient upstream failure. The bearer secret was NOT sent.
    if (err instanceof EndpointValidationError) {
      data = { error: 'Invalid model endpoint', detail: String(err) }
      httpStatusHint = 502
    // WAS-284: discriminar tipo de error para HTTP status correcto
    } else if (err instanceof DOMException && err.name === 'TimeoutError') {
      // AbortSignal.timeout() lanza DOMException con name='TimeoutError' en Node.js 18+
      data = { error: 'Upstream timeout', detail: 'Endpoint did not respond within 10 seconds.' }
      httpStatusHint = 504
    } else if (err instanceof Error && /^Upstream HTTP (\d+)$/.test(err.message)) {
      // Error sintético lanzado por el wrapper para 5xx: 'Upstream HTTP 503' etc.
      const upstreamStatus = Number(err.message.match(/\d+/)?.[0] ?? 502)
      data = { error: `Upstream ${upstreamStatus}` }
      httpStatusHint = upstreamStatus >= 500 ? 503 : 502
    } else {
      // Connection error (TypeError ECONNREFUSED, ENOTFOUND, etc.)
      data = { error: 'Upstream unreachable', detail: String(err) }
      httpStatusHint = 502
    }
  }

  return { data, status, latencyMs: Date.now() - startMs, httpStatusHint }
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
  nonce?: string | null,
  paymentType?: string,
): Promise<{ id?: string; error?: { code: string } }> {
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
      nonce:           nonce ?? null,
      payment_type:    paymentType ?? 'unknown',
    }).select('id').single(),
    result.status === 'success'
      ? supabase.rpc('increment_agent_stats', {
          p_agent_id: model.id,
          p_amount:   model.price_per_call,
        })
      : Promise.resolve(),
  ])
  // WAS-132: 23505 = unique_violation on nonce index — replay attack detected
  if (insertResult.error && (insertResult.error as { code?: string }).code === '23505') {
    return { error: { code: 'payment_already_used' } }
  }
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
  gas_source:   GasSource    // ← NEW
}

function buildResponse(
  model: Record<string, unknown>,
  result: { data: unknown; status: string; latencyMs: number; httpStatusHint?: number },
  txHash?: string,
  receiptSignature?: string,
  pricingInfo?: PricingInfo,
  callId?: string,
  options?: { upstreamFailed?: boolean },  // WAS-284: true solo en Route B (x402) cuando upstream falla
) {
  // WAS-284: propagar el HTTP status del upstream cuando hay error
  const httpStatus = result.status === 'error' && result.httpStatusHint
    ? result.httpStatusHint
    : 200

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
        call_id: callId ?? undefined,
        // WAS-284: upstream_failed = true en Route B cuando el settlement ocurrió pero el upstream falló
        ...(options?.upstreamFailed ? { upstream_failed: true } : {}),
      },
      receipt: receiptSignature
        ? { signature: receiptSignature }
        : undefined,
      pricing: pricingInfo
        ? {
            creator_price:     pricingInfo.creatorPrice,
            platform_overhead: pricingInfo.overhead,
            gas_fee_usdc:      pricingInfo.overhead,    // NEW alias
            total:             pricingInfo.totalPrice,
            gas_source:        pricingInfo.gas_source,  // NEW
            breakdown:         pricingInfo.breakdown,
          }
        : undefined,
    },
    { status: httpStatus, headers: X402_CORS_HEADERS },
  )
}
