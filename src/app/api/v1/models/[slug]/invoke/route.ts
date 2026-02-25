import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  FacilitatorClient,
  extractPaymentFromHeaders,
  X402_CORS_HEADERS,
} from 'uvd-x402-sdk/backend'
import { recordInvocationOnChain, keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'
import { signReceipt } from '@/lib/receipts/signReceipt'
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { getInvokeLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { CHAIN_NAME, IS_MAINNET } from '@/lib/chain'
import { logger } from '@/lib/logger'
import { enqueuePendingRecording } from '@/lib/chain/pendingRecordings'

// x402 recipient = the marketplace contract (it splits 90/10 internally)
const CONTRACT_ADDRESS = process.env.MARKETPLACE_CONTRACT_ADDRESS ?? ''
const CHAIN_ID_NUM     = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

const CHAIN      = CHAIN_ID_NUM === 43114 ? 'avalanche' : 'avalanche-testnet'
const USDC_ADDR  = CHAIN_ID_NUM === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'   // Avalanche mainnet USDC
  : '0x5425890298aed601595a70AB815c96711a31Bc65'   // Avalanche Fuji USDC (Circle test token)

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app').trim().replace(/\/$/, '')

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
 * Verify + settle x402 payment. Handles both Fuji (native) and mainnet (facilitator).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function settleX402(paymentHeader: any, model: Record<string, unknown>, priceStr: string, resourceUrl: string): Promise<SettlementResult | NextResponse> {
  if (CHAIN_ID_NUM === 43113) {
    const evmPayload = (paymentHeader as { payload?: X402EVMPayload })?.payload
    if (!evmPayload?.authorization || !evmPayload?.signature) {
      return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
    }
    const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
    return settlePaymentDirectly(evmPayload, atomicRequired)
  } else {
    const requirements = buildRequirements({ amount: priceStr, recipient: CONTRACT_ADDRESS, resource: resourceUrl, description: `Access to ${model.name as string} on WasiAI`, mimeType: 'application/json' })
    const facilitator = new FacilitatorClient({ baseUrl: 'https://facilitator.ultravioletadao.xyz' })
    return facilitator.verifyAndSettle(paymentHeader, requirements)
  }
}

/**
 * Record successful invocation on-chain and update the DB flag.
 */
async function recordOnChain(supabase: SupabaseServiceClient, slug: string, model: Record<string, unknown>, paymentHeader: unknown, txHash: string): Promise<void> {
  const payerAddress = (paymentHeader as { payload?: { authorization?: { from?: string } } })?.payload?.authorization?.from ?? '0x0000000000000000000000000000000000000000'
  try {
    const onChainTxHash = await recordInvocationOnChain({ slug, payerAddress, amountUSDC: model.price_per_call as number })
    if (onChainTxHash) {
      await supabase.from('agent_calls').update({ on_chain_recorded: true, on_chain_tx_hash: onChainTxHash }).eq('tx_hash', txHash)
    }
  } catch (err) {
    logger.error('[invoke] on-chain recording failed — enqueueing for retry', { err })
    // T-07: Non-fatal: enqueue for retry with exponential backoff
    const { data: callRecord } = await supabase.from('agent_calls').select('id').eq('tx_hash', txHash).single()
    await enqueuePendingRecording({ agentCallId: callRecord?.id, slug, payerAddress, amountUsdc: model.price_per_call as number })
  }
}

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

  // S-03: Explicit agent status check — must be active before any payment processing
  if (model.status !== 'active') {
    return NextResponse.json(
      { error: 'agent_unavailable', message: 'This agent is currently paused' },
      { status: 503 },
    )
  }

  const priceStr = String(model.price_per_call)    // e.g. "0.02"
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

    // Track receipt signature (non-fatal if it fails)
    let receiptSignature: string | null = null
    let callId: string | null = null

    if (result.status === 'success') {
      // 1. Log call to DB first to get the call ID
      const { id: insertedId } = await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)
      callId = insertedId ?? null

      // 2. Sign a cryptographic receipt for the caller to audit
      if (callId && keyRow.key_hash) {
        const timestamp = Math.floor(Date.now() / 1000)
        receiptSignature = await signReceipt({
          keyId:      keyHashToBytes32(keyRow.key_hash),
          callId,
          agentSlug:  slug,
          amountUsdc: model.price_per_call as number,
          timestamp,
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

      // 4. Increment DB spend (source of truth for UI)
      await supabase.rpc('increment_agent_key_spend', {
        p_key_id: keyRow.id,
        p_amount: model.price_per_call,
      })
    } else {
      // Log failed call (no receipt needed)
      await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)
    }

    return buildResponse(model, result, undefined, receiptSignature ?? undefined)
  }

  // ── 3. Route B: x402 Payment (Ultravioleta DAO / Avalanche) ──────────────
  const headers = Object.fromEntries(request.headers.entries())
  const paymentHeader = extractPaymentFromHeaders(headers)

  if (!paymentHeader) {
    // No payment — return 402 with x402 payment instructions (A-01: extracted)
    return build402Instructions(model, priceStr, resourceUrl)
  }

  // ── 4. Verify + Settle (A-01: extracted to settleX402 helper) ─────────────
  const settlementOrError = await settleX402(paymentHeader, model, priceStr, resourceUrl)

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

  // ── 5. Payment valid — call the upstream model ────────────────────────────
  const result = await callUpstream(model, request)
  await logCall(supabase, model, 'human', null, settlement.transactionHash ?? null, result, null, slug)

  // ── 6. Record invocation on-chain (A-01: extracted to recordOnChain helper) ─
  if (result.status === 'success' && settlement.transactionHash) {
    await recordOnChain(supabase, slug, model, paymentHeader, settlement.transactionHash)
  }

  return buildResponse(model, result, settlement.transactionHash)
  } catch (err) {
    logger.error('[invoke] unhandled error', { err })
    // S-10: Never expose raw error details in production
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' ? { detail: String(err) } : {}),
      },
      { status: 500 }
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
  return { id: (insertResult.data as { id?: string } | null)?.id }
}

function buildResponse(
  model: Record<string, unknown>,
  result: { data: unknown; status: string; latencyMs: number },
  txHash?: string,
  receiptSignature?: string,
) {
  return NextResponse.json(
    {
      result: result.data,
      meta: {
        model: model.slug,
        latency_ms: result.latencyMs,
        charged: model.price_per_call,
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
    },
    { headers: X402_CORS_HEADERS },
  )
}
