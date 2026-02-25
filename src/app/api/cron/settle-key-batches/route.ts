import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

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
  // Verificar autorización — Vercel Cron envía este header automáticamente
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET?.trim()}`) {
    logger.warn('[settle-key-batches] Unauthorized cron attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // 1. Encontrar todas las llamadas con key no liquidadas
  const { data: unsettledCalls, error } = await supabase
    .from('agent_calls')
    .select('id, key_id, agent_slug, amount_paid')
    .not('key_id', 'is', null)
    .is('settled_at', null)
    .neq('status', 'error')  // solo llamadas exitosas
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

      // Filtrar llamadas con slug y amount válidos
      const validCalls = calls.filter(c => c.agent_slug && c.amount_paid && Number(c.amount_paid) > 0)
      if (validCalls.length === 0) {
        logger.warn('[settle-key-batches] no valid calls for key', { keyId })
        continue
      }

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
    } catch (err) {
      logger.error('[settle-key-batches] batch failed', { keyId, err })

      // Marcar batch como fallido para retry
      await supabase
        .from('key_batch_settlements')
        .update({ status: 'failed', error: String(err).slice(0, 500) })
        .eq('key_id', keyId)
        .eq('status', 'pending')

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
