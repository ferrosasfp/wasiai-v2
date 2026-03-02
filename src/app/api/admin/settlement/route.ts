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
 * run    → dispara settleKeyBatchOnChain() directamente
 */
export async function POST(request: NextRequest) {
  // ORDEN OBLIGATORIO: leer body PRIMERO → construir message → verificar firma
  let body: SettlementBody
  try {
    body = await request.json() as SettlementBody
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const sig       = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr  = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr     = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) {
    return NextResponse.json({ error: 'Missing admin auth headers' }, { status: 401 })
  }

  const message: AdminActionMessage = {
    action:    `settlement:${body.action}`,
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
