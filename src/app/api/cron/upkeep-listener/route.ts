import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { createServiceClient } from '@/lib/supabase/server'
import { runSettlement } from '@/lib/settlement/runSettlement'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

/**
 * Vercel Cron — ejecutar cada 5 minutos
 *
 * Verifica si Chainlink Automation necesita upkeep (checkUpkeep).
 * Si upkeepNeeded = true → ejecuta el pipeline de settlement off-chain.
 * Si upkeepNeeded = false → no hace nada (respuesta rápida).
 */

function getPublicClient() {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

export async function GET(request: NextRequest) {
  // Auth — idéntico a settle-key-batches
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    logger.error('[upkeep-listener] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[upkeep-listener] Unauthorized attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
    logger.warn('[upkeep-listener] Contract not configured')
    return NextResponse.json({ skipped: true, reason: 'contract_not_configured' })
  }

  // 1. Verificar si Chainlink necesita upkeep (view function — sin gas)
  let upkeepNeeded = false
  try {
    const pub = getPublicClient()
    const result = await pub.readContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'checkUpkeep',
      args:         ['0x'],
    }) as [boolean, `0x${string}`]
    upkeepNeeded = result[0]
    logger.info('[upkeep-listener] checkUpkeep result', { upkeepNeeded })
  } catch (err) {
    logger.error('[upkeep-listener] checkUpkeep RPC error', { err: String(err).slice(0, 300) })
    return NextResponse.json(
      { error: 'checkUpkeep RPC failed', detail: String(err).slice(0, 200) },
      { status: 500 }
    )
  }

  if (!upkeepNeeded) {
    return NextResponse.json({ ok: true, settled: 0, reason: 'upkeep_not_needed' })
  }

  // 2. upkeepNeeded = true → ejecutar settlement pipeline compartido
  logger.info('[upkeep-listener] upkeepNeeded=true — running settlement')
  const supabase = createServiceClient()
  const { settled, results } = await runSettlement(supabase)

  logger.info('[upkeep-listener] done', { settled, keys: results.length })
  return NextResponse.json({ ok: true, settled, keys: results.length, results })
}
