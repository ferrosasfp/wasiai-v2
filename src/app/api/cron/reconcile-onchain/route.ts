import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createServiceClient()
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS
  if (!contractAddress) {
    logger.warn('[reconcile] No contract address configured')
    return NextResponse.json({ skipped: true, reason: 'no contract' })
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  // Get all agents marked on_chain
  const { data: onChainAgents } = await serviceClient
    .from('agents')
    .select('id, slug, registration_type')
    .eq('registration_type', 'on_chain')

  let fixed = 0
  let verified = 0
  const errors: string[] = []

  for (const agent of (onChainAgents ?? [])) {
    try {
      const result = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'getAgent',
        args: [agent.slug],
      }) as { creator: string }

      const isRegistered = result.creator !== '0x0000000000000000000000000000000000000000'

      if (!isRegistered) {
        await serviceClient
          .from('agents')
          .update({
            registration_type: 'off_chain',
            on_chain_registered: false,
          })
          .eq('id', agent.id)

        logger.warn('[reconcile] Agent not on-chain, fixed DB', { slug: agent.slug })
        fixed++
      } else {
        verified++
      }
    } catch (err) {
      errors.push(agent.slug)
      logger.error('[reconcile] Failed to check agent', {
        slug: agent.slug,
        err: String(err).slice(0, 200),
      })
    }
  }

  const summary = { total: onChainAgents?.length ?? 0, verified, fixed, errors: errors.length }
  logger.info('[reconcile] Reconciliation complete', summary)

  return NextResponse.json(summary)
}
