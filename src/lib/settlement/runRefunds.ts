import { SupabaseClient } from '@supabase/supabase-js'
import { transferUsdc } from '@/lib/contracts/usdcSettler'
import { toAtomic } from '@/lib/money/usdc'
import { logger } from '@/lib/logger'

const REFUND_BATCH_LIMIT = 100

export interface RefundRow {
  id:                 string
  settlement_tx_hash: string
  payer_address:      string
  amount_usdc:        string | number
  agent_slug:         string | null
}

export interface RunRefundsResult {
  refunded: number
  results:  Array<{ id: string; refundTxHash: string | null; error?: string }>
}

/**
 * V6: Refund processor — mirror of runSettlement.
 *
 * Takes refunds in status 'pending' (settle-OK + upstream-fail cases) and sends
 * the owed USDC back to the original payer on-chain, from the operator wallet.
 *
 * ANTI DOUBLE-REFUND INVARIANT
 * ----------------------------
 * A refund must never be paid twice. Two independent guards enforce this:
 *
 *   1. `UNIQUE(settlement_tx_hash)` on the refunds table → a given failed
 *      settlement produces at most ONE refund row in the first place.
 *   2. Atomic claim (`claim_refund` RPC: UPDATE ... WHERE status='pending'
 *      RETURNING) flips pending → processing in a single statement. Only the
 *      worker that observes the affected row proceeds to the transfer; a
 *      concurrent run claims 0 rows and skips. The row is marked 'done' ONLY
 *      after the on-chain transfer is confirmed.
 *
 * FAIL-SAFE: if the transfer fails (or throws), the row is left in 'failed'
 * (never 'done' without an on-chain tx_hash). A failed refund can be requeued
 * to 'pending' for retry by an operator; we never mark done without confirmation.
 *
 * @param supabase SupabaseClient with service role (created by the caller).
 */
export async function runRefunds(supabase: SupabaseClient): Promise<RunRefundsResult> {
  // 1. Fetch pending refunds (oldest first).
  const { data: pending, error } = await supabase
    .from('refunds')
    .select('id, settlement_tx_hash, payer_address, amount_usdc, agent_slug')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(REFUND_BATCH_LIMIT)

  if (error) {
    logger.error('[runRefunds] fetch error', { error: error.message })
    throw new Error(error.message)
  }

  if (!pending || pending.length === 0) {
    logger.info('[runRefunds] no pending refunds')
    return { refunded: 0, results: [] }
  }

  let refunded = 0
  const results: RunRefundsResult['results'] = []

  for (const row of pending as RefundRow[]) {
    try {
      // 2. Atomic claim: pending → processing. Only one worker wins this row.
      const { data: claimed, error: claimErr } = await supabase
        .rpc('claim_refund', { p_id: row.id })

      if (claimErr) {
        logger.error('[runRefunds] claim_refund failed', { id: row.id, err: claimErr.message })
        results.push({ id: row.id, refundTxHash: null, error: 'claim_failed' })
        continue
      }
      // Empty result = another worker already claimed it (or it's no longer pending).
      if (!Array.isArray(claimed) || claimed.length === 0) {
        logger.info('[runRefunds] refund already claimed — skipping', { id: row.id })
        continue
      }

      // 3. On-chain transfer: operator wallet → payer. Amount = exactly what the
      // caller paid (the settled amount), converted to atomic micro-USDC.
      const atomic = toAtomic(row.amount_usdc).toString()
      const transfer = await transferUsdc(row.payer_address, atomic)

      if (transfer.success && transfer.transactionHash) {
        // 4. Mark done ONLY after confirmed on-chain transfer.
        await supabase
          .from('refunds')
          .update({
            status:         'done',
            refund_tx_hash: transfer.transactionHash,
            processed_at:   new Date().toISOString(),
          })
          .eq('id', row.id)

        refunded += 1
        results.push({ id: row.id, refundTxHash: transfer.transactionHash })
        logger.info('[runRefunds] refund paid', { id: row.id, payer: row.payer_address, amount: row.amount_usdc, refundTxHash: transfer.transactionHash })
      } else {
        // FAIL-SAFE: transfer not confirmed → mark failed for retry, never done.
        await supabase
          .from('refunds')
          .update({
            status:       'failed',
            error_reason: (transfer.error ?? 'transfer_failed').slice(0, 500),
            processed_at: new Date().toISOString(),
          })
          .eq('id', row.id)

        results.push({ id: row.id, refundTxHash: null, error: transfer.error ?? 'transfer_failed' })
        logger.error('[runRefunds] refund transfer failed', { id: row.id, payer: row.payer_address, error: transfer.error })
      }
    } catch (err) {
      // FAIL-SAFE: unexpected throw → leave row in 'failed', never 'done'.
      try {
        await supabase
          .from('refunds')
          .update({ status: 'failed', error_reason: String(err).slice(0, 500), processed_at: new Date().toISOString() })
          .eq('id', row.id)
      } catch { /* best-effort */ }
      logger.error('[runRefunds] refund threw', { id: row.id, err: String(err).slice(0, 200) })
      results.push({ id: row.id, refundTxHash: null, error: String(err).slice(0, 200) })
    }
  }

  logger.info('[runRefunds] done', { refunded, processed: pending.length })
  return { refunded, results }
}
