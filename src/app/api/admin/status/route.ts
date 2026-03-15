import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getPublicClient } from '@/shared/lib/web3/client'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

const CONTRACT_ADDRESS = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '') as `0x${string}`
const OPERATOR_ADDRESS = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '') as `0x${string}`

/**
 * GET /api/admin/status
 * Sin auth requerida — el panel verifica ownership en cliente con wallet.
 * Retorna: { platformFeeBps, avaxBalance, settlementMode, lastSettlement }
 */
export async function GET() {
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
        ? client.getBalance({ address: OPERATOR_ADDRESS }).catch(() => 0n)
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
        .is('resolved_at', null),
      supabase.from('settlement_failures').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
      supabase.from('agent_calls').select('id', { count: 'exact', head: true }).eq('payment_type', 'x402').gte('called_at', new Date(Date.now() - 86400000).toISOString()),
    ])

    const avaxBalance = Number(avaxBalanceRaw) / 1e18

    let x402Alert: string | null = null
    if ((failuresPending ?? 0) > 0) x402Alert = `CRITICAL: ${failuresPending} settlement failures pending`
    else if (avaxBalance < 0.2) x402Alert = `WARNING: low operator AVAX (${avaxBalance.toFixed(3)})`

    return NextResponse.json({
      platformFeeBps: Number(platformFeeBpsRaw),
      avaxBalance,
      avaxBalanceLow: avaxBalance < 0.5,
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
