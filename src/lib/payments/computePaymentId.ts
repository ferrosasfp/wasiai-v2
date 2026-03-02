import { keccak256, encodePacked } from 'viem'

/**
 * Compute the canonical paymentId for an invocation.
 * Must match the on-chain WasiAIMarketplace.computePaymentId() function:
 *   keccak256(abi.encodePacked(slug, payer, amount, nonce, chainId))
 *
 * @param slug     Agent slug string
 * @param payer    Payer wallet address (0x...)
 * @param amount   USDC amount in atomic units (6 decimals)
 * @param nonce    Random bytes32 generated per invocation
 */
export function computePaymentId(
  slug: string,
  payer: `0x${string}`,
  amount: bigint,
  nonce: `0x${string}`
): `0x${string}` {
  const chainId = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? '43113')
  return keccak256(
    encodePacked(
      ['string', 'address', 'uint256', 'bytes32', 'uint256'],
      [slug, payer, amount, nonce, chainId]
    )
  )
}

/**
 * Generate a cryptographically random bytes32 nonce.
 */
export function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}
