import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

const BATCH_SIZE_LIMIT = 500

/**
 * Vercel Cron — ejecutar diariamente a las 02:00 UTC
 *
 * Liquida en batch todas las llamadas de API keys pendientes.
 * Una sola tx on-chain cubre cientos de llamadas → gas amortizado.
 *
 * Para agregar al vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/settle-key-batches", "schedule": "0 2 * * *" }]
 * }
 *
 * NOTA: Los Vercel Crons requieren plan Hobby o superior con crons habilitados.
 * Si no está disponible, este endpoint puede llamarse manualmente con el CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  // HAL-008: SIEMPRE verificar — si CRON_SECRET no está configurado, rechazar todo
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    logger.error('[settle-key-batches] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[settle-key-batches] Unauthorized cron attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // 1. Encontrar todas las llamadas con key no liquidadas
  // HAL-026: Limitar a últimos 7 días para evitar timeout con historial largo
  // Llamadas más antiguas se reconcilian con proceso separado si es necesario
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: unsettledCalls, error } = await supabase
    .from('agent_calls')
    .select('id, key_id, agent_slug, amount_paid')
    .not('key_id', 'is', null)
    .is('settled_at', null)
    .neq('status', 'error')  // solo llamadas exitosas
    .gte('called_at', sevenDaysAgo)
    .order('called_at', { ascending: true })

  if (error) {
    logger.error('[settle-key-batches] fetch error', { error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!unsettledCalls || unsettledCalls.length === 0) {
    logger.info('[settle-key-batches] No unsettled calls')
    return NextResponse.json({ ok: true, message: 'No unsettled calls', settled: 0 })
  }

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
      // Obtener key_hash del key_id (DB)
      const { data: keyRow } = await supabase
        .from('agent_keys')
        .select('key_hash')
        .eq('id', keyId)
        .single()

      if (!keyRow?.key_hash) {
        logger.warn('[settle-key-batches] key not found', { keyId })
        results.push({ keyId, txHash: null, callCount: 0, error: 'key not found' })
        continue
      }

      // HAL-018: Limitar batch a BATCH_SIZE_LIMIT para evitar exceder gas limit
      const allValidCalls = calls.filter(c => c.agent_slug && c.amount_paid && Number(c.amount_paid) > 0)
      if (allValidCalls.length === 0) {
        logger.warn('[settle-key-batches] no valid calls for key', { keyId })
        continue
      }

      // Procesar en sub-batches de BATCH_SIZE_LIMIT
      for (let batchStart = 0; batchStart < allValidCalls.length; batchStart += BATCH_SIZE_LIMIT) {
        const validCalls = allValidCalls.slice(batchStart, batchStart + BATCH_SIZE_LIMIT)
        if (validCalls.length === 0) continue

        const slugs   = validCalls.map(c => c.agent_slug as string)
        const amounts = validCalls.map(c => Number(c.amount_paid))
        const callIds = validCalls.map(c => c.id)

        const totalUsdc = amounts.reduce((a, b) => a + b, 0)

        // Crear registro de batch
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

        // Llamar al contrato on-chain
        const txHash = await settleKeyBatchOnChain(keyRow.key_hash, slugs, amounts)

        const now = new Date().toISOString()

        // Actualizar batch como confirmado (o fallido si txHash es null)
        if (txHash) {
          await supabase
            .from('key_batch_settlements')
            .update({ status: 'confirmed', tx_hash: txHash, confirmed_at: now })
            .eq('id', batchRecord?.id)

          // Marcar las llamadas como liquidadas
          await supabase
            .from('agent_calls')
            .update({
              settled_at:          now,
              settlement_tx_hash:  txHash,
              settlement_batch_id: batchRecord?.id,
            })
            .in('id', callIds)

          totalSettled += validCalls.length
          results.push({ keyId, txHash, callCount: validCalls.length })
        } else {
          // settleKeyBatchOnChain returned null (non-fatal error logged internally)
          await supabase
            .from('key_batch_settlements')
            .update({ status: 'failed', error: 'on-chain call returned null' })
            .eq('id', batchRecord?.id)

          results.push({ keyId, txHash: null, callCount: validCalls.length, error: 'on-chain call returned null' })
        }
      } // end sub-batch loop
    } catch (err) {
      // HAL-015: Detect balance mismatch (on-chain < DB) and alert
      const isInsufficientBalance = String(err).includes('insufficient key balance')

      logger.error('[settle-key-batches] batch failed', {
        keyId,
        err,
        alert: isInsufficientBalance ? 'KEY_BALANCE_MISMATCH' : 'UNKNOWN_ERROR',
      })

      if (isInsufficientBalance) {
        // Clear failed batch assignment from calls so they can be retried later
        await supabase
          .from('agent_calls')
          .update({ settlement_batch_id: null })
          .in('id', calls.map(c => c.id))

        // Mark the pending batch as balance_mismatch for manual reconciliation
        await supabase
          .from('key_batch_settlements')
          .update({
            status: 'balance_mismatch',
            error: 'On-chain balance < DB accumulated spend. Manual reconciliation required.',
          })
          .eq('key_id', keyId)
          .eq('status', 'pending')
      } else {
        // Generic failure — mark as failed for retry
        await supabase
          .from('key_batch_settlements')
          .update({ status: 'failed', error: String(err).slice(0, 500) })
          .eq('key_id', keyId)
          .eq('status', 'pending')
      }

      results.push({ keyId, txHash: null, callCount: calls.length, error: String(err).slice(0, 200) })
    }
  }

  logger.info('[settle-key-batches] done', { totalSettled, keys: byKey.size })
  return NextResponse.json({
    ok: true,
    settled: totalSettled,
    keys: byKey.size,
    results,
  })
}
