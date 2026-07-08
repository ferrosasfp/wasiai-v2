/**
 * WKH-162 — Coherence guard between the two independent env-var families that
 * resolve the marketplace contract address for the active network:
 *   - MARKETPLACE_CONTRACT_ADDRESS          → server on-chain write path
 *       (marketplaceClient.ts getContractAddress() → withdrawFor + admin/cron routes)
 *   - NEXT_PUBLIC_MARKETPLACE_ADDRESS_<net> → EIP-712 voucher `verifyingContract`
 *       (voucher route) and the client config.ts getContractAddress() reader
 *
 * If they drift, the voucher's EIP-712 domain separator stops matching the real
 * contract and claimEarnings() reverts silently on-chain — creators can't
 * withdraw. assertMarketplaceAddressCoherence() asserts both match
 * (case-insensitive: a checksum difference is NOT drift) so the voucher path
 * fails LOUD before signing instead of minting a voucher that reverts.
 *
 * Money-safe: reads + compares only. It does NOT change which env var any path
 * reads nor the effective address. The guard applies only where BOTH vars are
 * configured for the active network; a network without a NEXT_PUBLIC voucher var
 * is left untouched (no voucher path to protect).
 *
 * Kept as a standalone pure module (no `server-only`, no viem) so it can be
 * imported by the voucher route without dragging the server-only marker into the
 * route's module graph, and unit-tested in isolation.
 */

/**
 * Throws an Error whose message begins with `MARKETPLACE_ADDRESS_DRIFT` when the
 * server on-chain address and the voucher verifyingContract address diverge for
 * the active network. No-op when either var is unset (nothing to compare).
 */
export function assertMarketplaceAddressCoherence(): void {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const serverAddr = process.env.MARKETPLACE_CONTRACT_ADDRESS?.trim()
  const voucherVar = chainId === 43114
    ? 'NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET'
    : 'NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI'
  const voucherAddr = process.env[voucherVar]?.trim()

  // Guard only where BOTH are configured for the active network.
  if (!serverAddr || !voucherAddr) return

  if (serverAddr.toLowerCase() !== voucherAddr.toLowerCase()) {
    throw new Error(
      `MARKETPLACE_ADDRESS_DRIFT: MARKETPLACE_CONTRACT_ADDRESS (${serverAddr}) ` +
      `differs from ${voucherVar} (${voucherAddr}) for chainId ${chainId}. ` +
      `A voucher signed now would carry a verifyingContract that reverts ` +
      `claimEarnings() on-chain. Align both env vars to the deployed contract address.`,
    )
  }
}
