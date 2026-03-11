import { avalanche, avalancheFuji } from 'viem/chains'
import type { Chain } from 'viem'

/**
 * EVM Chain Registry
 * Avalanche is the default. To add a new chain:
 * 1. Import it from 'viem/chains'
 * 2. Add to supportedChains array
 * 3. Update chainIdSchema in validation.ts
 *
 * Example: import { polygon, polygonAmoy } from 'viem/chains'
 */

export const supportedChains: readonly [Chain, ...Chain[]] = [
  avalancheFuji,
  avalanche,
  // polygon,
  // polygonAmoy,
  // base,
  // baseSepolia,
  // mainnet,
  // sepolia,
]

// Default chain based on NEXT_PUBLIC_CHAIN_ID (43114 = mainnet, 43113 = fuji)
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '43113')
export const defaultChain = chainId === 43114 ? avalanche : avalancheFuji

export function getChainById(chainId: number): Chain | undefined {
  return supportedChains.find((chain) => chain.id === chainId)
}

export const testnetChains = supportedChains.filter((chain) =>
  chain.testnet === true
)

export const mainnetChains = supportedChains.filter((chain) =>
  chain.testnet !== true
)
