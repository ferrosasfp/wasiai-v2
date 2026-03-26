/**
 * Tests para WAS-297 — calcPlatformOverhead y getCachedGasOverhead
 * Verifica el campo gas_source y el comportamiento de cada fuente de datos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── vi.hoisted — mocks que deben inicializarse antes de los imports ──────────
const { mockRedisGet, mockRedisSet, mockGetGasPrice, mockChainlinkFeed } = vi.hoisted(() => ({
  mockRedisGet:       vi.fn(),
  mockRedisSet:       vi.fn(),
  mockGetGasPrice:    vi.fn(),
  mockChainlinkFeed:  vi.fn(),
}))

vi.mock('@/lib/ratelimit', () => ({
  getSharedRedis: vi.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
  })),
}))

vi.mock('@/shared/lib/web3/client', () => ({
  getPublicClient: vi.fn(() => ({
    getGasPrice: mockGetGasPrice,
  })),
}))

vi.mock('@/lib/defi-risk/chainlink', () => ({
  readChainlinkFeed: mockChainlinkFeed,
}))

// ── Import bajo test ──────────────────────────────────────────────────────────
import { calcPlatformOverhead, getCachedGasOverhead } from '@/lib/pricing/overhead'

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  // Default: gasPrice on-chain
  mockGetGasPrice.mockResolvedValue(BigInt(25_000_000_000))  // 25 gwei
})

// ── calcPlatformOverhead ──────────────────────────────────────────────────────
describe('calcPlatformOverhead', () => {

  it('Redis hit → gas_source: redis, cached: true', async () => {
    mockRedisGet.mockResolvedValueOnce(0.02)

    const result = await calcPlatformOverhead(0.01)

    expect(result.gas_source).toBe('redis')
    expect(result.cached).toBe(true)
    expect(result.overhead).toBe(0.02)
  })

  it('Chainlink success → gas_source: chainlink', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockChainlinkFeed.mockResolvedValueOnce({ price_usd: 25 })
    mockRedisSet.mockResolvedValueOnce('OK')
    // Force CHAINLINK_AVAX_USD_FEED env
    process.env.CHAINLINK_AVAX_USD_FEED = '0xdeadbeef'

    const result = await calcPlatformOverhead(0.01)

    expect(result.gas_source).toBe('chainlink')
    expect(result.cached).toBe(false)
    expect(result.overhead).toBeGreaterThanOrEqual(0)
  })

  it('Chainlink fails, CoinGecko success → gas_source: coingecko', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockChainlinkFeed.mockRejectedValueOnce(new Error('chainlink unavailable'))
    mockRedisSet.mockResolvedValueOnce('OK')
    process.env.CHAINLINK_AVAX_USD_FEED = '0xdeadbeef'
    delete process.env.AVAX_USD_FALLBACK

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'avalanche-2': { usd: 25 } }),
    }) as unknown as typeof fetch

    const result = await calcPlatformOverhead(0.01)

    expect(result.gas_source).toBe('coingecko')
    expect(result.cached).toBe(false)
    expect(result.overhead).toBeGreaterThanOrEqual(0)
  })

  it('All sources fail → gas_source: none, overhead: 0 (fail-open)', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('redis down'))
    mockChainlinkFeed.mockRejectedValueOnce(new Error('chainlink down'))
    process.env.CHAINLINK_AVAX_USD_FEED = '0xdeadbeef'
    delete process.env.AVAX_USD_FALLBACK

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('network error')) as unknown as typeof fetch

    const result = await calcPlatformOverhead(0.01)

    expect(result.gas_source).toBe('none')
    expect(result.overhead).toBe(0)
    expect(result.circuitBreaker).toBe(false)
  })

  it('circuitBreaker: true when gas > creatorPrice', async () => {
    mockRedisGet.mockResolvedValueOnce(0.05)  // gas = 0.05

    const result = await calcPlatformOverhead(0.001)  // creatorPrice = 0.001

    expect(result.circuitBreaker).toBe(true)
  })

  it('circuitBreaker: false when gas <= creatorPrice', async () => {
    mockRedisGet.mockResolvedValueOnce(0.001)  // gas = 0.001

    const result = await calcPlatformOverhead(0.05)  // creatorPrice = 0.05

    expect(result.circuitBreaker).toBe(false)
  })
})

// ── getCachedGasOverhead ──────────────────────────────────────────────────────
describe('getCachedGasOverhead', () => {

  it('Redis hit → retorna { overhead, gas_source: redis }', async () => {
    mockRedisGet.mockResolvedValueOnce(0.03)

    const result = await getCachedGasOverhead()

    expect(result).not.toBeNull()
    expect(result?.overhead).toBe(0.03)
    expect(result?.gas_source).toBe('redis')
  })

  it('Redis miss → retorna null', async () => {
    mockRedisGet.mockResolvedValueOnce(null)

    const result = await getCachedGasOverhead()

    expect(result).toBeNull()
  })

  it('Redis throws → retorna null', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('redis down'))

    const result = await getCachedGasOverhead()

    expect(result).toBeNull()
  })
})
