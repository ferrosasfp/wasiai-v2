import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  encodeEventTopics,
  encodeAbiParameters,
} from 'viem'

// ---------------------------------------------------------------------------
// vi.hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  validateCsrf: vi.fn(),
  checkRateLimit: vi.fn(),
  getIdentifier: vi.fn(),
  getRegisterLimit: vi.fn(),
  serviceFrom: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { getUser: mocks.getUser } }),
  ),
  createServiceClient: vi.fn(() => ({ from: mocks.serviceFrom })),
}))

vi.mock('@/lib/security/csrf', () => ({
  validateCsrf: mocks.validateCsrf,
}))

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getIdentifier: mocks.getIdentifier,
  getRegisterLimit: mocks.getRegisterLimit,
}))

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({ success: true, limit: 5, reset: Date.now() + 60000 }),
    })),
    { slidingWindow: vi.fn().mockReturnValue('mock-sliding-window') },
  ),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    })),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TX = '0x' + 'a'.repeat(64)
const CONTRACT = '0x1234567890abcdef1234567890abcdef12345678'
const SLUG = 'my-agent'
const USER_ID = 'user-123'
const CREATOR_ADDR = '0x' + '11'.repeat(20)

const EVENT_ABI = [
  {
    name: 'AgentRegistered' as const,
    type: 'event' as const,
    inputs: [
      { name: 'slug', type: 'string' as const, indexed: true },
      { name: 'creator', type: 'address' as const, indexed: true },
      { name: 'pricePerCall', type: 'uint256' as const, indexed: false },
      { name: 'erc8004Id', type: 'uint64' as const, indexed: false },
    ],
  },
]

function makeLog(slug: string) {
  const topics = encodeEventTopics({
    abi: EVENT_ABI,
    eventName: 'AgentRegistered',
    args: { slug, creator: CREATOR_ADDR },
  })
  const data = encodeAbiParameters(
    [
      { name: 'pricePerCall', type: 'uint256' },
      { name: 'erc8004Id', type: 'uint64' },
    ],
    [BigInt(0), BigInt(0)],
  )
  return { data, topics, address: CONTRACT }
}

function makeRequest(body: Record<string, unknown> = { txHash: VALID_TX }) {
  return new NextRequest('http://localhost/api/creator/agents/my-agent/upgrade-onchain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function setupDefaults(overrides: {
  contractAddress?: string | null
  receiptTo?: string
  logs?: unknown[]
} = {}) {
  if (overrides.contractAddress === null) {
    delete process.env.MARKETPLACE_CONTRACT_ADDRESS
  } else {
    process.env.MARKETPLACE_CONTRACT_ADDRESS = overrides.contractAddress ?? CONTRACT
  }

  mocks.validateCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockResolvedValue(null)
  mocks.getIdentifier.mockReturnValue('test-ip')
  mocks.getRegisterLimit.mockReturnValue({})
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

  mocks.serviceFrom.mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'agent-1',
            creator_id: USER_ID,
            registration_type: 'off_chain',
            slug: SLUG,
            price_per_call: 0,
          },
          error: null,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  }))

  mocks.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    to: overrides.receiptTo ?? CONTRACT,
    blockNumber: BigInt(100),
    logs: overrides.logs ?? [],
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/creator/agents/[slug]/upgrade-onchain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MARKETPLACE_CONTRACT_ADDRESS
  })

  it('rejects tx to wrong contract (422)', async () => {
    setupDefaults({ receiptTo: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })
    const res = await POST(makeRequest(), { params: Promise.resolve({ slug: SLUG }) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/not directed to the WasiAI Marketplace/)
  })

  it('rejects tx with no AgentRegistered event (422)', async () => {
    setupDefaults({ logs: [] })
    const res = await POST(makeRequest(), { params: Promise.resolve({ slug: SLUG }) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/AgentRegistered/)
  })

  it('rejects tx with AgentRegistered for wrong slug (422)', async () => {
    setupDefaults({ logs: [makeLog('wrong-slug')] })
    const res = await POST(makeRequest(), { params: Promise.resolve({ slug: SLUG }) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/AgentRegistered/)
  })

  it('accepts valid tx with correct contract + event (200)', async () => {
    setupDefaults({ logs: [makeLog(SLUG)] })
    const res = await POST(makeRequest(), { params: Promise.resolve({ slug: SLUG }) })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('on_chain')
  })

  it('returns 500 when contract not configured', async () => {
    setupDefaults({ contractAddress: null })
    const res = await POST(makeRequest(), { params: Promise.resolve({ slug: SLUG }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not configured/)
  })
})
