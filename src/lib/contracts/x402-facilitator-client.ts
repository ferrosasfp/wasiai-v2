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

export interface VerifyResponseOk {
  verified: true
  // facilitator may include additional fields; we only require `verified`
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

  // Naive shape guard — full Zod schema would be over-engineering here.
  if (phase === 'verify' && (body as { verified?: unknown } | null)?.verified !== true) {
    return {
      ok: false,
      error: {
        verified: false,
        settled: false,
        error: 'INVALID_PAYLOAD: facilitator response shape unexpected',
      },
    }
  }
  if (
    phase === 'settle' &&
    typeof (body as { transactionHash?: unknown } | null)?.transactionHash !== 'string'
  ) {
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
