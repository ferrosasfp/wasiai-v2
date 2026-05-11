/**
 * WAS-V2-1: HTTP client + envelope builder + error mapping for the x402 facilitator.
 *
 * Pure module — no viem runtime, no DB, no env var reads (DI via args).
 * Side-effect: only fetch() to facilitator URL.
 *
 * CD-NEW-SDD-6 + CD-AB-1: envelope construction uses object literal with explicit keys
 * in schema order (x402Version, resource, accepted, payload). Facilitator uses
 * Zod .strict() — extra keys reject with HTTP 400.
 */
import type { Address } from 'viem'
import type { X402EVMPayload, SettlementResult } from './usdcSettler'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface X402V2Envelope {
  x402Version: 2
  resource: { url: string; description?: string; mimeType?: string }
  accepted: {
    scheme: 'exact'
    /**
     * Canonical x402 v2 network format `eip155:<chainId>`. The facilitator
     * (wasiai-facilitator) uses Zod `.strict()` and rejects v2's internal
     * 'avalanche' / 'avalanche-testnet' literals.
     * Translation happens in `buildX402V2Envelope` via `CHAIN_TO_EIP155`.
     */
    network: `eip155:${number}`
    amount: string
    asset: Address
    payTo: Address
    maxTimeoutSeconds: number
    extra: { assetTransferMethod: 'eip3009' }
  }
  payload: X402EVMPayload
}

export interface SettlePaymentX402Ctx {
  requestId:    string
  agentSlug:    string
  resourceUrl:  string
  atomicAmount: string
  asset:        Address
  payTo:        Address
  network:      'avalanche' | 'avalanche-testnet'
}

/**
 * Successful `/verify` response from the facilitator.
 *
 * The facilitator may include additional fields in the body; we only require
 * `verified: true` and tolerate any extra keys.
 */
export interface VerifyResponseOk {
  verified: true
}

export interface SettleResponseOk {
  settled: true
  transactionHash: string
}

interface FacilitatorErrorBody {
  code?: string
  message?: string
}

export type ExternalResult<T> =
  | { ok: true; body: T }
  | { ok: false; error: SettlementResult }

// ─── Envelope builder (pure) ──────────────────────────────────────────────────

/**
 * Translate v2's internal chain naming to canonical x402 v2 `eip155:<chainId>` form.
 * The wasiai-facilitator validates `network` with Zod and rejects anything that
 * doesn't match `eip155:<id>`. Without this map, the facilitator returns
 * INVALID_PAYLOAD HTTP 400 on every settle attempt (smoke confirmed 2026-04-25).
 */
const CHAIN_TO_EIP155: Record<'avalanche' | 'avalanche-testnet', `eip155:${number}`> = {
  'avalanche': 'eip155:43114',
  'avalanche-testnet': 'eip155:43113',
}

export function buildX402V2Envelope(
  payload: X402EVMPayload,
  ctx: SettlePaymentX402Ctx,
): X402V2Envelope {
  // CD-NEW-SDD-6 + CD-AB-1: explicit keys, no spread, schema order.
  return {
    x402Version: 2,
    resource: {
      url: ctx.resourceUrl,
      description: `WasiAI agent invocation: ${ctx.agentSlug}`,
      mimeType: 'application/json',
    },
    accepted: {
      scheme: 'exact',
      network: CHAIN_TO_EIP155[ctx.network],
      amount: ctx.atomicAmount,
      asset: ctx.asset,
      payTo: ctx.payTo,
      maxTimeoutSeconds: 300,
      extra: { assetTransferMethod: 'eip3009' },
    },
    payload,
  }
}

// ─── Error mapping (pure, hardcoded per DT-G) ─────────────────────────────────

const KNOWN_FACILITATOR_CODES = new Set([
  'INVALID_PAYLOAD',
  'INVALID_SIGNATURE',
  'EXPIRED_AUTHORIZATION',
  'INVALID_AMOUNT',
  'INSUFFICIENT_BALANCE',
  'NETWORK_MISMATCH',
  'SIMULATION_FAILED',
  'RATE_LIMITED',
  'CHAIN_UNAVAILABLE',
  'TRANSACTION_FAILED',
  'NONCE_ALREADY_USED', // ← WAS-V2-2 CD-12: required for idempotency guard
])

export function mapFacilitatorErrorToSettlementResult(
  status: number,
  body: FacilitatorErrorBody | null,
  phase: 'verify' | 'settle',
): SettlementResult {
  // CD-AB-2: prefer ?? over || (string '' must not be coerced to fallback).
  const code = (body?.code ?? 'UNKNOWN').toUpperCase()
  const msg  = body?.message ?? `HTTP ${status}`
  // verify failed → verified=false; settle failed AFTER verify ok → verified=true (AC-5).
  const verified = phase === 'settle'
  const errorCode = KNOWN_FACILITATOR_CODES.has(code) ? code : 'INVALID_PAYLOAD'
  return { verified, settled: false, error: `${errorCode}: ${msg}` }
}

// ─── Type guards (MNR-CR-7) ───────────────────────────────────────────────────

/** Shape guard for a successful `/verify` response body. */
function isVerifyOk(body: unknown): body is VerifyResponseOk {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { verified?: unknown }).verified === true
  )
}

/** Shape guard for a successful `/settle` response body. */
function isSettleOk(body: unknown): body is SettleResponseOk {
  if (typeof body !== 'object' || body === null) return false
  const b = body as { settled?: unknown; transactionHash?: unknown }
  return b.settled === true && typeof b.transactionHash === 'string'
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function postJson<T>(
  url: string,
  envelope: X402V2Envelope,
  signal: AbortSignal,
  phase: 'verify' | 'settle',
): Promise<ExternalResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      signal,
    })
  } catch {
    // timeout / DNS / ECONNREFUSED / abort — DT-G last-but-one row.
    // MNR-CR-3: code-prefixed error style used consistently across this client.
    return {
      ok: false,
      error: {
        verified: false,
        settled: false,
        error: 'CHAIN_UNAVAILABLE: facilitator unreachable',
      },
    }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // shape mismatch handled below
  }

  if (!res.ok) {
    return {
      ok: false,
      error: mapFacilitatorErrorToSettlementResult(
        res.status,
        body as FacilitatorErrorBody | null,
        phase,
      ),
    }
  }

  // MNR-CR-7: named type guards replace inline shape casts.
  // MNR-CR-3: 'INVALID_PAYLOAD: ...' uses the same code-prefixed style as
  // mapFacilitatorErrorToSettlementResult — single style across the client.
  if (phase === 'verify' && !isVerifyOk(body)) {
    return {
      ok: false,
      error: {
        verified: false,
        settled: false,
        error: 'INVALID_PAYLOAD: facilitator response shape unexpected',
      },
    }
  }
  if (phase === 'settle' && !isSettleOk(body)) {
    return {
      ok: false,
      error: {
        verified: true,
        settled: false,
        error: 'INVALID_PAYLOAD: facilitator response shape unexpected',
      },
    }
  }

  return { ok: true, body: body as T }
}

export function verifyExternal(
  envelope: X402V2Envelope,
  facilitatorUrl: string,
  signal: AbortSignal,
): Promise<ExternalResult<VerifyResponseOk>> {
  return postJson<VerifyResponseOk>(`${facilitatorUrl}/verify`, envelope, signal, 'verify')
}

export function settleExternal(
  envelope: X402V2Envelope,
  facilitatorUrl: string,
  signal: AbortSignal,
): Promise<ExternalResult<SettleResponseOk>> {
  return postJson<SettleResponseOk>(`${facilitatorUrl}/settle`, envelope, signal, 'settle')
}
