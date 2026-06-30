/**
 * creditKeyBudget.ts — TB-06 (audit 2026-06-30) idempotent key-budget credit.
 *
 * Credits an agent key's budget for a CONFIRMED on-chain deposit, keyed by
 * (chain_id, tx_hash) so the same deposit transaction can never credit twice.
 *
 * Calls the idempotent RPC `increment_key_budget_idempotent` (added in
 * migration 20260630000000). Until that migration is applied on prod caldz, the
 * RPC does not exist; we DETECT that (PostgREST PGRST202 / Postgres 42883) and
 * fall back to the legacy `increment_key_budget` so the route stays safe to
 * deploy ahead of the migration. Once the migration is applied, the idempotent
 * path takes over automatically with no code change.
 *
 * ⚠️ DEFER-TO-HU: apply migration 20260630000000 on prod caldz to ACTIVATE the
 * anti-replay guarantee. Until then this falls back to the non-idempotent RPC.
 */
import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

export type CreditResult =
  | { ok: true; idempotent: boolean }
  | { ok: false; alreadyCredited: true }
  | { ok: false; alreadyCredited: false; error: string }

// PostgREST returns PGRST202 when the RPC signature/function is not found.
// Postgres raises 42883 (undefined_function). Either means the migration that
// adds increment_key_budget_idempotent has not been applied yet.
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '42883') return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('could not find the function') || m.includes('does not exist')
}

function isAlreadyCredited(err: { message?: string } | null): boolean {
  return !!err && (err.message ?? '').includes('DEPOSIT_ALREADY_CREDITED')
}

export async function creditKeyBudgetIdempotent(
  supabase: SupabaseClient,
  args: {
    keyId:   string
    amount:  number
    ownerId: string
    chainId: number
    txHash:  string
  },
): Promise<CreditResult> {
  const { keyId, amount, ownerId, chainId, txHash } = args

  const { error } = await supabase.rpc('increment_key_budget_idempotent', {
    p_key_id:   keyId,
    p_amount:   amount,
    p_owner_id: ownerId,
    p_chain_id: chainId,
    p_tx_hash:  txHash,
  })

  if (!error) return { ok: true, idempotent: true }

  if (isAlreadyCredited(error)) {
    logger.warn('[creditKeyBudget] deposit already credited — skipping double credit', {
      txHash, chainId, keyId,
    })
    return { ok: false, alreadyCredited: true }
  }

  if (isMissingFunction(error)) {
    // Migration not applied yet — fall back to the legacy non-idempotent RPC.
    logger.warn('[creditKeyBudget] idempotent RPC missing — falling back to increment_key_budget (apply migration 20260630000000)')
    const { error: legacyError } = await supabase.rpc('increment_key_budget', {
      p_key_id:   keyId,
      p_amount:   amount,
      p_owner_id: ownerId,
    })
    if (!legacyError) return { ok: true, idempotent: false }
    return { ok: false, alreadyCredited: false, error: legacyError.message }
  }

  return { ok: false, alreadyCredited: false, error: error.message }
}
