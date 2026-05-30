/**
 * WAS-V2-2: Dual facilitator router.
 *
 * Routes x402 settlements between wasiai-facilitator (primary, when toggle on)
 * and Ultravioleta DAO (fallback). Internal `settlePaymentDirectly` is used only
 * when toggle off AND no UVD URL configured (preserves WAS-V2-1 baseline).
 *
 * Pure module — no module-level caches (delegates to x402-facilitator-config).
 * Emits exactly ONE `logger.info('[settler]', ...)` per settlement (CD-10).
 *
 * Invariants:
 *   - CD-3: caller signature is preserved by usdcSettler.settlePaymentX402.
 *   - CD-5: NONCE_ALREADY_USED → no fallback to UVD (idempotency on-chain).
 *   - CD-9: error classification via extractCode (single source). No HTTP status
 *           inspection — verifyExternal/settleExternal already map status to
 *           SettlementResult.error.
 *   - CD-10: single logger.info('[settler]', ...) per settlement.
 *   - CD-11: never builds envelopes — delegates to buildX402V2Envelope.
 *   - CD-13: never reads process.env.WASIAI_FACILITATOR_AS_PRIMARY directly.
 */
import { logger } from '@/lib/logger'
import {
  getFacilitatorUrl,
  isWasiaiFacilitatorPrimary,
  getWasiaiFacilitatorUrl,
  getWasiaiFacilitatorApiKey,
  WASIAI_CHAIN_ALLOWLIST,
} from './x402-facilitator-config'
import {
  buildX402V2Envelope,
  verifyExternal,
  settleExternal,
  type SettlePaymentX402Ctx,
  type X402V2Envelope,
} from './x402-facilitator-client'
import {
  settlePaymentDirectly,
  type X402EVMPayload,
  type SettlementResult,
} from './usdcSettler'

// ─── Types ────────────────────────────────────────────────────────────────────

type FallbackReason =
  | 'wasiai_5xx'
  | 'wasiai_unreachable'
  | 'wasiai_invalid_payload'
  | 'wasiai_chain_unavailable'
  | 'chain_not_in_allowlist'
  | 'toggle_off'

type FacilitatorUsed = 'wasiai' | 'ultravioleta' | 'internal'

type SettleAttempt =
  | { outcome: 'ok'; result: SettlementResult }
  | { outcome: 'guard'; result: SettlementResult; code: 'NONCE_ALREADY_USED' }
  | { outcome: 'fail'; result: SettlementResult; reason: FallbackReason; code: string }

// ─── Helpers (pure) ───────────────────────────────────────────────────────────

/** Same convention as usdcSettler.ts extractCode: code is the prefix before ':'. */
function extractCode(err: string | undefined): string | undefined {
  return err?.split(':')[0]
}

/**
 * Network literal → canonical x402 v2 form. Defensive: returns null when
 * the literal is not recognized (DT-J — chain_not_in_allowlist).
 */
function networkToEip155(network: SettlePaymentX402Ctx['network']): string | null {
  if (network === 'avalanche') return 'eip155:43114'
  if (network === 'avalanche-testnet') return 'eip155:43113'
  return null
}

/**
 * Classify a wasiai SettlementResult.error string into a FallbackReason
 * (used when the call did NOT succeed and was NOT a NONCE guard).
 *
 * CD-9: classification uses ONLY the code prefix + literal disambiguation
 * for the unreachable case. No HTTP status leakage from the client layer.
 *
 * §6.1.1 table — Dev pragmatic resolution:
 *   - 'CHAIN_UNAVAILABLE: facilitator unreachable' (literal from client:180)
 *       → 'wasiai_unreachable' (AC-7)
 *   - Any other CHAIN_UNAVAILABLE message → 'wasiai_chain_unavailable' (AC-8)
 *   - INVALID_PAYLOAD → 'wasiai_invalid_payload' (AC-8)
 *   - Any other known code → 'wasiai_5xx' (AC-6 catchall)
 */
function classifyWasiaiFailure(errorString: string | undefined): FallbackReason {
  if (errorString === 'CHAIN_UNAVAILABLE: facilitator unreachable') {
    return 'wasiai_unreachable'
  }
  const code = extractCode(errorString)
  if (code === 'CHAIN_UNAVAILABLE') return 'wasiai_chain_unavailable'
  if (code === 'INVALID_PAYLOAD') return 'wasiai_invalid_payload'
  return 'wasiai_5xx'
}

/**
 * Convert a SettlementResult coming from `verifyExternal`/`settleExternal`
 * (when `ok: false`) into a SettleAttempt. NONCE_ALREADY_USED short-circuits
 * into 'guard' regardless of phase (CD-5).
 */
function classifyFacilitatorError(result: SettlementResult): SettleAttempt {
  const code = extractCode(result.error)
  if (code === 'NONCE_ALREADY_USED') {
    return { outcome: 'guard', result, code: 'NONCE_ALREADY_USED' }
  }
  return {
    outcome: 'fail',
    result,
    reason: classifyWasiaiFailure(result.error),
    code: code ?? 'UNKNOWN',
  }
}

/**
 * Attempt settlement against an external facilitator (wasiai or UVD).
 * Runs verify, then settle if verify ok. Returns a SettleAttempt with the
 * outcome bucket already classified.
 *
 * CD-11: envelope is passed by reference; no spread, no mutation.
 *
 * WAS-V2-INT: `apiKey` is propagated to the client as the Authorization bearer.
 * It is passed ONLY by the wasiai branch (CASE C). The UVD branch calls this
 * with apiKey omitted (undefined) so UVD — a third-party — never receives it.
 */
async function tryExternal(
  envelope: X402V2Envelope,
  url: string,
  signal: AbortSignal,
  apiKey?: string,
): Promise<SettleAttempt> {
  const verifyRes = await verifyExternal(envelope, url, signal, apiKey)
  if (!verifyRes.ok) {
    return classifyFacilitatorError(verifyRes.error)
  }

  const settleRes = await settleExternal(envelope, url, signal, apiKey)
  if (!settleRes.ok) {
    return classifyFacilitatorError(settleRes.error)
  }

  return {
    outcome: 'ok',
    result: {
      verified: true,
      settled: true,
      transactionHash: settleRes.body.transactionHash,
    },
  }
}

/**
 * Attempt settlement via the internal direct path (settlePaymentDirectly).
 * Used when no UVD URL is configured (toggle off + X402_FACILITATOR_URL unset),
 * preserving WAS-V2-1 baseline behavior.
 */
async function tryInternal(
  payload: X402EVMPayload,
  required: string,
): Promise<SettleAttempt> {
  const result = await settlePaymentDirectly(payload, required)
  if (result.verified && result.settled) {
    return { outcome: 'ok', result }
  }
  // Internal path doesn't use facilitator codes; classify by extractCode if present.
  const code = extractCode(result.error) ?? 'UNKNOWN'
  return {
    outcome: 'fail',
    result,
    reason: 'wasiai_5xx', // unused for internal — chosen as a neutral default
    code,
  }
}

// ─── Public surface ───────────────────────────────────────────────────────────

/**
 * Route an x402 settlement to wasiai-facilitator (primary), Ultravioleta DAO
 * (fallback) or internal settlePaymentDirectly (baseline), emitting exactly
 * ONE structured log entry (CD-10) at the end.
 *
 * Decision tree (mirrors Story §6 W1.1):
 *   - toggle off → UVD if URL configured else internal.
 *   - toggle on + chain not in allowlist → UVD if URL configured else internal.
 *   - toggle on + chain in allowlist →
 *       wasiai first
 *         ok    → return
 *         guard → return (no fallback, CD-5)
 *         fail  → fall back to UVD (or internal if no UVD URL)
 */
export async function trySettle(
  payload: X402EVMPayload,
  required: string,
  ctx: SettlePaymentX402Ctx,
): Promise<SettlementResult> {
  const start = Date.now()
  const primary = isWasiaiFacilitatorPrimary()
  const uvdUrl = getFacilitatorUrl()

  // CASE A — toggle off → behavior identical to WAS-V2-1 baseline.
  if (!primary) {
    return await runUvdOrInternal({
      payload,
      required,
      ctx,
      uvdUrl,
      start,
      fallbackTriggered: false,
      fallbackReason: undefined,
      wasiaiOutcome: 'skipped',
    })
  }

  // CASE B — toggle on but chain NOT in allowlist → UVD direct, no wasiai attempt.
  const chainEip = networkToEip155(ctx.network)
  if (chainEip === null || !WASIAI_CHAIN_ALLOWLIST.has(chainEip)) {
    logger.debug('[facilitator-router] chain bypass', {
      reason: 'chain_not_in_allowlist',
      network: ctx.network,
    })
    return await runUvdOrInternal({
      payload,
      required,
      ctx,
      uvdUrl,
      start,
      fallbackTriggered: false,
      fallbackReason: 'chain_not_in_allowlist',
      wasiaiOutcome: 'skipped',
    })
  }

  // CASE C — try wasiai first.
  const wasiaiUrl = getWasiaiFacilitatorUrl()
  // WAS-V2-INT: bearer key for the wasiai-facilitator ONLY. null when env unset
  // (graceful — no header). Threaded exclusively through this wasiai branch;
  // the UVD branch in runUvdOrInternal never receives it.
  const wasiaiApiKey = getWasiaiFacilitatorApiKey() ?? undefined
  const envelope = buildX402V2Envelope(payload, ctx)
  const signal = AbortSignal.timeout(30_000)

  const wasiaiAttempt = await tryExternal(envelope, wasiaiUrl, signal, wasiaiApiKey)

  if (wasiaiAttempt.outcome === 'ok') {
    emitLog({
      ctx,
      facilitatorUsed: 'wasiai',
      fallbackTriggered: false,
      fallbackReason: undefined,
      durationMs: Date.now() - start,
      ok: true,
      errorCode: undefined,
      wasiaiOutcome: 'ok',
      uvdOutcome: 'skipped',
      bothFailed: false,
    })
    return wasiaiAttempt.result
  }

  if (wasiaiAttempt.outcome === 'guard') {
    // CD-5 / AC-10: idempotency guard. DO NOT fall back. UVD is NEVER called.
    emitLog({
      ctx,
      facilitatorUsed: 'wasiai',
      fallbackTriggered: false,
      fallbackReason: undefined,
      durationMs: Date.now() - start,
      ok: false,
      errorCode: 'NONCE_ALREADY_USED',
      wasiaiOutcome: 'guard',
      uvdOutcome: 'skipped',
      bothFailed: false,
      idempotencyGuardTriggered: true,
    })
    return wasiaiAttempt.result
  }

  // CASE C-fail — fall back to UVD (or internal if no UVD URL).
  // BLQ-MED-1: do NOT propagate the wasiai AbortSignal to the UVD branch.
  // After a wasiai timeout the signal is already aborted; reusing it would
  // cause UVD's fetch to abort immediately, defeating the fallback.
  // runUvdOrInternal mints a fresh AbortSignal.timeout(30_000) per call.
  return await runUvdOrInternal({
    payload,
    required,
    ctx,
    uvdUrl,
    start,
    fallbackTriggered: true,
    fallbackReason: wasiaiAttempt.reason,
    wasiaiOutcome: 'fail',
    wasiaiEnvelope: envelope,
  })
}

// ─── Internal — run UVD branch (or internal fallback) + emit single log ──────

interface RunUvdArgs {
  payload: X402EVMPayload
  required: string
  ctx: SettlePaymentX402Ctx
  uvdUrl: string | null
  start: number
  fallbackTriggered: boolean
  fallbackReason: FallbackReason | undefined
  wasiaiOutcome: 'ok' | 'fail' | 'guard' | 'skipped'
  /** Reuse pre-built envelope when falling back from wasiai (avoids rebuild). */
  wasiaiEnvelope?: X402V2Envelope
}

async function runUvdOrInternal(args: RunUvdArgs): Promise<SettlementResult> {
  const {
    payload, required, ctx, uvdUrl, start,
    fallbackTriggered, fallbackReason, wasiaiOutcome,
    wasiaiEnvelope,
  } = args

  let attempt: SettleAttempt
  let facilitatorUsed: FacilitatorUsed

  if (uvdUrl === null) {
    facilitatorUsed = 'internal'
    attempt = await tryInternal(payload, required)
  } else {
    facilitatorUsed = 'ultravioleta'
    const envelope = wasiaiEnvelope ?? buildX402V2Envelope(payload, ctx)
    // BLQ-MED-1: ALWAYS mint a fresh signal for UVD. Reusing the wasiai signal
    // is unsafe — if wasiai timed out, the signal is already aborted and
    // UVD's fetch would abort immediately, breaking the fallback path.
    const signal = AbortSignal.timeout(30_000)
    // WAS-V2-INT: NO apiKey arg here. UVD is a third-party facilitator and must
    // NEVER receive FACILITATOR_API_KEY (the wasiai-facilitator bearer). The
    // 4th param is intentionally omitted → undefined → no Authorization header.
    attempt = await tryExternal(envelope, uvdUrl, signal)
  }

  const ok = attempt.outcome === 'ok'
  const errorCode = ok ? undefined : extractCode(attempt.result.error)
  const uvdOutcome: 'ok' | 'fail' | 'skipped' = ok ? 'ok' : 'fail'

  emitLog({
    ctx,
    facilitatorUsed,
    fallbackTriggered,
    fallbackReason,
    durationMs: Date.now() - start,
    ok,
    errorCode,
    wasiaiOutcome,
    uvdOutcome,
    bothFailed: fallbackTriggered && !ok, // AC-9
  })

  return attempt.result
}

// ─── Telemetry — single point of emission (CD-10) ────────────────────────────

interface EmitLogArgs {
  ctx: SettlePaymentX402Ctx
  facilitatorUsed: FacilitatorUsed
  fallbackTriggered: boolean
  fallbackReason: FallbackReason | undefined
  durationMs: number
  ok: boolean
  errorCode: string | undefined
  wasiaiOutcome: 'ok' | 'fail' | 'guard' | 'skipped'
  uvdOutcome: 'ok' | 'fail' | 'skipped'
  bothFailed: boolean
  idempotencyGuardTriggered?: boolean
}

function emitLog(args: EmitLogArgs): void {
  // CD-4: never log signatures/PKs/full authorization. Only ctx metadata.
  // CD-11: no spread of ctx/payload/envelope — explicit keys only.
  logger.info('[settler]', {
    requestId: args.ctx.requestId,
    agentSlug: args.ctx.agentSlug,
    facilitatorUsed: args.facilitatorUsed,
    fallbackTriggered: args.fallbackTriggered,
    fallbackReason: args.fallbackReason,
    durationMs: args.durationMs,
    ok: args.ok,
    errorCode: args.errorCode,
    wasiai_outcome: args.wasiaiOutcome,
    uvd_outcome: args.uvdOutcome,
    both_failed: args.bothFailed,
    idempotencyGuardTriggered: args.idempotencyGuardTriggered === true ? true : undefined,
  })
}
