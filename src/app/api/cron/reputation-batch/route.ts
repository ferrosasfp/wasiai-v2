/**
 * GET /api/cron/reputation-batch
 *
 * Daily cron: aggregates off-chain ratings and submits batch to
 * WasiAIMarketplace.submitReputationBatch().
 *
 * AC-2, AC-3, AC-5, AC-7
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

const CHUNK_SIZE = 500

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined

  if (!contractAddress || !operatorKey) {
    logger.warn('[reputation-batch] Missing contract address or operator key')
    return NextResponse.json({ skipped: true, reason: 'missing config' })
  }

  // ── 1. Get last batch timestamp ───────────────────────────────────────────
  const { data: meta } = await supabase
    .from('cron_metadata')
    .select('value')
    .eq('key', 'last_reputation_batch_at')
    .single()

  const lastBatchAt = meta?.value ?? '1970-01-01T00:00:00Z'

  // ── 2. Query ratings since last batch ─────────────────────────────────────
  const { data: ratings, error: ratingsErr } = await supabase
    .from('agent_ratings')
    .select('agent_id, rating, updated_at')
    .gte('updated_at', lastBatchAt)

  if (ratingsErr) {
    logger.error('[reputation-batch] Failed to fetch ratings', { error: ratingsErr.message })
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (!ratings || ratings.length === 0) {
    logger.info('[reputation-batch] No new ratings since last batch, skipping')
    return NextResponse.json({ skipped: true, reason: 'no new ratings' })
  }

  // ── 3. Get ALL ratings per affected agent (for cumulative aggregation) ────
  const affectedAgentIds = [...new Set(ratings.map((r: { agent_id: string }) => r.agent_id))]

  const { data: agentsData } = await supabase
    .from('agents')
    .select('id, slug')
    .in('id', affectedAgentIds)

  if (!agentsData || agentsData.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no matching agents' })
  }

  const agentMap = new Map(agentsData.map((a: { id: string; slug: string }) => [a.id, a.slug]))

  const { data: allRatings } = await supabase
    .from('agent_ratings')
    .select('agent_id, rating')
    .in('agent_id', affectedAgentIds)

  if (!allRatings) {
    return NextResponse.json({ error: 'Failed to fetch all ratings' }, { status: 500 })
  }

  // ── 4. Aggregate per agent ────────────────────────────────────────────────
  const aggregated: { slug: string; avgRating: number; voteCount: number }[] = []

  for (const agentId of affectedAgentIds) {
    const slug = agentMap.get(agentId)
    if (!slug) continue

    const agentRatings = allRatings.filter((r: { agent_id: string }) => r.agent_id === agentId)
    const total = agentRatings.length
    if (total === 0) continue

    const upVotes = agentRatings.filter((r: { rating: number }) => r.rating === 1).length
    const avgRating = Math.round((upVotes / total) * 500)

    aggregated.push({ slug, avgRating, voteCount: total })
  }

  if (aggregated.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no aggregatable data' })
  }

  // ── 5. Submit batch to contract (chunked, max 500 per tx) ─────────────────
  const account = privateKeyToAccount(operatorKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  try {
    const chunks: typeof aggregated[] = []
    for (let i = 0; i < aggregated.length; i += CHUNK_SIZE) {
      chunks.push(aggregated.slice(i, i + CHUNK_SIZE))
    }

    let totalAgentsUpdated = 0
    let totalGasUsed = 0n
    let lastHash = ''

    for (const chunk of chunks) {
      const slugs = chunk.map(a => a.slug)
      const avgRatings = chunk.map(a => a.avgRating)
      const voteCounts = chunk.map(a => a.voteCount)

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'submitReputationBatch',
        args: [slugs, avgRatings, voteCounts],
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      totalAgentsUpdated += chunk.length
      totalGasUsed += receipt.gasUsed
      lastHash = hash
    }

    logger.info('[reputation-batch] Batch submitted', {
      txHash: lastHash,
      agents: totalAgentsUpdated,
      gasUsed: totalGasUsed.toString(),
    })

    // ── 6. Update last batch timestamp ──────────────────────────────────────
    const now = new Date().toISOString()
    await supabase
      .from('cron_metadata')
      .upsert(
        { key: 'last_reputation_batch_at', value: now, updated_at: now },
        { onConflict: 'key' }
      )

    return NextResponse.json({
      success: true,
      txHash: lastHash,
      agentsUpdated: totalAgentsUpdated,
      gasUsed: totalGasUsed.toString(),
    })
  } catch (err) {
    logger.error('[reputation-batch] Transaction failed', {
      error: String(err).slice(0, 500),
    })
    return NextResponse.json({ error: 'Transaction failed' }, { status: 500 })
  }
}
