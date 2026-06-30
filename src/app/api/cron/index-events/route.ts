import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { logger } from '@/lib/logger'
import { indexEvents } from '@/lib/indexer/eventIndexer'
import { verifyCronAuth } from '@/lib/cron/verifyCronSecret'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: Request) {
  // V-12: constant-time cron secret verification + fail-closed when unset.
  const auth = verifyCronAuth(req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS
  if (!contractAddress) {
    logger.warn('[index-events] No contract address configured')
    return NextResponse.json({ skipped: true, reason: 'no_contract' })
  }

  const serviceClient = createServiceClient()
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  const result = await indexEvents(serviceClient, {
    contractAddress: contractAddress as `0x${string}`,
    publicClient,
  })

  logger.info('[index-events] Done', result)
  return NextResponse.json({ ok: true, ...result })
}
