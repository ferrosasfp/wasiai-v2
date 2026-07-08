/**
 * WKH-162 — Unit tests for assertMarketplaceAddressCoherence().
 *
 * Guards against config-drift between the two env-var families that resolve the
 * marketplace contract address:
 *   - MARKETPLACE_CONTRACT_ADDRESS          → server on-chain path
 *   - NEXT_PUBLIC_MARKETPLACE_ADDRESS_<net> → EIP-712 voucher verifyingContract
 *
 * The helper is a standalone pure module (no `server-only`, no viem), imported
 * dynamically after each env setup so vi.resetModules() gives a clean read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fuji v1.3 deployed contract (checksummed) — the real value both env vars hold today.
const FUJI_CHECKSUM = '0x3583fb96bAB5DbBDd85CCeA1C4fCE3EfF3249F08'
const FUJI_LOWER    = FUJI_CHECKSUM.toLowerCase()
const OTHER_ADDR    = '0x9316E902760f2c37CDA57c8Be01358D890a26276' // a genuinely different address

const ORIGINAL_ENV = { ...process.env }

async function loadAssert() {
  const mod = await import('@/lib/contracts/marketplaceAddressCoherence')
  return mod.assertMarketplaceAddressCoherence
}

describe('assertMarketplaceAddressCoherence — WKH-162', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.NEXT_PUBLIC_CHAIN_ID
    delete process.env.MARKETPLACE_CONTRACT_ADDRESS
    delete process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI
    delete process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('AC-2/AC-5: coherent (byte-identical) → does not throw', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.MARKETPLACE_CONTRACT_ADDRESS = FUJI_CHECKSUM
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = FUJI_CHECKSUM
    const assert = await loadAssert()
    expect(() => assert()).not.toThrow()
  })

  it('AC-5: coherent but different checksum casing → does not throw (checksum diff is not drift)', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.MARKETPLACE_CONTRACT_ADDRESS = FUJI_CHECKSUM
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = FUJI_LOWER
    const assert = await loadAssert()
    expect(() => assert()).not.toThrow()
  })

  it('AC-1/AC-3: drift on Fuji → throws MARKETPLACE_ADDRESS_DRIFT naming the FUJI var and both values', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.MARKETPLACE_CONTRACT_ADDRESS = FUJI_CHECKSUM
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = OTHER_ADDR
    const assert = await loadAssert()
    let caught: Error | undefined
    try { assert() } catch (e) { caught = e as Error }
    expect(caught).toBeInstanceOf(Error)
    expect(caught!.message).toContain('MARKETPLACE_ADDRESS_DRIFT')
    expect(caught!.message).toContain('NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI')
    expect(caught!.message).toContain(FUJI_CHECKSUM)
    expect(caught!.message).toContain(OTHER_ADDR)
  })

  it('AC-1/AC-3: drift on Mainnet → throws MARKETPLACE_ADDRESS_DRIFT naming the MAINNET var', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43114'
    process.env.MARKETPLACE_CONTRACT_ADDRESS = OTHER_ADDR
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET = FUJI_CHECKSUM
    const assert = await loadAssert()
    expect(() => assert()).toThrow(/MARKETPLACE_ADDRESS_DRIFT/)
    try { assert() } catch (e) {
      expect((e as Error).message).toContain('NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET')
    }
  })

  it('defaults to Fuji (43113) when NEXT_PUBLIC_CHAIN_ID unset → uses the FUJI var', async () => {
    process.env.MARKETPLACE_CONTRACT_ADDRESS = FUJI_CHECKSUM
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = OTHER_ADDR
    const assert = await loadAssert()
    expect(() => assert()).toThrow(/NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI/)
  })

  it('skip: server var unset → does not throw (no address to compare)', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = FUJI_CHECKSUM
    const assert = await loadAssert()
    expect(() => assert()).not.toThrow()
  })

  it('skip: voucher NEXT_PUBLIC var unset for active net → does not throw (no voucher path to protect)', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.MARKETPLACE_CONTRACT_ADDRESS = FUJI_CHECKSUM
    const assert = await loadAssert()
    expect(() => assert()).not.toThrow()
  })
})
