import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'

import { getPublicClient } from '@/shared/lib/web3/client'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

const CONTRACT_ADDRESS = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '') as `0x${string}`
const OPERATOR_ADDRESS = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '') as `0x${string}`

// V-08 (audit 2026-06-25): same EIP-712 admin gate as fee/settlement routes.
// The JSDoc claimed this endpoint required a signature but the handler had no
// auth, exposing operator AVAX balance, settlement health and failure counts.
async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}

/**
 * GET /api/admin/status
 * Requiere firma EIP-712 admin (NG-C02).
 * Retorna: { platformFeeBps, avaxBalance, settlementMode, lastSettlement }
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request, 'adminStatus')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 401 })

  try {
    const supabase = createServiceClient()
    const client   = getPublicClient()

    // WAS-132: pendingRecordings eliminado — recordInvocation() ya no existe
    const [
      avaxBalanceRaw,
      platformFeeBpsRaw,
      { data: configRow },
      { data: lastSettlement },
      { count: failuresPending },
      { count: failures24h },
      { count: invocations24h },
    ] = await Promise.all([
      OPERATOR_ADDRESS
        ? client.getBalance({ address: OPERATOR_ADDRESS as `0x${string}` }).catch((err) => {
            logger.warn('[admin/status] getBalance failed', { err: String(err).slice(0, 200), address: OPERATOR_ADDRESS })
            return 0n
          })
        : Promise.resolve(0n),
      CONTRACT_ADDRESS
        ? client.readContract({
            address:      CONTRACT_ADDRESS,
            abi:          WASIAI_MARKETPLACE_ABI,
            functionName: 'platformFeeBps',
          }).catch(() => 0)
        : Promise.resolve(0),
      supabase
        .from('system_config')
        .select('value')
        .eq('key', 'settlement_mode')
        .single(),
      supabase
        .from('agent_calls')
        .select('called_at')
        .order('called_at', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('settlement_failures')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null)
        .then((r) => r.error ? { count: 0 } : r),
      supabase.from('settlement_failures').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()).then((r) => r.error ? { count: 0 } : r),
      supabase.from('agent_calls').select('id', { count: 'exact', head: true }).eq('payment_type', 'x402').gte('called_at', new Date(Date.now() - 86400000).toISOString()),
    ])

    const IS_MAINNET = process.env.NEXT_PUBLIC_CHAIN === 'mainnet'
    const avaxBalance = Number(avaxBalanceRaw) / 1e18
    const avaxBalanceError = avaxBalanceRaw === 0n && IS_MAINNET ? 'check_rpc_or_address' : null

    let x402Alert: string | null = null
    if ((failuresPending ?? 0) > 0) x402Alert = `CRITICAL: ${failuresPending} settlement failures pending`
    else if (avaxBalance < 0.2) x402Alert = `WARNING: low operator AVAX (${avaxBalance.toFixed(3)})`

    return NextResponse.json({
      platformFeeBps: Number(platformFeeBpsRaw),
      avaxBalance,
      avaxBalanceLow: avaxBalance < 0.5,
      avaxBalanceError,
      settlementMode: configRow?.value ?? 'vercel',
      lastSettlement: lastSettlement?.called_at ?? null,
      settlement_failures_pending: failuresPending ?? 0,
      x402_health: {
        settlement_failures_pending: failuresPending ?? 0,
        settlement_failures_24h: failures24h ?? 0,
        total_invocations_x402_24h: invocations24h ?? 0,
        alert: x402Alert,
      },
    })
  } catch (err) {
    logger.error('[admin/status] error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
