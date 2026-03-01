import { NextRequest, NextResponse } from 'next/server'
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
 * run    → dispara settleKeyBatchOnChain() directamente
 */
export async function POST(request: NextRequest) {
  const sig = request.headers.get('x-admin-signature')
  if (!sig) {
    return NextResponse.json({ error: 'X-Admin-Signature required' }, { status: 401 })
  }

  let body: SettlementBody
  try {
    body = await request.json() as SettlementBody
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
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
  // Obtener todas las llamadas pendientes y procesarlas
  try {
    // Encontrar un key pendiente para forzar settlement
    const { data: pendingCall } = await supabase
      .from('agent_calls')
      .select('key_id, agent_slug, amount_paid')
      .not('key_id', 'is', null)
      .is('settled_at', null)
      .neq('status', 'error')
      .limit(1)
      .single()

    if (!pendingCall?.key_id) {
      return NextResponse.json({ ok: true, message: 'No pending calls to settle' })
    }

    const { data: keyRow } = await supabase
      .from('agent_keys')
      .select('key_hash')
      .eq('id', pendingCall.key_id)
      .single()

    if (!keyRow?.key_hash) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    }

    // Forzar settlement con los datos disponibles
    const slugs   = [pendingCall.agent_slug as string]
    const amounts = [Number(pendingCall.amount_paid)]
    const txHash  = await settleKeyBatchOnChain(keyRow.key_hash, slugs, amounts)

    logger.info('[admin/settlement] manual run', { txHash })
    return NextResponse.json({ ok: true, txHash: txHash ?? null })
  } catch (err) {
    logger.error('[admin/settlement] run failed', { err })
    return NextResponse.json(
      { error: 'Settlement failed', detail: String(err).slice(0, 300) },
      { status: 500 },
    )
  }
}
