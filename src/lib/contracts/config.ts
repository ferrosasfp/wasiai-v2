import type { Address } from 'viem'

/**
 * Marketplace contract address resolution — single source of truth.
 *
 * WKH-126 (dual-address / parallel-run for non-custodial mainnet migration):
 * the marketplace contract is NON-upgradeable, so a fix requires deploying a new
 * contract at a NEW address. On mainnet, existing users hold key balances in the
 * OLD (legacy) contract; a hard cutover would strand them, because only the key
 * owner can `withdrawKey` (non-custodial). To run BOTH contracts in parallel we
 * resolve, per chain:
 *
 *   - `primary`: the M-1 contract used for ALL writes (deposits, settles) and
 *     reads. Published via `NEXT_PUBLIC_MARKETPLACE_ADDRESS_<network>` (and, on
 *     the server, kept coherent with `MARKETPLACE_CONTRACT_ADDRESS` — see
 *     configCoherence.test.ts).
 *   - `legacy` (optional): the OLD contract, READ-ONLY / withdraw-only. Only set
 *     when `NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_<network>` is configured.
 *
 * BACKWARD-COMPAT (CD-1, AC-7): when the legacy env is unset, `legacy` is
 * `undefined` and every consumer behaves EXACTLY as before — single-address.
 */

const ZERO = '0x0000000000000000000000000000000000000000'

function isUsableAddress(addr: string | undefined | null): addr is string {
  if (!addr) return false
  const trimmed = addr.trim()
  return trimmed.length > 0 && trimmed.toLowerCase() !== ZERO
}

/**
 * Resolve the active chain id. Mirrors the existing convention used across the
 * codebase (default Fuji testnet 43113).
 */
function activeChainId(): number {
  return Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
}

function publicPrimaryFor(chainId: number): string | undefined {
  return chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI
}

function publicLegacyFor(chainId: number): string | undefined {
  return chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI
}

/**
 * AC-1: per-chain dual-address resolution from the PUBLIC (client-safe) env.
 *
 * Returns `{ primary, legacy? }`:
 *  - `primary` is the M-1 contract for deposits/settles/reads. Falls back to
 *    `'0x'` (the historical sentinel from `getContractAddress`) when unset, so
 *    behavior is unchanged for not-yet-deployed environments.
 *  - `legacy` is present ONLY when the legacy env is set to a usable, non-zero
 *    address. When unset → `legacy` is `undefined` (backward-compat).
 */
export function getMarketplaceAddresses(
  chainId: number = activeChainId(),
): { primary: Address; legacy?: Address } {
  // Byte-identical to the historical getContractAddress(): `addr ?? '0x'`.
  // (No trim / zero-normalization on primary, to preserve exact prior behavior.)
  const primary = (publicPrimaryFor(chainId) ?? '0x') as Address

  const legacyRaw = publicLegacyFor(chainId)
  if (isUsableAddress(legacyRaw)) {
    return { primary, legacy: legacyRaw.trim() as Address }
  }
  return { primary }
}

/**
 * Backward-compatible single-address accessor. Unchanged contract for existing
 * callers (e.g. TransparencyDashboard): returns the PRIMARY address only.
 */
export function getContractAddress(): Address {
  return getMarketplaceAddresses().primary
}
