/**
 * Pure client-safe contract utilities.
 * No server-only dependencies (no process.env secrets, no operator PK).
 */

/**
 * Convert a SHA-256 key_hash (hex string) to a bytes32 value for on-chain calls.
 */
export function keyHashToBytes32(keyHash: string): `0x${string}` {
  const hex    = keyHash.replace(/^0x/i, '').toLowerCase()
  const padded = hex.padEnd(64, '0').slice(0, 64)
  return `0x${padded}`
}
