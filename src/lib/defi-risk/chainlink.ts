/**
 * Agent 1 — Chainlink Price Feed Reader
 * Reads AggregatorV3Interface on-chain via viem v2
 * Uses: CHAINLINK_AVAX_USD_FEED env var as default feed
 */
import { getPublicClient } from '@/shared/lib/web3/client'
import type { ChainlinkResult } from './types'

// Minimal ABI for Chainlink AggregatorV3Interface
const AGGREGATOR_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId',         type: 'uint80' },
      { name: 'answer',          type: 'int256' },
      { name: 'startedAt',       type: 'uint256' },
      { name: 'updatedAt',       type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'getRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId',         type: 'uint80' },
      { name: 'answer',          type: 'int256' },
      { name: 'startedAt',       type: 'uint256' },
      { name: 'updatedAt',       type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

function rawToPrice(answer: bigint, decimals: number): number {
  return Number(answer) / Math.pow(10, decimals)
}

export async function readChainlinkFeed(
  feedAddress: string,
  tokenSymbol = 'UNKNOWN',
): Promise<ChainlinkResult> {
  const client = getPublicClient()
  const address = feedAddress.trim() as `0x${string}`

  try {
    // Parallel: get decimals + latest round data
    const [decimals, latest] = await Promise.all([
      client.readContract({ address, abi: AGGREGATOR_ABI, functionName: 'decimals' }),
      client.readContract({ address, abi: AGGREGATOR_ABI, functionName: 'latestRoundData' }),
    ])

    const dec = Number(decimals)
    const currentPrice = rawToPrice(latest[1], dec)
    const currentRoundId = latest[0]

    // Fetch 7 historical rounds (best-effort, skip on error)
    const HISTORY_COUNT = 7
    const history: ChainlinkResult['history'] = []

    for (let i = 0; i < HISTORY_COUNT; i++) {
      const targetRound = currentRoundId - BigInt(i + 1)
      if (targetRound <= 0n) break
      try {
        const round = await client.readContract({
          address,
          abi: AGGREGATOR_ABI,
          functionName: 'getRoundData',
          args: [targetRound],
        })
        history.push({
          round_id:  round[0].toString(),
          price_usd: rawToPrice(round[1], dec),
          timestamp: Number(round[3]),
        })
      } catch {
        // Round not available — skip
        break
      }
    }

    // Calculate 7d volatility: (max - min) / min * 100
    const prices = [currentPrice, ...history.map(h => h.price_usd)]
    const maxP = Math.max(...prices)
    const minP = Math.min(...prices)
    const volatility_7d_pct = minP > 0 ? ((maxP - minP) / minP) * 100 : 0

    return {
      feed_address:     address,
      token_symbol:     tokenSymbol,
      price_usd:        currentPrice,
      timestamp:        Number(latest[3]),
      round_id:         currentRoundId.toString(),
      history,
      volatility_7d_pct: Math.round(volatility_7d_pct * 100) / 100,
    }
  } catch (err) {
    return {
      feed_address:     address,
      token_symbol:     tokenSymbol,
      price_usd:        0,
      timestamp:        0,
      round_id:         '0',
      history:          [],
      volatility_7d_pct: 0,
      error:            `Chainlink read failed: ${String(err).slice(0, 200)}`,
    }
  }
}
