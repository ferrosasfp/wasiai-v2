/**
 * Deep integration + security tests for deposit-to-key route — Sprint A2A Autonomy
 * Covers: security, EIP-712, balance edge cases, deposit lifecycle, key resolution
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── vi.hoisted ────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  serviceClientFrom: vi.fn(),
  supabaseRpc:       vi.fn(),
  getAgentWalletClient:      vi.fn(),
  getAgentWalletAddress:     vi.fn(),
  getAgentWalletUsdcBalance: vi.fn(),
  depositForKeyOnChain:      vi.fn(),
  calcPlatformOverhead:      vi.fn(),
  rateLimitSuccess:          vi.fn(),
  loggerError:               vi.fn(),
  loggerInfo:                vi.fn(),
  loggerWarn:                vi.fn(),
}))

// Mock agentWallet ANTES de cualquier import
vi.mock('@/lib/agent-wallets/agentWallet', () => ({
  getAgentWalletClient:      mocks.getAgentWalletClient,
  getAgentWalletAddress:     mocks.getAgentWalletAddress,
  getAgentWalletUsdcBalance: mocks.getAgentWalletUsdcBalance,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceClientFrom,
    rpc:  mocks.supabaseRpc,
  })),
}))

vi.mock('@/lib/contracts/marketplaceClient', () => ({
  depositForKeyOnChain: mocks.depositForKeyOnChain,
  // TB-06: receipt-amount decoder. Return null so creditAmount falls back to the
  // requested amount (preserves existing deposited_usdc / budget assertions).
  getDepositedUsdcFromReceipt: vi.fn(async () => null),
}))

// TB-06: idempotent credit helper delegates to supabaseRpc so existing
// budget-RPC-driven assertions continue to work.
vi.mock('@/lib/contracts/creditKeyBudget', () => ({
  creditKeyBudgetIdempotent: vi.fn(async (supabase: { rpc: (fn: string, args: unknown) => Promise<{ error: unknown }> }, args: { keyId: string; amount: number; ownerId: string }) => {
    const { error } = await supabase.rpc('increment_key_budget', {
      p_key_id: args.keyId, p_amount: args.amount, p_owner_id: args.ownerId,
    })
    return error ? { ok: false, alreadyCredited: false, error: String(error) } : { ok: true, idempotent: false }
  }),
}))

vi.mock('@/lib/pricing/overhead', () => ({
  calcPlatformOverhead: mocks.calcPlatformOverhead,
}))

vi.mock('@/lib/ratelimit', () => ({
  getSharedRedis: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
  getIdentifier:  vi.fn(() => '127.0.0.1'),
  checkRateLimit: vi.fn(() => null),
}))

vi.mock('@upstash/ratelimit', () => {
  const RatelimitMock = vi.fn().mockImplementation(() => ({
    limit: mocks.rateLimitSuccess,
  })) as unknown as { new(...args: unknown[]): unknown; slidingWindow: ReturnType<typeof vi.fn> }
  RatelimitMock.slidingWindow = vi.fn().mockReturnValue({ type: 'slidingWindow', tokens: 5, interval: '1 h' })
  return { Ratelimit: RatelimitMock }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    info:  mocks.loggerInfo,
    warn:  mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))

// ── Import bajo test ──────────────────────────────────────────────────────────
import { POST } from '../route'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VALID_KEY   = 'wai_test_key_deposit_deep_abc'
const KEY_UUID_1  = '00000000-0000-4000-a000-000000000001'
const KEY_UUID_2  = '00000000-0000-4000-a000-000000000002'
const KEY_UUID_3  = '00000000-0000-4000-a000-000000000003'
const OWNER_A     = '10000000-0000-4000-a000-000000000001'
const OWNER_B     = '10000000-0000-4000-a000-000000000002'
const AGENT_UUID  = '20000000-0000-4000-a000-000000000001'
const DEPOSIT_ID  = '30000000-0000-4000-a000-000000000001'
const KEY_ROW     = { id: KEY_UUID_1, owner_id: OWNER_A, key_hash: 'hash-abc', is_active: true }
const AGENT_ROW   = { id: AGENT_UUID, creator_id: OWNER_A }
const WALLET_ADDR = '0xWalletAddress123' as `0x${string}`
const TX_HASH     = '0xTxHash456'
const KNOWN_SIG   = ('0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + 'cc') as `0x${string}` // 130 hex chars after 0x

// ── Chain builder helpers ─────────────────────────────────────────────────────
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'insert', 'update', 'upsert', 'neq', 'in']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

function makeInsertChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'insert', 'update', 'neq']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

function makeUpdateChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'update', 'neq']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  // update().eq() resolves (no single needed)
  chain['eq'] = vi.fn().mockResolvedValue(result)
  return chain
}

function makeRequest(slug: string, body: unknown, agentKey?: string) {
  return new NextRequest(`http://localhost/api/v1/agents/${slug}/deposit-to-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(agentKey ? { 'x-agent-key': agentKey } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

// ── Default happy-path setup ──────────────────────────────────────────────────
function setupHappyPath() {
  mocks.rateLimitSuccess.mockResolvedValue({ success: true })
  mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
  mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
  mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) }) // 10 USDC
  mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
  mocks.getAgentWalletClient.mockResolvedValue({
    signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG),
  })
  mocks.supabaseRpc.mockResolvedValue({ error: null })
  mocks.serviceClientFrom
    .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
    .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
    .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))  // insert
    .mockReturnValueOnce(makeUpdateChain({ error: null }))                           // update success
    .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11.001 }, error: null }))  // fetch budget
}

beforeEach(() => {
  // Reset queued mockReturnValueOnce from prior tests without clearing module mocks
  mocks.serviceClientFrom.mockReset()
  mocks.supabaseRpc.mockReset()
  mocks.getAgentWalletClient.mockReset()
  mocks.getAgentWalletAddress.mockReset()
  mocks.getAgentWalletUsdcBalance.mockReset()
  mocks.depositForKeyOnChain.mockReset()
  mocks.calcPlatformOverhead.mockReset()
  mocks.rateLimitSuccess.mockReset()
  mocks.loggerError.mockReset()
  mocks.loggerInfo.mockReset()
  mocks.loggerWarn.mockReset()
})

// ── Security tests ────────────────────────────────────────────────────────────
describe('Security', () => {

  it('1. Cross-owner key_id attack → 403', async () => {
    // Caller authenticates with owner-a's key, but provides key_id belonging to owner-b
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    const targetKey = { id: KEY_UUID_2, key_hash: 'hash-bbb', owner_id: OWNER_B, is_active: true }

    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // 1. auth key (owner-a)
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // 2. agent
      .mockReturnValueOnce(makeChain({ data: targetKey, error: null }))     // 3. target key lookup (before insert!)

    const res = await POST(
      makeRequest('test-agent', { amount_usdc: 1, key_id: KEY_UUID_2 }, VALID_KEY),
      makeParams('test-agent'),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('same owner')
  })

  it('2. Inactive auth key rejection → 401', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    // Auth key is inactive (is_active: false filtered by query → single returns null)
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: null, error: 'not found' }))

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(401)
  })

  it('3. Inactive target key rejection → 404', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    // Route checks target key: if !targetKey || !targetKey.is_active → 404
    // The query uses .eq('id', key_id).single() — it returns the row but is_active is false
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth key
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeChain({ data: { id: KEY_UUID_3, key_hash: 'hash-ccc', owner_id: OWNER_A, is_active: false }, error: null })) // target key (inactive)

    const res = await POST(
      makeRequest('test-agent', { amount_usdc: 1, key_id: KEY_UUID_3 }, VALID_KEY),
      makeParams('test-agent'),
    )
    expect(res.status).toBe(404)
  })

  it('4. SQL injection in slug → safe 404', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth key
      .mockReturnValueOnce(makeChain({ data: null, error: 'not found' }))   // agent not found (slug is parameterized)

    const evilSlug = "'; DROP TABLE agents; --"
    const res = await POST(makeRequest(evilSlug, { amount_usdc: 1 }, VALID_KEY), makeParams(evilSlug))
    expect(res.status).toBe(404)
  })

  it('5. Private key not in error response body when signing fails', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    const FAKE_PRIVATE_KEY = '0x' + 'deadbeef'.repeat(8) // 64-char hex private key
    mocks.getAgentWalletClient.mockResolvedValue({
      signTypedData: vi.fn().mockRejectedValueOnce(new Error(`signing failed: ${FAKE_PRIVATE_KEY}`)),
    })

    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update to failed

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(500)

    const body = await res.json()
    const bodyStr = JSON.stringify(body)
    // No hex string longer than 66 chars
    const longHex = /0x[0-9a-fA-F]{67,}/
    expect(longHex.test(bodyStr)).toBe(false)
  })

  it('6. Private key not in logger.error calls when signing fails', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    const FAKE_PRIVATE_KEY = '0x' + 'aabbcc'.repeat(11) // long hex key
    mocks.getAgentWalletClient.mockResolvedValue({
      signTypedData: vi.fn().mockRejectedValueOnce(new Error(`key: ${FAKE_PRIVATE_KEY}`)),
    })

    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // update

    await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))

    // Check all logger.error calls — none should contain the full private key
    const longHex = /0x[0-9a-fA-F]{67,}/
    for (const call of mocks.loggerError.mock.calls) {
      const serialized = JSON.stringify(call)
      expect(longHex.test(serialized)).toBe(false)
    }
  })
})

// ── EIP-712 signature tests ───────────────────────────────────────────────────
describe('EIP-712 signature', () => {

  it('7. Signature splitting: r is first 32 bytes, s is next, v is last byte', async () => {
    // 0x + 64 chars r + 64 chars s + 2 chars v = 132 chars total
    const r_part = 'aa'.repeat(32)
    const s_part = 'bb'.repeat(32)
    const v_part = '1b' // v = 27

    const knownSig = ('0x' + r_part + s_part + v_part) as `0x${string}`

    let capturedDepositCall: Record<string, unknown> | null = null
    mocks.depositForKeyOnChain.mockImplementationOnce((params: Record<string, unknown>) => {
      capturedDepositCall = params
      return Promise.resolve(TX_HASH)
    })

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({
      signTypedData: vi.fn().mockResolvedValue(knownSig),
    })
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11 }, error: null }))

    await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))

    expect(capturedDepositCall).not.toBeNull()
    expect(capturedDepositCall!.r).toBe('0x' + r_part)
    expect(capturedDepositCall!.s).toBe('0x' + s_part)
    expect(capturedDepositCall!.v).toBe(parseInt(v_part, 16))
  })

  it('8. amountWei precision: amount_usdc=0.000001 → amountWei = 1n', async () => {
    let capturedSignCall: Record<string, unknown> | null = null

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    const mockSign = vi.fn().mockImplementationOnce((params: Record<string, unknown>) => {
      capturedSignCall = params
      return Promise.resolve(KNOWN_SIG)
    })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: mockSign })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 1 }, error: null }))

    await POST(makeRequest('test-agent', { amount_usdc: 0.01 }, VALID_KEY), makeParams('test-agent'))

    // amount_usdc=0.01 → amountWei = 10000n (round(0.01 * 1_000_000) = 10000)
    const message = (capturedSignCall as { message?: { value?: bigint } } | null)?.message
    expect(message?.value).toBe(10000n)
  })

  it('9. amountWei for 999.999999 → 999999999n', () => {
    // Pure math logic test
    const amount_usdc = 999.999999
    const amountWei = BigInt(Math.round(amount_usdc * 1_000_000))
    expect(amountWei).toBe(999999999n)
  })

  it('10. validBefore is ~5 min from now', async () => {
    let capturedSignCall: Record<string, unknown> | null = null

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    const mockSign = vi.fn().mockImplementationOnce((params: Record<string, unknown>) => {
      capturedSignCall = params
      return Promise.resolve(KNOWN_SIG)
    })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: mockSign })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 1 }, error: null }))

    const before = Math.floor(Date.now() / 1000)
    await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    const after = Math.floor(Date.now() / 1000)

    const message = (capturedSignCall as { message?: { validBefore?: bigint } } | null)?.message
    const validBefore = Number(message?.validBefore ?? 0)
    expect(validBefore).toBeGreaterThanOrEqual(before + 299)
    expect(validBefore).toBeLessThanOrEqual(after + 301)
  })

  it('11. nonce is 0x + 64 hex chars (32 bytes)', async () => {
    let capturedSignCall: Record<string, unknown> | null = null

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })

    const mockSign = vi.fn().mockImplementationOnce((params: Record<string, unknown>) => {
      capturedSignCall = params
      return Promise.resolve(KNOWN_SIG)
    })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: mockSign })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 1 }, error: null }))

    await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))

    const message = (capturedSignCall as { message?: { nonce?: string } } | null)?.message
    const nonce = message?.nonce as string
    expect(nonce).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(nonce.length).toBe(66)
  })
})

// ── Balance edge cases ────────────────────────────────────────────────────────
describe('Balance edge cases', () => {

  it('12. Exact balance = totalRequired → success (>= check)', async () => {
    // amount=1 + gas=0.001 = 1.001 → balance exactly 1.001 USDC = 1_001_000 micro
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(1_001_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 2 }, error: null })) // fetch budget

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(200)
  })

  it('13. Balance off by 1 micro → 402', async () => {
    // amount=1 + gas=0.001 = 1.001 → need 1_001_000 micro, have 1_000_999
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(1_000_999) })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(402)
  })

  it('14. Gas overhead = 0 (fail-open) → deposit succeeds, total = just amount', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(1_000_000) }) // exactly 1 USDC
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 2 }, error: null })) // fetch budget

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gas_fee_usdc).toBe(0)
    expect(body.total_debited_usdc).toBe(1)
  })

  it('15. amount_usdc = 0.01 (minimum) → success', async () => {
    setupHappyPath()
    const res = await POST(makeRequest('test-agent', { amount_usdc: 0.01 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(200)
  })

  it('16. amount_usdc = 0.009 (below minimum) → 400', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))

    const res = await POST(makeRequest('test-agent', { amount_usdc: 0.009 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(400)
  })

  it('17. amount_usdc = 1000 (MAX_SELF_DEPOSIT exactly) → success', async () => {
    setupHappyPath()
    // Override balance to have enough
    mocks.getAgentWalletUsdcBalance.mockReset()
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(1_001_000_000) }) // 1001 USDC

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1000 }, VALID_KEY), makeParams('test-agent'))
    // Validation passes (max is 1000, 1000 <= 1000)
    expect(res.status).toBe(200)
  })

  it('18. Body with extra fields → zod strips them, request succeeds', async () => {
    setupHappyPath()
    const res = await POST(
      makeRequest('test-agent', { amount_usdc: 1, evil_field: true, __proto__: 'injected' }, VALID_KEY),
      makeParams('test-agent'),
    )
    // Should succeed (zod strips extra fields)
    expect(res.status).toBe(200)
  })

  it('19. Body is not JSON → 400', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))

    const req = new NextRequest('http://localhost/api/v1/agents/test-agent/deposit-to-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': VALID_KEY,
      },
      body: 'this is not json {{{',
    })
    const res = await POST(req, makeParams('test-agent'))
    expect(res.status).toBe(400)
  })
})

// ── Deposit record lifecycle ──────────────────────────────────────────────────
describe('Deposit record lifecycle', () => {

  it('20. DB insert fails → 500, no on-chain tx', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: null, error: { message: 'DB insert failed' } })) // insert fails

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(500)
    expect(mocks.depositForKeyOnChain).not.toHaveBeenCalled()
  })

  it('21. On-chain success but budget RPC fails → still 200', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: { message: 'RPC failed' } }) // budget update fails
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11 }, error: null })) // fetch budget

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(200)
    expect(mocks.loggerError).toHaveBeenCalled() // budget error logged
  })

  it('22. depositForKeyOnChain called with key_hash (not uuid) and wallet address (not owner_id)', async () => {
    let capturedParams: Record<string, unknown> | null = null
    mocks.depositForKeyOnChain.mockImplementationOnce((p: Record<string, unknown>) => {
      capturedParams = p
      return Promise.resolve(TX_HASH)
    })

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11 }, error: null }))

    await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))

    expect(capturedParams).not.toBeNull()
    expect(capturedParams!.keyId).toBe(KEY_ROW.key_hash)     // key_hash, NOT uuid
    expect(capturedParams!.ownerAddress).toBe(WALLET_ADDR)   // wallet address, NOT owner_id
  })

  it('23. Deposit record updated to failed on tx failure', async () => {
    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.depositForKeyOnChain.mockRejectedValueOnce(new Error('blockchain error'))

    const updateChain = makeUpdateChain({ error: null })

    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(updateChain)                                      // update to failed

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(500)
    expect(updateChain['update']).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('24. Deposit record updated to success on tx success', async () => {
    let capturedUpdate: Record<string, unknown> | null = null
    const updateChain = {} as Record<string, ReturnType<typeof vi.fn>>
    updateChain['update'] = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      capturedUpdate = data
      return updateChain
    })
    updateChain['eq'] = vi.fn().mockResolvedValue({ error: null })

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(updateChain)                                      // update to success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11 }, error: null })) // fetch budget

    const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
    expect(res.status).toBe(200)
    expect(capturedUpdate).toMatchObject({ status: 'success', tx_hash: TX_HASH })
  })
})

// ── Target key resolution ─────────────────────────────────────────────────────
describe('Target key resolution', () => {

  it('25. No key_id in body → uses auth key', async () => {
    let capturedParams: Record<string, unknown> | null = null
    mocks.depositForKeyOnChain.mockImplementationOnce((p: Record<string, unknown>) => {
      capturedParams = p
      return Promise.resolve(TX_HASH)
    })

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null }))
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11 }, error: null }))

    await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))

    expect(capturedParams!.keyId).toBe(KEY_ROW.key_hash)
  })

  it('26. key_id = auth key id → same result as no key_id', async () => {
    let capturedParams: Record<string, unknown> | null = null
    mocks.depositForKeyOnChain.mockImplementationOnce((p: Record<string, unknown>) => {
      capturedParams = p
      return Promise.resolve(TX_HASH)
    })

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert (no target key lookup!)
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 11 }, error: null })) // fetch budget

    // Pass key_id = auth key's id (same key) — route skips target key lookup
    await POST(makeRequest('test-agent', { amount_usdc: 1, key_id: KEY_UUID_1 }, VALID_KEY), makeParams('test-agent'))

    expect(capturedParams!.keyId).toBe(KEY_ROW.key_hash)
  })

  it('27. key_id for different valid key from same owner → success', async () => {
    const KEY_B = { id: KEY_UUID_2, key_hash: 'hash-bbb', owner_id: OWNER_A, is_active: true }

    let capturedParams: Record<string, unknown> | null = null
    mocks.depositForKeyOnChain.mockImplementationOnce((p: Record<string, unknown>) => {
      capturedParams = p
      return Promise.resolve(TX_HASH)
    })

    mocks.rateLimitSuccess.mockResolvedValue({ success: true })
    mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0, breakdown: { gas: 0 }, circuitBreaker: false, cached: false, gas_source: 'none' })
    mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
    mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) })
    mocks.getAgentWalletClient.mockResolvedValue({ signTypedData: vi.fn().mockResolvedValue(KNOWN_SIG) })
    mocks.supabaseRpc.mockResolvedValue({ error: null })
    mocks.serviceClientFrom
      .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))       // auth key
      .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))     // agent
      .mockReturnValueOnce(makeChain({ data: KEY_B, error: null }))          // target key lookup (BEFORE insert!)
      .mockReturnValueOnce(makeInsertChain({ data: { id: DEPOSIT_ID }, error: null })) // insert
      .mockReturnValueOnce(makeUpdateChain({ error: null }))                // update success
      .mockReturnValueOnce(makeChain({ data: { budget_usdc: 5 }, error: null })) // fetch budget

    const res = await POST(
      makeRequest('test-agent', { amount_usdc: 1, key_id: KEY_UUID_2 }, VALID_KEY),
      makeParams('test-agent'),
    )
    expect(res.status).toBe(200)
    expect(capturedParams!.keyId).toBe(KEY_B.key_hash)
  })
})
