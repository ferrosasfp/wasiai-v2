/**
 * C-3 (audit 2026-06-30): config-coherence guard.
 *
 * The voucher / on-chain write path signs EIP-712 against the contract at
 * MARKETPLACE_CONTRACT_ADDRESS, while the client-facing voucher domain and the
 * on-chain target are published via NEXT_PUBLIC_MARKETPLACE_ADDRESS_<network>.
 * If these diverge, vouchers are signed for a domain that does not match the
 * contract they settle against — this exact mismatch was found live.
 *
 * This test fails LOUDLY when the server-side contract address and the
 * network-matched public address are both configured but differ.
 */
import { describe, it, expect } from 'vitest'

function publicAddressForChain(chainId: number): string | undefined {
  return chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI
}

describe('C-3: marketplace address config coherence', () => {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const server  = process.env.MARKETPLACE_CONTRACT_ADDRESS?.trim().toLowerCase()
  const pub     = publicAddressForChain(chainId)?.trim().toLowerCase()

  it('MARKETPLACE_CONTRACT_ADDRESS equals NEXT_PUBLIC_MARKETPLACE_ADDRESS_<network> when both are set', () => {
    if (!server || !pub) {
      // Not configured in this environment (e.g. CI without secrets) — nothing
      // to compare. The live-env guard below covers the deployed case.
      expect(true).toBe(true)
      return
    }
    expect(server).toBe(pub)
  })

  it('when MARKETPLACE_CONTRACT_ADDRESS is set, the network-matched public address must also be set and equal', () => {
    if (!server) {
      expect(true).toBe(true)
      return
    }
    expect(pub, `NEXT_PUBLIC_MARKETPLACE_ADDRESS for chain ${chainId} is unset while MARKETPLACE_CONTRACT_ADDRESS is set`).toBeDefined()
    expect(server).toBe(pub)
  })
})
