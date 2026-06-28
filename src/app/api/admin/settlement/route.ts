import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { createServiceClient } from '@/lib/supabase/server'
import { settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'
import { jsonError } from '@/lib/api/jsonError'

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
      return jsonError('db_error', 'Failed to toggle settlement mode', 500, { logDetail: error })
    }

    logger.info('[admin/settlement] mode toggled', { mode })
    return NextResponse.json({ ok: true, settlementMode: mode })
  }

  // action === 'run'
  // Procesar TODAS las calls pendientes agrupadas por key_id
  try {
    const {
      getKeyBalanceOnChain,
      isAgentRegisteredOnChain,
      getPlatformFeeBps,
    } = await import('@/lib/contracts/marketplaceClient')

    // Platform fee bps: prefer on-chain truth (same source settleKeyBatch splits by),
    // fall back to PLATFORM_FEE_BPS env (default 1000 = 10%). Mirrors runSettlement.ts.
    const onChainFeeBps = await getPlatformFeeBps()
    if (onChainFeeBps === null) {
      logger.warn('[admin/settlement] getPlatformFeeBps failed — using fallback', {
        fallback: process.env.PLATFORM_FEE_BPS ?? '1000',
      })
    }
    const PLATFORM_FEE_BPS = Math.floor(onChainFeeBps ?? Number(process.env.PLATFORM_FEE_BPS ?? '1000'))

    const { data: pendingCalls, error: fetchError } = await supabase
      .from('agent_calls')
      .select('id, key_id, agent_slug, amount_paid')
      .not('key_id', 'is', null)
      .not('agent_slug', 'is', null)  // skip null slugs — cannot settle on-chain
      .is('settled_at', null)
      .eq('payment_type', 'api_key')
      .neq('status', 'error')
      .limit(500)

    if (fetchError) throw fetchError

    if (!pendingCalls || pendingCalls.length === 0) {
      return NextResponse.json({ ok: true, message: 'No pending calls to settle', settled: 0 })
    }

    // AC-10: Log excluded calls (non api_key or no slug)
    const { count: excluded } = await supabase
      .from('agent_calls')
      .select('id', { count: 'exact', head: true })
      .is('settled_at', null)
      .neq('status', 'error')
      .or('payment_type.neq.api_key,agent_slug.is.null')
    console.debug(`[settlement] Excluding ${excluded ?? 0} calls (non api_key or no slug)`)

    // Pre-verificar qué slugs están registrados on-chain
    const uniqueSlugs = [...new Set(pendingCalls.map(c => c.agent_slug as string))]
    const registrationMap = new Map<string, boolean>()
    await Promise.all(
      uniqueSlugs.map(s =>
        isAgentRegisteredOnChain(s)
          .then(ok => registrationMap.set(s, ok))
          .catch(() => registrationMap.set(s, false))
      )
    )
    const unregisteredSlugs = uniqueSlugs.filter(s => !registrationMap.get(s))
    if (unregisteredSlugs.length > 0) {
      logger.warn('[admin/settlement] unregistered slugs will be skipped', { unregisteredSlugs })
    }

    // Agrupar calls por key_id, excluyendo slugs no registrados
    const byKey = new Map<string, { slugs: string[]; amounts: number[]; callIds: string[] }>()
    for (const call of pendingCalls) {
      const slug = call.agent_slug as string
      if (!registrationMap.get(slug)) continue  // skip unregistered
      const keyId = call.key_id as string
      if (!byKey.has(keyId)) byKey.set(keyId, { slugs: [], amounts: [], callIds: [] })
      const group = byKey.get(keyId)!
      group.slugs.push(slug)
      group.amounts.push(Number(call.amount_paid))
      group.callIds.push(call.id as string)
    }

    if (byKey.size === 0) {
      return NextResponse.json({
        ok: false,
        message: 'All pending calls have unregistered slugs',
        unregistered: unregisteredSlugs,
        settled: 0,
      })
    }

    const results: Array<{ keyId: string; txHash: string | null; calls: number; skipped?: number; error?: string }> = []
    let totalSettled = 0

    for (const [keyId, { slugs, amounts, callIds }] of byKey.entries()) {
      const { data: keyRow } = await supabase
        .from('agent_keys')
        .select('key_hash')
        .eq('id', keyId)
        .single()

      if (!keyRow?.key_hash) {
        results.push({ keyId, txHash: null, calls: slugs.length, error: 'key_hash not found' })
        continue
      }

      // Verificar balance on-chain de la key
      const keyBalanceUsdc = await getKeyBalanceOnChain(keyRow.key_hash).catch(() => 0)
      const totalAmount    = amounts.reduce((a, b) => a + b, 0)

      // Recortar batch si el total excede el balance on-chain
      let batchSlugs   = slugs
      let batchAmounts = amounts
      let batchCallIds = callIds
      if (totalAmount > keyBalanceUsdc) {
        let running = 0
        const cutIdx = amounts.findIndex(a => { running += a; return running > keyBalanceUsdc })
        if (cutIdx === 0) {
          results.push({ keyId, txHash: null, calls: slugs.length, error: `key balance $${keyBalanceUsdc.toFixed(4)} < first call $${amounts[0]}` })
          continue
        }
        const end    = cutIdx === -1 ? slugs.length : cutIdx
        batchSlugs   = slugs.slice(0, end)
        batchAmounts = amounts.slice(0, end)
        batchCallIds = callIds.slice(0, end)
        logger.warn('[admin/settlement] batch trimmed to fit key balance', {
          original: slugs.length, trimmed: end, balance: keyBalanceUsdc, total: totalAmount,
        })
      }

      logger.info('[admin/settlement] processing key batch', {
        keyId: keyId.slice(0, 8),
        calls: batchSlugs.length,
        totalAmount: batchAmounts.reduce((a, b) => a + b, 0).toFixed(6),
        keyBalance: keyBalanceUsdc,
      })

      const txHash = await settleKeyBatchOnChain(keyRow.key_hash, batchSlugs, batchAmounts)

      if (txHash) {
        await supabase
          .from('agent_calls')
          .update({ settled_at: new Date().toISOString() })
          .in('id', batchCallIds)

        // WAS-275: Post-settlement sync — sync budget_usdc and spent_usdc atomically
        try {
          const postSettleBalance = await getKeyBalanceOnChain(keyRow.key_hash)
          const { error: rpcErr } = await supabase.rpc('sync_key_after_settlement', {
            p_key_id: keyId,
            p_call_ids: batchCallIds,
            p_new_budget: postSettleBalance,
          })
          if (rpcErr) throw rpcErr
          // balance_synced_at se actualiza dentro del RPC — no hace falta UPDATE separado
        } catch (syncErr) {
          logger.warn('[admin/settlement] post-settlement sync failed', { keyId, err: String(syncErr).slice(0, 200) })
        }

        // Actualizar pending_earnings_usdc en creator_profiles por cada creator
        // Calcular earnings por creator (net = total - platform fee). El fee bps
        // sale de PLATFORM_FEE_BPS (on-chain / env, default 1000 = 10%) calculado arriba.
        const earningsByCreator = new Map<string, number>()
        for (let i = 0; i < batchSlugs.length; i++) {
          let creatorWallet: string | null = null
          if (batchSlugs[i]) {
            try {
              const { data: agentRow } = await supabase
                .from('agents')
                .select('creator_wallet')
                .eq('slug', batchSlugs[i])
                .single()
              creatorWallet = agentRow?.creator_wallet ?? null
            } catch { /* skip */ }
          }
          if (creatorWallet) {
            const net = (batchAmounts[i] ?? 0) * (1 - PLATFORM_FEE_BPS / 10000)
            earningsByCreator.set(creatorWallet, (earningsByCreator.get(creatorWallet) ?? 0) + net)
          }
        }
        for (const [wallet, amount] of earningsByCreator.entries()) {
          if (amount > 0) {
            try {
              // Try RPC first; if it doesn't exist fall back to direct update
              const { error: rpcErr } = await supabase.rpc('increment_pending_earnings', { p_wallet: wallet, p_amount: amount })
              if (rpcErr) {
                const { data: profileRow } = await supabase
                  .from('creator_profiles')
                  .select('id, pending_earnings_usdc')
                  .eq('wallet_address', wallet)
                  .single()
                if (profileRow) {
                  await supabase
                    .from('creator_profiles')
                    .update({ pending_earnings_usdc: Number(profileRow.pending_earnings_usdc) + amount })
                    .eq('id', profileRow.id)
                }
              }
            } catch {
              logger.warn('[admin/settlement] could not update pending_earnings for creator', { wallet })
            }
          }
        }

        totalSettled += batchCallIds.length
        const skipped = callIds.length - batchCallIds.length
        results.push({ keyId, txHash, calls: batchCallIds.length, ...(skipped > 0 ? { skipped } : {}) })
        logger.info('[admin/settlement] key settled', { txHash, calls: batchCallIds.length })
      } else {
        results.push({ keyId, txHash: null, calls: batchSlugs.length, error: 'on-chain tx failed' })
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
    return jsonError('settlement_failed', 'Settlement failed', 500, { logDetail: err })
  }
}
