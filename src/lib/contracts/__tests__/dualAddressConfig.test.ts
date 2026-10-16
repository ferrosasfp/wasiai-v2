/**
 * WKH-126 — dual-address config resolution (AC-1, AC-7 backward-compat).
 *
 * Proves:
 *  - legacy UNSET → getMarketplaceAddresses() returns { primary } only and
 *    getContractAddress() is byte-identical to the historical single-address
 *    accessor (CD-1 / AC-7).
 *  - legacy SET   → returns { primary, legacy } for the matching network.
 *  - per-chain resolution (Fuji 43113 vs mainnet 43114) reads the correct envs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getMarketplaceAddresses, getContractAddress } from '../config'

const PRIMARY_FUJI    = '0x' + '11'.repeat(20)
const LEGACY_FUJI     = '0x' + '22'.repeat(20)
const PRIMARY_MAINNET = '0x' + '33'.repeat(20)
const LEGACY_MAINNET  = '0x' + '44'.repeat(20)

const ENV_KEYS = [
  'NEXT_PUBLIC_CHAIN_ID',
  'NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI',
  'NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET',
  'NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI',
  'NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_MAINNET',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('WKH-126 getMarketplaceAddresses — backward-compat (legacy unset)', () => {
  it('Fuji: returns { primary } with NO legacy key when legacy env is unset', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY_FUJI

    const res = getMarketplaceAddresses()
    expect(res.primary).toBe(PRIMARY_FUJI)
    expect(res.legacy).toBeUndefined()
    expect('legacy' in res).toBe(false)
  })

  it('getContractAddress() equals the historical `addr ?? "0x"` resolution', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY_FUJI
    expect(getContractAddress()).toBe(PRIMARY_FUJI)
  })

  it('getContractAddress() falls back to "0x" sentinel when primary unset (unchanged)', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    expect(getContractAddress()).toBe('0x')
    const res = getMarketplaceAddresses()
    expect(res.primary).toBe('0x')
    expect(res.legacy).toBeUndefined()
  })

  it('treats a zero-address legacy env as UNSET (no legacy key)', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY_FUJI
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = '0x' + '00'.repeat(20)
    const res = getMarketplaceAddresses()
    expect(res.legacy).toBeUndefined()
  })

  it('treats an empty-string legacy env as UNSET', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY_FUJI
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = '   '
    expect(getMarketplaceAddresses().legacy).toBeUndefined()
  })
})

describe('WKH-126 getMarketplaceAddresses — dual-address (legacy set)', () => {
  it('Fuji: returns { primary, legacy } when both envs are set', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY_FUJI
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = LEGACY_FUJI

    const res = getMarketplaceAddresses()
    expect(res.primary).toBe(PRIMARY_FUJI)
    expect(res.legacy).toBe(LEGACY_FUJI)
  })

  it('mainnet: resolves the *_MAINNET primary and legacy envs', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43114'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET = PRIMARY_MAINNET
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_MAINNET = LEGACY_MAINNET

    const res = getMarketplaceAddresses(43114)
    expect(res.primary).toBe(PRIMARY_MAINNET)
    expect(res.legacy).toBe(LEGACY_MAINNET)
  })

  it('does NOT cross networks: mainnet legacy is ignored on Fuji', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY_FUJI
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_MAINNET = LEGACY_MAINNET // wrong net

    const res = getMarketplaceAddresses(43113)
    expect(res.legacy).toBeUndefined()
  })

  it('explicit chainId arg overrides NEXT_PUBLIC_CHAIN_ID', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET = PRIMARY_MAINNET
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_MAINNET = LEGACY_MAINNET
    const res = getMarketplaceAddresses(43114)
    expect(res.primary).toBe(PRIMARY_MAINNET)
    expect(res.legacy).toBe(LEGACY_MAINNET)
  })
})
