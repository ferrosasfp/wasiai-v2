/**
 * pendingRecordings.ts — On-chain recording retry with exponential backoff
 *
 * T-07: When recordInvocationOnChain() fails (gas spike, RPC timeout, etc.),
 *       this module stores the failed attempt and retries with backoff.
 *
 * Flow:
 *   1. On failure: call enqueuePendingRecording()
 *   2. Background worker (cron job or Vercel cron): call processPendingRecordings()
 *   3. After MAX_ATTEMPTS: mark as permanently failed for manual review
 *
 * Retry schedule: 5m → 20m → 80m → 320m → 1280m (exponential × 4)
 */
import { createServiceClient } from '@/lib/supabase/server'
import { recordInvocationOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

const MAX_ATTEMPTS = 5

/**
 * Compute next retry time with exponential backoff.
 * Attempt 0 → +5min, 1 → +20min, 2 → +80min, 3 → +320min, 4 → +1280min
 */
function nextRetryAt(attempts: number): Date {
  const delayMs = 5 * 60 * 1000 * Math.pow(4, attempts) // 5min × 4^attempts
  return new Date(Date.now() + delayMs)
}

interface PendingRecordingPayload {
  agentCallId?: string
  slug: string
  payerAddress: string
  amountUsdc: number
}

/**
 * Store a failed on-chain recording attempt for later retry.
 * Call this when recordInvocationOnChain() throws.
 */
export async function enqueuePendingRecording(payload: PendingRecordingPayload): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('pending_recordings').insert({
      agent_call_id: payload.agentCallId ?? null,
      slug:          payload.slug,
      payer_address: payload.payerAddress,
      amount_usdc:   payload.amountUsdc,
      attempts:      0,
      next_retry_at: new Date().toISOString(),
    })
    logger.info('[pendingRecordings] enqueued for retry', { slug: payload.slug })
  } catch (err) {
    // Last-ditch logging — don't throw, this is already a fallback path
    logger.error('[pendingRecordings] failed to enqueue', { err })
  }
}

/**
 * Process all due pending recordings.
 * Designed to be called from a cron job or API route (e.g. /api/cron/retry-recordings).
 *
 * @returns Number of items processed (success + fail)
 */
export async function processPendingRecordings(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const supabase = createServiceClient()
  const stats = { processed: 0, succeeded: 0, failed: 0 }

  // Fetch all pending items whose retry time has passed
  const { data: pending, error } = await supabase
    .from('pending_recordings')
    .select('*')
    .is('resolved_at', null)
    .lte('next_retry_at', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_retry_at', { ascending: true })
    .limit(20) // Process at most 20 per run to avoid timeout

  if (error) {
    logger.error('[pendingRecordings] fetch failed', { error })
    return stats
  }

  for (const record of (pending ?? [])) {
    stats.processed++

    try {
      const txHash = await recordInvocationOnChain({
        slug:         record.slug,
        payerAddress: record.payer_address,
        amountUSDC:   Number(record.amount_usdc),
      })

      if (txHash) {
        // Success — mark as resolved
        await supabase
          .from('pending_recordings')
          .update({ resolved_at: new Date().toISOString(), tx_hash: txHash })
          .eq('id', record.id)

        // Update agent_calls if we have the reference
        if (record.agent_call_id) {
          await supabase
            .from('agent_calls')
            .update({ on_chain_recorded: true, on_chain_tx_hash: txHash })
            .eq('id', record.agent_call_id)
        }

        logger.info('[pendingRecordings] retry succeeded', { slug: record.slug, txHash })
        stats.succeeded++
      } else {
        throw new Error('recordInvocationOnChain returned null')
      }
    } catch (err) {
      const newAttempts = record.attempts + 1
      const isPermanentFail = newAttempts >= MAX_ATTEMPTS

      await supabase
        .from('pending_recordings')
        .update({
          attempts:      newAttempts,
          last_error:    String(err).slice(0, 500),
          next_retry_at: isPermanentFail
            ? null  // No more retries — leave in table for manual review
            : nextRetryAt(newAttempts).toISOString(),
          resolved_at: isPermanentFail ? new Date().toISOString() : null,
        })
        .eq('id', record.id)

      logger.warn('[pendingRecordings] retry failed', {
        slug: record.slug,
        attempts: newAttempts,
        maxAttempts: MAX_ATTEMPTS,
        permanent: isPermanentFail,
      })
      stats.failed++
    }
  }

  return stats
}
