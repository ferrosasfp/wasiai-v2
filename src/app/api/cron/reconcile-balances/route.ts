/**
 * GET /api/cron/reconcile-balances — WKH-128 (ecosystem-audit V-01).
 *
 * Periodic, READ-ONLY reconciler. Compares the off-chain DB ledger against
 * on-chain marketplace state and emits a structured alert (RECONCILE_DIVERGENCE)
 * + records each divergence on any mismatch beyond a dust tolerance.
 *
 * Guarantees (AC-3): this route NEVER moves money, settles, deposits, or
 * auto-credits. It only reads (DB + chain) and writes alert/divergence records.
 * Auto-correction is explicitly OUT of scope for v1 to avoid a new
 * double-credit path.
 *
 * Bounded work (AC-4): keys and creators are paginated and capped per
 * invocation via RECONCILE_MAX_KEYS / RECONCILE_MAX_CREATORS so a single run
 * fits the cron window.
 *
 * Auth (AC via cron-secret): constant-time CRON_SECRET bearer verification,
 * fail-closed when unset (verifyCronAuth — same pattern as the other crons).
 *
 * MNR-1 (freeze is OBSERVABILITY-ONLY in v1): the optional `freeze=1` flag
 * writes `agent_keys.is_frozen=true` for diverging keys, but that column is
 * NOT yet read by the settle path (settle-key-batches does not gate on
 * `is_frozen`). So today the flag is a durable observability marker only — it
 * does NOT actually stop settlement. Real enforcement (gating
 * settle-key-batches on `is_frozen=false`) ships together with the `is_frozen`
 * column migration as a migration-coupled follow-up. Until then, `is_frozen`
 * being written here has no effect on money movement.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/cron/verifyCronSecret'
import { logger } from '@/lib/logger'
import {
  getKeyBalanceForReconcile,
  getPendingEarningsForReconcile,
} from '@/lib/contracts/marketplaceClient'
import {
  reconcileKeyBalances,
  reconcileEarnings,
  RECONCILE_DIVERGENCE_CODE,
  DEFAULT_DUST_TOLERANCE_USDC,
  type KeyLedgerSnapshot,
  type CreatorLedgerSnapshot,
  type Divergence,
} from '@/lib/reconcile/reconcileLedger'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Default per-run caps (overridable via env). Keeps a single run bounded. */
const DEFAULT_MAX_KEYS = 200
const DEFAULT_MAX_CREATORS = 200

type ServiceClient = ReturnType<typeof createServiceClient>

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Build off-chain ↔ on-chain key snapshots. Off-chain available is the DB
 * ledger `budget_usdc - spent_usdc`; on-chain is `getKeyBalance`.
 *
 * MNR-2: the on-chain read uses the reconcile-only variant that returns `null`
 * on RPC error (vs the 0-fallback used in settle/payment paths). A `null`
 * on-chain value means "chain unknown (RPC blip)", NOT "chain says 0", so the
 * key is SKIPPED — it is never pushed into the snapshot list, hence never
 * compared, alerted, or frozen. This prevents a transient RPC failure from
 * being read as off-chain≫on-chain=0 and false-alarming RECONCILE_DIVERGENCE
 * (and freezing) for every key. `skipped` is surfaced for observability.
 */
async function buildKeySnapshots(
  service: ServiceClient,
  limit: number,
): Promise<{ snapshots: KeyLedgerSnapshot[]; skipped: number }> {
  const { data, error } = await service
    .from('agent_keys')
    .select('id, key_hash, budget_usdc, spent_usdc')
    .eq('is_active', true)
    .not('key_hash', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    logger.error('[reconcile-balances] failed to read agent_keys', {
      err: String(error.message).slice(0, 200),
    })
    return { snapshots: [], skipped: 0 }
  }

  const rows = (data ?? []) as Array<{
    id: string
    key_hash: string
    budget_usdc: number | null
    spent_usdc: number | null
  }>

  const snapshots: KeyLedgerSnapshot[] = []
  let skipped = 0
  for (const row of rows) {
    const offChainUsdc = Number(row.budget_usdc ?? 0) - Number(row.spent_usdc ?? 0)
    // MNR-2: null = on-chain unknown (RPC error) → skip; only compare when the
    // on-chain read definitively succeeded.
    const onChainUsdc = await getKeyBalanceForReconcile(row.key_hash)
    if (onChainUsdc === null) {
      skipped++
      continue
    }
    snapshots.push({
      id: row.id,
      keyHash: row.key_hash,
      offChainUsdc,
      onChainUsdc,
    })
  }
  return { snapshots, skipped }
}

/**
 * Build off-chain ↔ on-chain creator snapshots. Off-chain is the DB
 * `pending_earnings_usdc`; on-chain is `getPendingEarnings(wallet)`.
 *
 * MNR-2: same null-vs-zero distinction as buildKeySnapshots — a `null`
 * on-chain read means "chain unknown (RPC blip)" and the creator is SKIPPED
 * (never compared / alerted / frozen). `skipped` is surfaced for observability.
 */
async function buildCreatorSnapshots(
  service: ServiceClient,
  limit: number,
): Promise<{ snapshots: CreatorLedgerSnapshot[]; skipped: number }> {
  const { data, error } = await service
    .from('creator_profiles')
    .select('wallet_address, pending_earnings_usdc')
    .not('wallet_address', 'is', null)
    .gt('pending_earnings_usdc', 0)
    .order('pending_earnings_usdc', { ascending: false })
    .limit(limit)

  if (error) {
    logger.error('[reconcile-balances] failed to read creator_profiles', {
      err: String(error.message).slice(0, 200),
    })
    return { snapshots: [], skipped: 0 }
  }

  const rows = (data ?? []) as Array<{
    wallet_address: string
    pending_earnings_usdc: number | null
  }>

  const snapshots: CreatorLedgerSnapshot[] = []
  let skipped = 0
  for (const row of rows) {
    const wallet = row.wallet_address.toLowerCase()
    const offChainUsdc = Number(row.pending_earnings_usdc ?? 0)
    // MNR-2: null = on-chain unknown (RPC error) → skip; only compare when the
    // on-chain read definitively succeeded.
    const onChainUsdc = await getPendingEarningsForReconcile(wallet)
    if (onChainUsdc === null) {
      skipped++
      continue
    }
    snapshots.push({ wallet, offChainUsdc, onChainUsdc })
  }
  return { snapshots, skipped }
}

/**
 * Persist divergences as durable records (AC-2: "not just a transient log").
 * Best-effort: if the table does not exist yet (migration is DEFER-TO-HU), the
 * insert error is swallowed so the alert path still runs. Returns the number of
 * rows successfully recorded.
 */
async function recordDivergences(
  service: ServiceClient,
  divergences: Divergence[],
): Promise<number> {
  if (divergences.length === 0) return 0
  const rows = divergences.map((d) => ({
    kind: d.kind,
    ref: d.ref,
    off_chain_usdc: d.offChainUsdc,
    on_chain_usdc: d.onChainUsdc,
    delta_usdc: d.deltaUsdc,
  }))
  const { error } = await service.from('reconcile_divergences').insert(rows)
  if (error) {
    logger.warn('[reconcile-balances] could not persist divergences (table may be pending migration)', {
      err: String(error.message).slice(0, 200),
      count: rows.length,
    })
    return 0
  }
  return rows.length
}

/**
 * Optionally mark diverging keys non-settleable until resolved by writing
 * `agent_keys.is_frozen=true`. Gated by the `freeze=1` query flag (default
 * off). Best-effort: a missing `is_frozen` column (migration DEFER-TO-HU) is
 * logged, not fatal. This does NOT move funds.
 *
 * MNR-1: `is_frozen` is OBSERVABILITY-ONLY in v1. The settle path
 * (settle-key-batches) does NOT yet read this flag, so writing it here does
 * not actually block settlement — it is a durable marker for ops/dashboards.
 * Enforcement (gating settle-key-batches on `is_frozen=false`) lands together
 * with the `is_frozen` column migration as a follow-up. Do NOT assume freezing
 * here stops money movement today.
 */
async function freezeDiverging(
  service: ServiceClient,
  keyReport: { divergences: Divergence[] },
): Promise<number> {
  let frozen = 0
  for (const d of keyReport.divergences) {
    if (d.kind !== 'key_balance') continue
    const { error } = await service
      .from('agent_keys')
      .update({ is_frozen: true })
      .eq('id', d.ref)
    if (error) {
      logger.warn('[reconcile-balances] freeze failed (is_frozen column may be pending migration)', {
        ref: d.ref,
        err: String(error.message).slice(0, 200),
      })
      continue
    }
    frozen++
  }
  return frozen
}

export async function GET(req: Request) {
  const auth = verifyCronAuth(req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS
  if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
    logger.warn('[reconcile-balances] no contract address configured')
    return NextResponse.json({ skipped: true, reason: 'no contract' })
  }

  const url = new URL(req.url)
  const freeze = url.searchParams.get('freeze') === '1'

  const maxKeys = intFromEnv('RECONCILE_MAX_KEYS', DEFAULT_MAX_KEYS)
  const maxCreators = intFromEnv('RECONCILE_MAX_CREATORS', DEFAULT_MAX_CREATORS)
  const tolerance = floatFromEnv('RECONCILE_TOLERANCE_USDC', DEFAULT_DUST_TOLERANCE_USDC)

  const service = createServiceClient()

  const { snapshots: keySnapshots, skipped: keysSkipped } = await buildKeySnapshots(service, maxKeys)
  const { snapshots: creatorSnapshots, skipped: creatorsSkipped } = await buildCreatorSnapshots(service, maxCreators)

  const keyReport = reconcileKeyBalances(keySnapshots, tolerance)
  const creatorReport = reconcileEarnings(creatorSnapshots, tolerance)

  const allDivergences = [...keyReport.divergences, ...creatorReport.divergences]

  // AC-2: structured alert with a stable code on any divergence.
  if (allDivergences.length > 0) {
    logger.error(RECONCILE_DIVERGENCE_CODE, {
      code: RECONCILE_DIVERGENCE_CODE,
      toleranceUsdc: tolerance,
      keyDivergences: keyReport.divergences,
      creatorDivergences: creatorReport.divergences,
    })
  }

  const recorded = await recordDivergences(service, allDivergences)
  const frozen = freeze ? await freezeDiverging(service, keyReport) : 0

  const summary = {
    contract: contractAddress,
    toleranceUsdc: tolerance,
    keys: {
      checked: keyReport.checked,
      matched: keyReport.matched,
      divergences: keyReport.divergences.length,
      // MNR-2: keys whose on-chain read failed (RPC unknown) — skipped, not compared.
      skipped: keysSkipped,
    },
    creators: {
      checked: creatorReport.checked,
      matched: creatorReport.matched,
      divergences: creatorReport.divergences.length,
      skipped: creatorsSkipped,
    },
    recorded,
    frozen,
    freezeEnabled: freeze,
  }
  logger.info('[reconcile-balances] complete', summary)

  return NextResponse.json(summary)
}
