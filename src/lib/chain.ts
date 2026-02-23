/**
 * chain.ts — Single source of truth for all chain-related constants.
 *
 * Driven entirely by NEXT_PUBLIC_CHAIN_ID env var:
 *   43114 → Avalanche mainnet
 *   43113 → Avalanche Fuji testnet (default)
 *
 * Import these instead of hardcoding chain values anywhere.
 */

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
export const IS_MAINNET = CHAIN_ID === 43114
export const IS_TESTNET = !IS_MAINNET

/** Chain name used in x402 / UVD SDK */
export const CHAIN_NAME = IS_MAINNET ? 'avalanche' : 'avalanche-testnet'

/** Human-readable chain label */
export const CHAIN_LABEL = IS_MAINNET ? 'Avalanche' : 'Avalanche Fuji'

/** USDC contract address */
export const USDC_ADDRESS = IS_MAINNET
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  : '0x5425890298aed601595a70AB815c96711a31Bc65'

/** Block explorer base URL */
export const EXPLORER_URL = IS_MAINNET
  ? 'https://snowtrace.io'
  : 'https://testnet.snowtrace.io'

/** Snowscan base URL (used for contract/tx verification) */
export const SNOWSCAN_URL = IS_MAINNET
  ? 'https://snowscan.xyz'
  : 'https://testnet.snowscan.xyz'

/** Helper: build a tx link */
export const explorerTx  = (hash: string) => `${EXPLORER_URL}/tx/${hash}`

/** Helper: build an address link */
export const explorerAddr = (addr: string) => `${EXPLORER_URL}/address/${addr}`

/** Helper: build a Snowscan tx link */
export const snowscanTx  = (hash: string) => `${SNOWSCAN_URL}/tx/${hash}`

/** Helper: build a Snowscan address link */
export const snowscanAddr = (addr: string) => `${SNOWSCAN_URL}/address/${addr}`

/**
 * Networks array for Bazaar discovery metadata.
 * Always 'avalanche' — BazaarNetwork type doesn't include testnet variants.
 * The USDC/contract addresses are handled per-chain internally.
 *
 * T-08: Using readonly string[] instead of any[] for type safety.
 */
export const CHAIN_NETWORKS = ['avalanche'] as const
