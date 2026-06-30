/**
 * usdc.ts — USDC token addresses per chain + active-chain helper.
 *
 * Centralizes the per-chain USDC address (previously inlined in deposit routes)
 * so the receipt-amount decoder (TB-06) and the deposit routes agree on the same
 * token to match Transfer logs against.
 */
import type { Address } from 'viem'

export const USDC_ADDRESS_BY_CHAIN: Record<number, Address> = {
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche mainnet
  43113: '0x5425890298aed601595a70AB815c96711a31Bc65', // Avalanche Fuji
}

export const ACTIVE_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

export function getActiveUsdcAddress(): Address | null {
  return USDC_ADDRESS_BY_CHAIN[ACTIVE_CHAIN_ID] ?? null
}
