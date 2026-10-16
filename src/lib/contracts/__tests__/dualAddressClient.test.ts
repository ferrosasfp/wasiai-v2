/**
 * WKH-126 — legacy-aware marketplaceClient read/write behavior.
 *
 * Proves:
 *  - AC-2: getKeyBalanceOnChain aggregates PRIMARY + LEGACY only when asked AND
 *    legacy is configured; getKeyBalanceBreakdownOnChain returns the two legs
 *    separately.
 *  - AC-7 / CD-1: with legacy UNSET, every read targets ONLY the primary address
 *    and the returned numbers are identical to single-address behavior.
 *  - AC-4: WRITES (depositForKeyOnChain, settleKeyBatchOnChain) always target the
 *    PRIMARY contract — never the legacy address.
 *  - AC-3: migrateKeyBalanceToPrimary sequences withdraw(legacy, user-signed) →
 *    deposit(primary), defers the deposit while legacy is not drained, and is an
 *    idempotent retry point once drained.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Capture every readContract / simulateContract target address ──────────────
const calls = vi.hoisted(() => ({
  reads:      [] as Array<{ address: string; functionName: string }>,
  writes:     [] as Array<{ address: string; functionName: string }>,
  // readContract is configured per-test to return balances keyed by address.
  balanceByAddress: new Map<string, bigint>(),
}))

const PRIMARY = ('0x' + 'a1'.repeat(20)) as `0x${string}`
const LEGACY  = ('0x' + 'b2'.repeat(20)) as `0x${string}`
const TX_HASH = ('0x' + 'cc'.repeat(32)) as `0x${string}`
// 64-hex key_hash (SHA-256 shape) so keyHashToBytes32 is a no-op pad.
const KEY_HASH = 'de'.repeat(32)

// marketplaceClient imports 'server-only', which throws under the jsdom (client)
// test environment. Stub it so the server module can be exercised in unit tests.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: '0x' + '99'.repeat(20) })),
}))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  const publicClient = {
    readContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      calls.reads.push({ address: address.toLowerCase(), functionName })
      return calls.balanceByAddress.get(address.toLowerCase()) ?? 0n
    }),
    simulateContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      calls.writes.push({ address: address.toLowerCase(), functionName })
      return { request: { address, functionName } }
    }),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' as const })),
    getTransactionReceipt:     vi.fn(async () => ({ status: 'success' as const, logs: [] })),
  }
  return {
    ...actual,
    createPublicClient: vi.fn(() => publicClient),
    createWalletClient: vi.fn(() => ({ writeContract: vi.fn(async () => TX_HASH) })),
    http: vi.fn(() => ({})),
  }
})

const ENV_KEYS = [
  'NEXT_PUBLIC_CHAIN_ID',
  'MARKETPLACE_CONTRACT_ADDRESS',
  'NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI',
  'NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI',
  'OPERATOR_PRIVATE_KEY',
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  calls.reads = []
  calls.writes = []
  calls.balanceByAddress = new Map()
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
  process.env.MARKETPLACE_CONTRACT_ADDRESS = PRIMARY
  process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = PRIMARY
  process.env.OPERATOR_PRIVATE_KEY = '0x' + '11'.repeat(32)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.resetModules()
})

/** Fresh import per test so the operator-client singleton + env are re-read. */
async function load() {
  vi.resetModules()
  return import('../marketplaceClient')
}

describe('WKH-126 getKeyBalanceOnChain — backward-compat (legacy unset)', () => {
  it('reads ONLY the primary address and returns the primary balance', async () => {
    calls.balanceByAddress.set(PRIMARY.toLowerCase(), 5_000_000n) // $5
    const { getKeyBalanceOnChain } = await load()

    const bal = await getKeyBalanceOnChain(KEY_HASH)
    expect(bal).toBe(5)
    expect(calls.reads).toHaveLength(1)
    expect(calls.reads[0].address).toBe(PRIMARY.toLowerCase())
  })

  it('includeLegacy:true is a NO-OP when legacy env is unset (single read)', async () => {
    calls.balanceByAddress.set(PRIMARY.toLowerCase(), 7_000_000n)
    const { getKeyBalanceOnChain } = await load()

    const bal = await getKeyBalanceOnChain(KEY_HASH, { includeLegacy: true })
    expect(bal).toBe(7)
    expect(calls.reads).toHaveLength(1)
    expect(calls.reads.every(r => r.address === PRIMARY.toLowerCase())).toBe(true)
  })

  it('breakdown returns legacy:null and total===primary when legacy unset', async () => {
    calls.balanceByAddress.set(PRIMARY.toLowerCase(), 3_000_000n)
    const { getKeyBalanceBreakdownOnChain } = await load()

    const b = await getKeyBalanceBreakdownOnChain(KEY_HASH)
    expect(b).toEqual({ primary: 3, legacy: null, total: 3 })
    expect(calls.reads).toHaveLength(1)
  })
})

describe('WKH-126 getKeyBalanceOnChain — dual-address (legacy set)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = LEGACY
  })

  it('default (no includeLegacy) still reads ONLY primary', async () => {
    calls.balanceByAddress.set(PRIMARY.toLowerCase(), 4_000_000n)
    calls.balanceByAddress.set(LEGACY.toLowerCase(), 9_000_000n)
    const { getKeyBalanceOnChain } = await load()

    const bal = await getKeyBalanceOnChain(KEY_HASH)
    expect(bal).toBe(4)
    expect(calls.reads).toHaveLength(1)
    expect(calls.reads[0].address).toBe(PRIMARY.toLowerCase())
  })

  it('includeLegacy:true aggregates primary + legacy', async () => {
    calls.balanceByAddress.set(PRIMARY.toLowerCase(), 4_000_000n) // $4
    calls.balanceByAddress.set(LEGACY.toLowerCase(), 6_500_000n)  // $6.50
    const { getKeyBalanceOnChain } = await load()

    const bal = await getKeyBalanceOnChain(KEY_HASH, { includeLegacy: true })
    expect(bal).toBe(10.5)
    const addrs = calls.reads.map(r => r.address)
    expect(addrs).toContain(PRIMARY.toLowerCase())
    expect(addrs).toContain(LEGACY.toLowerCase())
  })

  it('breakdown returns both legs separately', async () => {
    calls.balanceByAddress.set(PRIMARY.toLowerCase(), 1_000_000n)
    calls.balanceByAddress.set(LEGACY.toLowerCase(), 2_000_000n)
    const { getKeyBalanceBreakdownOnChain } = await load()

    const b = await getKeyBalanceBreakdownOnChain(KEY_HASH)
    expect(b).toEqual({ primary: 1, legacy: 2, total: 3 })
  })
})

describe('WKH-126 writes always target PRIMARY (AC-4)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = LEGACY
  })

  it('depositForKeyOnChain simulates against the PRIMARY address, never legacy', async () => {
    const { depositForKeyOnChain } = await load()
    await depositForKeyOnChain({
      keyId: KEY_HASH, ownerAddress: '0x' + '12'.repeat(20), amount: 1,
      validAfter: 0, validBefore: 99_999_999_999, nonce: '0x' + '00'.repeat(32),
      v: 27, r: '0x' + '01'.repeat(32), s: '0x' + '02'.repeat(32),
    })
    expect(calls.writes).toHaveLength(1)
    expect(calls.writes[0]).toEqual({ address: PRIMARY.toLowerCase(), functionName: 'depositForKey' })
  })

  it('settleKeyBatchOnChain simulates against the PRIMARY address, never legacy', async () => {
    const { settleKeyBatchOnChain } = await load()
    await settleKeyBatchOnChain(KEY_HASH, ['slug-a'], [0.02])
    expect(calls.writes).toHaveLength(1)
    expect(calls.writes[0]).toEqual({ address: PRIMARY.toLowerCase(), functionName: 'settleKeyBatch' })
  })
})

describe('WKH-126 migrateKeyBalanceToPrimary (AC-3)', () => {
  const deposit = {
    amount: 10, validAfter: 0, validBefore: 99_999_999_999,
    nonce: '0x' + '00'.repeat(32), v: 27, r: '0x' + '01'.repeat(32), s: '0x' + '02'.repeat(32),
  }

  it('no-legacy-configured → no deposit, never errors (backward-compat)', async () => {
    // legacy env unset
    const { migrateKeyBalanceToPrimary } = await load()
    const res = await migrateKeyBalanceToPrimary({
      keyId: KEY_HASH, ownerAddress: '0x' + '12'.repeat(20), withdrawTxHash: TX_HASH, deposit,
    })
    expect(res.migrated).toBe(false)
    expect(res.reason).toBe('no-legacy-configured')
    expect(calls.writes).toHaveLength(0)
  })

  it('defers the deposit while the legacy balance is NOT yet drained', async () => {
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = LEGACY
    calls.balanceByAddress.set(LEGACY.toLowerCase(), 10_000_000n) // still funded
    const { migrateKeyBalanceToPrimary } = await load()

    const res = await migrateKeyBalanceToPrimary({
      keyId: KEY_HASH, ownerAddress: '0x' + '12'.repeat(20), withdrawTxHash: TX_HASH, deposit,
    })
    expect(res.migrated).toBe(false)
    expect(res.reason).toBe('legacy-not-drained')
    // No deposit attempted → withdraw never re-triggered, no double-spend risk.
    expect(calls.writes).toHaveLength(0)
  })

  it('once legacy is drained, deposits to PRIMARY and reports migrated', async () => {
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = LEGACY
    calls.balanceByAddress.set(LEGACY.toLowerCase(), 0n) // withdraw already happened
    const { migrateKeyBalanceToPrimary } = await load()

    const res = await migrateKeyBalanceToPrimary({
      keyId: KEY_HASH, ownerAddress: '0x' + '12'.repeat(20), withdrawTxHash: TX_HASH, deposit,
    })
    expect(res.migrated).toBe(true)
    expect(res.depositTxHash).toBe(TX_HASH)
    // The single write is the primary deposit (AC-4) — legacy is never written.
    expect(calls.writes).toEqual([{ address: PRIMARY.toLowerCase(), functionName: 'depositForKey' }])
  })

  it('is an idempotent retry point: re-running after drain re-attempts ONLY the deposit', async () => {
    process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_LEGACY_FUJI = LEGACY
    calls.balanceByAddress.set(LEGACY.toLowerCase(), 0n)
    const { migrateKeyBalanceToPrimary } = await load()

    const first = await migrateKeyBalanceToPrimary({
      keyId: KEY_HASH, ownerAddress: '0x' + '12'.repeat(20), withdrawTxHash: TX_HASH, deposit,
    })
    const second = await migrateKeyBalanceToPrimary({
      keyId: KEY_HASH, ownerAddress: '0x' + '12'.repeat(20), withdrawTxHash: TX_HASH, deposit,
    })
    expect(first.migrated).toBe(true)
    expect(second.migrated).toBe(true)
    // Both attempts only ever wrote depositForKey on PRIMARY — the withdraw step
    // is owned by the user, so a retry can never re-issue a withdraw.
    expect(calls.writes.every(w => w.address === PRIMARY.toLowerCase() && w.functionName === 'depositForKey')).toBe(true)
    expect(calls.writes).toHaveLength(2)
  })
})
