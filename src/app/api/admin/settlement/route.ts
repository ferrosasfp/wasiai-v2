import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { createServiceClient } from '@/lib/supabase/server'
import { settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

type SettlementAction = 'run' | 'toggle'
type SettlementMode   = 'vercel' | 'chainlink'

interface SettlementBody {
  action: SettlementAction
  mode?:  SettlementMode
}

/**
 * POST /api/admin/settlement
 * Requiere header X-Admin-Signature.
 * Body: { action: 'run' | 'toggle', mode?: 'vercel' | 'chainlink' }
 *
 * toggle → actualiza system_config.settlement_mode
 * run    → procesa TODAS las calls pendientes agrupadas por key_id en batch
 */
export async function POST(request: NextRequest) {
  let body: SettlementBody
  try {
    body = await request.json() as SettlementBody
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) {
    return NextResponse.json({ error: 'Missing admin auth headers' }, { status: 401 })
  }

  const actionMap: Record<SettlementAction, string> = {
    run:    'runSettlement',
    toggle: 'toggleSettlement',
  }
  const message: AdminActionMessage = {
    action:    actionMap[body.action] ?? body.action,
    nonce:     nonceHdr,
    timestamp: BigInt(tsHdr),
  }

  const { ok, reason } = await verifyAdminSignature(sig, message)
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 })
  }

  const { action, mode } = body

  if (action !== 'run' && action !== 'toggle') {
    return NextResponse.json({ error: 'action must be "run" or "toggle"' }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (action === 'toggle') {
    if (mode !== 'vercel' && mode !== 'chainlink') {
      return NextResponse.json({ error: 'mode must be "vercel" or "chainlink"' }, { status: 400 })
    }
    const { error } = await supabase
      .from('system_config')
      .update({ value: mode, updated_at: new Date().toISOString() })
      .eq('key', 'settlement_mode')

    if (error) {
      logger.error('[admin/settlement] toggle failed', { error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    logger.info('[admin/settlement] mode toggled', { mode })
    return NextResponse.json({ ok: true, settlementMode: mode })
  }

  // action === 'run'
  // Procesar TODAS las calls pendientes agrupadas por key_id
  try {
    const { data: pendingCalls, error: fetchError } = await supabase
      .from('agent_calls')
      .select('id, key_id, agent_slug, amount_paid')
      .not('key_id', 'is', null)
      .is('settled_at', null)
      .neq('status', 'error')
      .order('created_at', { ascending: true })
      .limit(500) // safety cap

    if (fetchError) throw fetchError

    if (!pendingCalls || pendingCalls.length === 0) {
      return NextResponse.json({ ok: true, message: 'No pending calls to settle', settled: 0 })
    }

    // Agrupar calls por key_id → una tx on-chain por key
    const byKey = new Map<string, { slugs: string[]; amounts: number[]; callIds: string[] }>()
    for (const call of pendingCalls) {
      const keyId = call.key_id as string
      if (!byKey.has(keyId)) byKey.set(keyId, { slugs: [], amounts: [], callIds: [] })
      const group = byKey.get(keyId)!
      group.slugs.push(call.agent_slug as string)
      group.amounts.push(Number(call.amount_paid))
      group.callIds.push(call.id as string)
    }

    const results: Array<{ keyId: string; txHash: string | null; calls: number; error?: string }> = []
    let totalSettled = 0

    for (const [keyId, { slugs, amounts, callIds }] of byKey.entries()) {
      // Obtener key_hash
      const { data: keyRow } = await supabase
        .from('agent_keys')
        .select('key_hash')
        .eq('id', keyId)
        .single()

      if (!keyRow?.key_hash) {
        results.push({ keyId, txHash: null, calls: slugs.length, error: 'key_hash not found' })
        continue
      }

      logger.info('[admin/settlement] processing key batch', {
        keyId: keyId.slice(0, 8),
        calls: slugs.length,
        totalAmount: amounts.reduce((a, b) => a + b, 0).toFixed(6),
      })

      const txHash = await settleKeyBatchOnChain(keyRow.key_hash, slugs, amounts)

      if (txHash) {
        // Marcar calls como settled
        await supabase
          .from('agent_calls')
          .update({ settled_at: new Date().toISOString() })
          .in('id', callIds)

        totalSettled += callIds.length
        results.push({ keyId, txHash, calls: slugs.length })
        logger.info('[admin/settlement] key settled', { txHash, calls: slugs.length })
      } else {
        results.push({ keyId, txHash: null, calls: slugs.length, error: 'on-chain tx failed' })
        logger.error('[admin/settlement] key settlement failed', { keyId: keyId.slice(0, 8) })
      }
    }

    // Actualizar lastSettlement en system_config
    await supabase
      .from('system_config')
      .upsert(
        { key: 'last_manual_settlement', value: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )

    const failed = results.filter(r => !r.txHash).length
    logger.info('[admin/settlement] batch complete', { totalSettled, failed, keys: results.length })

    return NextResponse.json({
      ok:            failed === 0,
      settled:       totalSettled,
      keys_processed: results.length,
      keys_failed:   failed,
      results,
    })
  } catch (err) {
    const detail = err instanceof Error
      ? err.message
      : (typeof err === 'object' ? JSON.stringify(err) : String(err))
    logger.error('[admin/settlement] run failed', { err: detail })
    return NextResponse.json(
      { error: 'Settlement failed', detail: detail.slice(0, 500) },
      { status: 500 },
    )
  }
}
