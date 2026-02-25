/**
 * immediateSettlement.ts
 *
 * Triggered when a creator configures their wallet for the first time.
 * Settles all pending on-chain calls that were accumulated in
 * pending_earnings_usdc while the creator had no wallet.
 *
 * Fire-and-forget: called without awaiting in /api/creator/wallet.
 * Errors are logged but never thrown — wallet save must not be blocked.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

/** Sentinel used by settle-key-batches cron when creator has no wallet */
export const PENDING_WALLET_SENTINEL = 'PENDING_WALLET'

const BATCH_SIZE_LIMIT = 500
const LOOKBACK_DAYS    = 7

export async function triggerImmediateSettlement(userId: string): Promise<void> {
  const supabase = createServiceClient()

  // 1. Get all agent slugs for this creator
  const { data: agents, error: agentsErr } = await supabase
    .from('agents')
    .select('slug')
    .eq('creator_id', userId)

  if (agentsErr) {
    logger.error('[immediateSettlement] failed to fetch agents', { userId, err: agentsErr.message })
    return
  }

  if (!agents || agents.length === 0) {
    // No agents — just clear the pending counter
    await supabase
      .from('creator_profiles')
      .update({ pending_earnings_usdc: 0 })
      .eq('id', userId)
    return
  }

  const creatorSlugs = agents.map(a => a.slug as string)

  // 2. Find all calls that need on-chain settlement:
  //    a) Calls marked PENDING_WALLET by the cron (accumulated, not yet on-chain)
  //    b) Fresh calls not yet processed (settled_at IS NULL)
  const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: pendingCalls, error: callsErr } = await supabase
    .from('agent_calls')
    .select('id, key_id, agent_slug, amount_paid, settled_at, settlement_tx_hash')
    .in('agent_slug', creatorSlugs)
    .not('key_id', 'is', null)
    .or(`settled_at.is.null,settlement_tx_hash.eq.${PENDING_WALLET_SENTINEL}`)
    .neq('status', 'error')
    .gte('called_at', lookback)
    .order('called_at', { ascending: true })

  if (callsErr) {
    logger.error('[immediateSettlement] failed to fetch pending calls', { userId, err: callsErr.message })
    return
  }

  if (!pendingCalls || pendingCalls.length === 0) {
    logger.info('[immediateSettlement] no pending calls', { userId })
    await supabase
      .from('creator_profiles')
      .update({ pending_earnings_usdc: 0 })
      .eq('id', userId)
    return
  }

  // 3. Group by key_id
  const byKey = new Map<string, typeof pendingCalls>()
  for (const call of pendingCalls) {
    if (!call.key_id) continue
    if (!byKey.has(call.key_id)) byKey.set(call.key_id, [])
    byKey.get(call.key_id)!.push(call)
  }

  // 4. Settle each key batch on-chain
  for (const [keyId, calls] of byKey.entries()) {
    try {
      const { data: keyRow } = await supabase
        .from('agent_keys')
        .select('key_hash')
        .eq('id', keyId)
        .single()

      if (!keyRow?.key_hash) {
        logger.warn('[immediateSettlement] key not found', { keyId })
        continue
      }

      const validCalls = calls.filter(
        c => c.agent_slug && c.amount_paid && Number(c.amount_paid) > 0,
      )
      if (validCalls.length === 0) continue

      // Process in sub-batches to stay within gas limit
      for (let start = 0; start < validCalls.length; start += BATCH_SIZE_LIMIT) {
        const batch    = validCalls.slice(start, start + BATCH_SIZE_LIMIT)
        const slugs    = batch.map(c => c.agent_slug as string)
        const amounts  = batch.map(c => Number(c.amount_paid))
        const callIds  = batch.map(c => c.id)
        const totalUsd = amounts.reduce((a, b) => a + b, 0)

        // Create batch record
        const { data: batchRecord } = await supabase
          .from('key_batch_settlements')
          .insert({
            key_id:     keyId,
            key_hash:   keyRow.key_hash,
            total_usdc: totalUsd,
            call_count: batch.length,
            status:     'pending',
          })
          .select('id')
          .single()

        const txHash = await settleKeyBatchOnChain(keyRow.key_hash, slugs, amounts)

        const now = new Date().toISOString()
        if (txHash) {
          await supabase
            .from('key_batch_settlements')
            .update({ status: 'confirmed', tx_hash: txHash, confirmed_at: now })
            .eq('id', batchRecord?.id)

          await supabase
            .from('agent_calls')
            .update({
              settled_at:          now,
              settlement_tx_hash:  txHash,
              settlement_batch_id: batchRecord?.id,
            })
            .in('id', callIds)

          logger.info('[immediateSettlement] batch settled', {
            userId, keyId, callCount: batch.length, txHash,
          })
        } else {
          await supabase
            .from('key_batch_settlements')
            .update({ status: 'failed', error: 'immediate settlement returned null' })
            .eq('id', batchRecord?.id)

          logger.warn('[immediateSettlement] on-chain call returned null', { userId, keyId })
        }
      }
    } catch (err) {
      // Non-fatal: cron diario resolverá el próximo día
      logger.error('[immediateSettlement] key batch failed', {
        userId, keyId, err: String(err).slice(0, 200),
      })
    }
  }

  // 5. Zero out pending_earnings_usdc — wallet is now set,
  //    cron will handle any remaining unsettled calls correctly next run
  await supabase
    .from('creator_profiles')
    .update({ pending_earnings_usdc: 0 })
    .eq('id', userId)

  logger.info('[immediateSettlement] completed', { userId })
}
