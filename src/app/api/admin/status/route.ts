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
    ])

    const avaxBalance = Number(avaxBalanceRaw) / 1e18

    return NextResponse.json({
      platformFeeBps: Number(platformFeeBpsRaw),
      avaxBalance,
      avaxBalanceLow: avaxBalance < 0.5,
      settlementMode: configRow?.value ?? 'vercel',
      lastSettlement: lastSettlement?.called_at ?? null,
    })
  } catch (err) {
    logger.error('[admin/status] error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
