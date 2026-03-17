import { SupabaseClient } from '@supabase/supabase-js'
import { settleKeyBatchOnChain, getPlatformFeeBps } from '@/lib/contracts/marketplaceClient'
import { PENDING_WALLET_SENTINEL } from '@/lib/settlement/immediateSettlement'
import { logger } from '@/lib/logger'

const BATCH_SIZE_LIMIT = 500

/**
 * Pipeline de settlement compartido entre settle-key-batches y upkeep-listener.
 * No incluye auth CRON_SECRET ni check de settlement_mode — eso es responsabilidad del caller.
 *
 * @param supabase SupabaseClient con service role (creado por el route handler)
 */
export async function runSettlement(supabase: SupabaseClient): Promise<{
  settled: number
  results: Array<{ keyId: string; txHash: string | null; callCount: number; error?: string }>
}> {
  // 0. Advisory lock — evitar doble ejecución concurrente (race condition WAS-82)
  // Compare-and-swap: solo actualiza si value = 'idle'
  const { data: lockRow, error: lockError } = await supabase
    .from('system_config')
    .update({ value: 'running', updated_at: new Date().toISOString() })
    .eq('key', 'settlement_lock')
    .eq('value', 'idle')
    .select('key')
    .single()

  if (lockError || !lockRow) {
    logger.info('[runSettlement] already running — skipping (settlement_lock)')
    return { settled: 0, results: [] }
  }

  try {
    return await _runSettlementPipeline(supabase)
  } finally {
    await supabase
      .from('system_config')
      .update({ value: 'idle' })
      .eq('key', 'settlement_lock')
  }
}

async function _runSettlementPipeline(supabase: SupabaseClient): Promise<{
  settled: number
  results: Array<{ keyId: string; txHash: string | null; callCount: number; error?: string }>
}> {
  // 1. Encontrar todas las llamadas con key no liquidadas
  // HAL-026: Limitar a últimos 7 días para evitar timeout con historial largo
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: unsettledCalls, error } = await supabase
    .from('agent_calls')
    .select('id, key_id, agent_slug, amount_paid')
    .not('key_id', 'is', null)
    .is('settled_at', null)
    .neq('status', 'error')
    .gte('called_at', sevenDaysAgo)
    .order('called_at', { ascending: true })

  if (error) {
    logger.error('[runSettlement] fetch error', { error })
    throw new Error(error.message)
  }

  if (!unsettledCalls || unsettledCalls.length === 0) {
    logger.info('[runSettlement] No unsettled calls')
    return { settled: 0, results: [] }
  }

  // 1b. Build slug → { creatorId, hasWallet } map
  const uniqueSlugs = [...new Set(unsettledCalls.map(c => c.agent_slug).filter(Boolean))] as string[]

  const slugCreatorMap = new Map<string, { creatorId: string; hasWallet: boolean }>()

  if (uniqueSlugs.length > 0) {
    const { data: agentRows } = await supabase
      .from('agents')
      .select('slug, creator_id')
      .in('slug', uniqueSlugs)

    if (agentRows && agentRows.length > 0) {
      const creatorIds = [...new Set(agentRows.map(a => a.creator_id).filter(Boolean))] as string[]

      const { data: profileRows } = await supabase
        .from('creator_profiles')
        .select('id, wallet_address')
        .in('id', creatorIds)

      const walletByCreator = new Map<string, boolean>()
      for (const p of profileRows ?? []) {
        walletByCreator.set(p.id, !!p.wallet_address)
      }

      for (const a of agentRows) {
        if (a.slug && a.creator_id) {
          slugCreatorMap.set(a.slug, {
            creatorId: a.creator_id,
            hasWallet: walletByCreator.get(a.creator_id) ?? false,
          })
        }
      }
    }
  }

  // SDD #17: Read platformFeeBps once per cron run to calculate creator share for walletCalls.
  // Asymmetry note:
  //   x402 calls  → NO on-chain split (USDC lands as free balance). DB incremented by 100% (invoke/route.ts).
  //   api_key calls → on-chain split via settleKeyBatch (90% creator / 10% platform). DB incremented by 90% here.
  // If on-chain read fails, fall back to PLATFORM_FEE_BPS env var (default 1000 = 10%).
  const onChainFeeBps = await getPlatformFeeBps()
  if (onChainFeeBps === null) {
    logger.warn('[runSettlement] getPlatformFeeBps failed — using fallback', {
      fallback: process.env.PLATFORM_FEE_BPS ?? '1000',
    })
  }
  const platformFeeBps = onChainFeeBps ?? Number(process.env.PLATFORM_FEE_BPS ?? '1000')

  // 2. Agrupar por key_id
  const byKey = new Map<string, typeof unsettledCalls>()
  for (const call of unsettledCalls) {
    if (!call.key_id) continue
    if (!byKey.has(call.key_id)) byKey.set(call.key_id, [])
    byKey.get(call.key_id)!.push(call)
  }

  let totalSettled = 0
  const results: Array<{
    keyId: string
    txHash: string | null
    callCount: number
    error?: string
  }> = []

  // 3. Liquidar cada key en batch
  for (const [keyId, calls] of byKey.entries()) {
    try {
      const { data: keyRow } = await supabase
        .from('agent_keys')
        .select('key_hash')
        .eq('id', keyId)
        .single()

      if (!keyRow?.key_hash) {
        logger.warn('[runSettlement] key not found', { keyId })
        results.push({ keyId, txHash: null, callCount: 0, error: 'key not found' })
        continue
      }

      // HAL-018: Solo llamadas válidas con monto > 0
      const allValidCalls = calls.filter(c => c.agent_slug && c.amount_paid && Number(c.amount_paid) > 0)
      if (allValidCalls.length === 0) {
        logger.warn('[runSettlement] no valid calls for key', { keyId })
        continue
      }

      // HU-1.1: Separar por si el creator tiene wallet configurado
      const walletCalls   = allValidCalls.filter(c => slugCreatorMap.get(c.agent_slug ?? '')?.hasWallet !== false)
      const noWalletCalls = allValidCalls.filter(c => slugCreatorMap.get(c.agent_slug ?? '')?.hasWallet === false)

      // Handle no-wallet calls: acumular en pending_earnings_usdc y marcar como PENDING_WALLET
      if (noWalletCalls.length > 0) {
        const now = new Date().toISOString()

        const pendingByCreator = new Map<string, number>()
        for (const call of noWalletCalls) {
          const info = slugCreatorMap.get(call.agent_slug ?? '')
          if (!info) continue
          pendingByCreator.set(info.creatorId, (pendingByCreator.get(info.creatorId) ?? 0) + Number(call.amount_paid))
        }

        for (const [creatorId, amount] of pendingByCreator.entries()) {
          try {
            await supabase.rpc('increment_pending_earnings', {
              p_user_id: creatorId,
              p_amount:  amount,
            })
          } catch (err) {
            logger.error('[runSettlement] increment_pending_earnings failed', { creatorId, err })
          }
        }

        await supabase
          .from('agent_calls')
          .update({
            settled_at:         now,
            settlement_tx_hash: PENDING_WALLET_SENTINEL,
          })
          .in('id', noWalletCalls.map(c => c.id))

        logger.info('[runSettlement] accumulated no-wallet calls', {
          keyId, count: noWalletCalls.length, creators: pendingByCreator.size,
        })
      }

      if (walletCalls.length === 0) continue

      // Procesar en sub-batches de BATCH_SIZE_LIMIT (solo wallet calls)
      for (let batchStart = 0; batchStart < walletCalls.length; batchStart += BATCH_SIZE_LIMIT) {
        const validCalls = walletCalls.slice(batchStart, batchStart + BATCH_SIZE_LIMIT)
        if (validCalls.length === 0) continue

        const slugs   = validCalls.map(c => c.agent_slug as string)
        const amounts = validCalls.map(c => Number(c.amount_paid))
        const callIds = validCalls.map(c => c.id)

        const totalUsdc = amounts.reduce((a, b) => a + b, 0)

        const { data: batchRecord } = await supabase
          .from('key_batch_settlements')
          .insert({
            key_id:     keyId,
            key_hash:   keyRow.key_hash,
            total_usdc: totalUsdc,
            call_count: validCalls.length,
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

          // SDD #17: Sync pending_earnings_usdc for wallet creators after on-chain settlement.
          // Contract split 90/10 already happened in settleKeyBatch — increment DB by creator share only.
          const earningsByCreator = new Map<string, number>()
          for (const call of validCalls) {
            const info = slugCreatorMap.get(call.agent_slug ?? '')
            if (!info) continue
            const amount      = Number(call.amount_paid)
            const creatorShare = amount - (amount * platformFeeBps / 10_000)
            earningsByCreator.set(info.creatorId, (earningsByCreator.get(info.creatorId) ?? 0) + creatorShare)
          }

          for (const [creatorId, amount] of earningsByCreator.entries()) {
            try {
              await supabase.rpc('increment_pending_earnings', {
                p_user_id: creatorId,
                p_amount:  Math.round(amount * 1_000_000) / 1_000_000, // USDC 6-decimal precision
              })
              logger.info('[runSettlement] synced earnings for wallet creator', { creatorId, amount })
            } catch (err) {
              // Non-blocking: settlement already recorded. Log and continue.
              logger.error('[runSettlement] increment_pending_earnings failed (wallet creator)', { creatorId, err })
            }
          }

          totalSettled += validCalls.length
          results.push({ keyId, txHash, callCount: validCalls.length })
        } else {
          await supabase
            .from('key_batch_settlements')
            .update({ status: 'failed', error: 'on-chain call returned null' })
            .eq('id', batchRecord?.id)

          results.push({ keyId, txHash: null, callCount: validCalls.length, error: 'on-chain call returned null' })
        }
      }
    } catch (err) {
      const isInsufficientBalance = String(err).includes('insufficient key balance')

      logger.error('[runSettlement] batch failed', {
        keyId,
        err,
        alert: isInsufficientBalance ? 'KEY_BALANCE_MISMATCH' : 'UNKNOWN_ERROR',
      })

      if (isInsufficientBalance) {
        await supabase
          .from('agent_calls')
          .update({ settlement_batch_id: null })
          .in('id', calls.map(c => c.id))

        await supabase
          .from('key_batch_settlements')
          .update({
            status: 'balance_mismatch',
            error: 'On-chain balance < DB accumulated spend. Manual reconciliation required.',
          })
          .eq('key_id', keyId)
          .eq('status', 'pending')
      } else {
        await supabase
          .from('key_batch_settlements')
          .update({ status: 'failed', error: String(err).slice(0, 500) })
          .eq('key_id', keyId)
          .eq('status', 'pending')
      }

      results.push({ keyId, txHash: null, callCount: calls.length, error: String(err).slice(0, 200) })
    }
  }

  logger.info('[runSettlement] done', { totalSettled, keys: byKey.size })
  return { settled: totalSettled, results }
}
