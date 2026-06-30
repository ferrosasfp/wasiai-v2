/**
 * reconcileLedger.ts — pure off-chain ↔ on-chain ledger reconciliation (WKH-128).
 *
 * Compares the off-chain DB ledger against on-chain marketplace state and
 * produces a structured divergence report. This module is PURE: it takes
 * already-fetched snapshots (DB + on-chain) and returns a report. It performs
 * NO I/O, NO contract reads, NO DB writes, and — critically — NEVER moves
 * money or auto-corrects balances (WKH-128 AC-3: alert/freeze only).
 *
 * Two ledgers are reconciled:
 *
 *  1. Agent key balance — off-chain available is derived from the DB as
 *     `budget_usdc - spent_usdc`; on-chain is `getKeyBalance(keyId)`. These
 *     should track each other within a dust tolerance.
 *  2. Creator earnings — off-chain is `creator_profiles.pending_earnings_usdc`;
 *     on-chain is `getPendingEarnings(creator)`.
 *
 * All amounts are in USDC dollars (number). The dust tolerance accounts for
 * 6-decimal rounding and in-flight settlement timing.
 */

/** Default dust tolerance in USDC dollars (1 cent). Divergence at or below
 * this magnitude is treated as a match (rounding / in-flight noise). */
export const DEFAULT_DUST_TOLERANCE_USDC = 0.01

/** Stable alert code emitted on divergence — keep grep-able and immutable. */
export const RECONCILE_DIVERGENCE_CODE = 'RECONCILE_DIVERGENCE' as const

export type LedgerKind = 'key_balance' | 'creator_earnings'

/** Snapshot of a single agent key for reconciliation. */
export interface KeyLedgerSnapshot {
  /** agent_keys.id (DB primary key) — opaque identifier for the report. */
  id: string
  /** agent_keys.key_hash (SHA-256 hex) — identifies the on-chain key. */
  keyHash: string
  /** Off-chain available = budget_usdc - spent_usdc, in USDC dollars. */
  offChainUsdc: number
  /** On-chain getKeyBalance(keyId), in USDC dollars. */
  onChainUsdc: number
}

/** Snapshot of a single creator's earnings for reconciliation. */
export interface CreatorLedgerSnapshot {
  /** creator_profiles wallet_address (lowercased) — identifies the creator. */
  wallet: string
  /** Off-chain creator_profiles.pending_earnings_usdc, in USDC dollars. */
  offChainUsdc: number
  /** On-chain getPendingEarnings(creator), in USDC dollars. */
  onChainUsdc: number
}

/** A single detected divergence (above tolerance). */
export interface Divergence {
  kind: LedgerKind
  /** Stable identifier for the affected ledger row (key id or creator wallet). */
  ref: string
  offChainUsdc: number
  onChainUsdc: number
  /** offChainUsdc - onChainUsdc (signed; positive = DB shows more than chain). */
  deltaUsdc: number
}

export interface ReconcileReport {
  kind: LedgerKind
  /** Number of snapshots inspected. */
  checked: number
  /** Number within tolerance. */
  matched: number
  /** Divergences above tolerance. */
  divergences: Divergence[]
  toleranceUsdc: number
}

/**
 * Round to 6 decimals (USDC atomic precision) to avoid float noise when
 * comparing against the tolerance.
 */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

/**
 * Returns true when |offChain - onChain| exceeds the tolerance.
 * Exposed for unit testing the boundary directly.
 */
export function isDivergent(
  offChainUsdc: number,
  onChainUsdc: number,
  toleranceUsdc: number = DEFAULT_DUST_TOLERANCE_USDC,
): boolean {
  return round6(Math.abs(offChainUsdc - onChainUsdc)) > round6(toleranceUsdc)
}

/**
 * Reconcile a batch of agent-key balance snapshots. Pure: no I/O, no mutation.
 */
export function reconcileKeyBalances(
  snapshots: readonly KeyLedgerSnapshot[],
  toleranceUsdc: number = DEFAULT_DUST_TOLERANCE_USDC,
): ReconcileReport {
  const divergences: Divergence[] = []
  let matched = 0

  for (const s of snapshots) {
    if (isDivergent(s.offChainUsdc, s.onChainUsdc, toleranceUsdc)) {
      divergences.push({
        kind: 'key_balance',
        ref: s.id,
        offChainUsdc: round6(s.offChainUsdc),
        onChainUsdc: round6(s.onChainUsdc),
        deltaUsdc: round6(s.offChainUsdc - s.onChainUsdc),
      })
    } else {
      matched++
    }
  }

  return {
    kind: 'key_balance',
    checked: snapshots.length,
    matched,
    divergences,
    toleranceUsdc,
  }
}

/**
 * Reconcile a batch of creator-earnings snapshots. Pure: no I/O, no mutation.
 */
export function reconcileEarnings(
  snapshots: readonly CreatorLedgerSnapshot[],
  toleranceUsdc: number = DEFAULT_DUST_TOLERANCE_USDC,
): ReconcileReport {
  const divergences: Divergence[] = []
  let matched = 0

  for (const s of snapshots) {
    if (isDivergent(s.offChainUsdc, s.onChainUsdc, toleranceUsdc)) {
      divergences.push({
        kind: 'creator_earnings',
        ref: s.wallet,
        offChainUsdc: round6(s.offChainUsdc),
        onChainUsdc: round6(s.onChainUsdc),
        deltaUsdc: round6(s.offChainUsdc - s.onChainUsdc),
      })
    } else {
      matched++
    }
  }

  return {
    kind: 'creator_earnings',
    checked: snapshots.length,
    matched,
    divergences,
    toleranceUsdc,
  }
}
