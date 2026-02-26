import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WasiAI } from '../src/index'
import {
  AgentNotFoundError,
  InsufficientBudgetError,
  RateLimitError,
  WasiAIError,
} from '../src/errors'

// ─── helpers ────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'wasi_test_key_12345'

function makeClient() {
  return new WasiAI({ apiKey: TEST_API_KEY, baseUrl: 'http://localhost' })
}

function mockFetchOk(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  }))
}

function mockFetchStatus(status: number): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    statusText: String(status),
    json: async () => ({ message: `Error ${status}` }),
  }))
}

// ─── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals()
})

// ─── constructor ─────────────────────────────────────────────────────────────

describe('WasiAI constructor', () => {
  it('throws if apiKey is empty', () => {
    expect(() => new WasiAI({ apiKey: '' })).toThrow('apiKey is required')
  })
})

// ─── invoke() happy path ──────────────────────────────────────────────────────

describe('invoke() — happy path', () => {
  it('returns InvokeResult on 200', async () => {
    const expected = { output: 'hello', agentSlug: 'my-agent', callId: 'c1', latencyMs: 100 }
    mockFetchOk(expected)

    const client = makeClient()
    const result = await client.invoke('my-agent', { text: 'hi' })

    expect(result.output).toBe('hello')
    expect(result.latencyMs).toBe(100)
    expect(result.callId).toBe('c1')
  })

  it('sends X-API-Key header', async () => {
    mockFetchOk({ output: 'ok', agentSlug: 'agent', callId: 'c1', latencyMs: 1 })
    const client = makeClient()
    await client.invoke('agent', { text: 'test' })

    const callArgs = vi.mocked(fetch).mock.calls[0]
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-API-Key']).toBe(TEST_API_KEY)
  })

  it('POSTs to /api/v1/agents/<slug>/invoke', async () => {
    mockFetchOk({ output: 'ok', agentSlug: 'text-summarizer', callId: 'c1', latencyMs: 1 })
    const client = makeClient()
    await client.invoke('text-summarizer', { text: 'test' })

    const callArgs = vi.mocked(fetch).mock.calls[0]
    expect(callArgs[0] as string).toContain('/api/v1/agents/text-summarizer/invoke')
    expect((callArgs[1] as RequestInit).method).toBe('POST')
  })
})

// ─── invoke() errors ──────────────────────────────────────────────────────────

describe('invoke() — error cases', () => {
  it('throws RateLimitError on 429', async () => {
    mockFetchStatus(429)
    const client = makeClient()
    await expect(client.invoke('agent', {})).rejects.toBeInstanceOf(RateLimitError)
  })

  it('throws InsufficientBudgetError on 402', async () => {
    mockFetchStatus(402)
    const client = makeClient()
    await expect(client.invoke('agent', {})).rejects.toBeInstanceOf(InsufficientBudgetError)
  })

  it('throws AgentNotFoundError on 404', async () => {
    mockFetchStatus(404)
    const client = makeClient()
    await expect(client.invoke('agent', {})).rejects.toBeInstanceOf(AgentNotFoundError)
  })

  it('throws WasiAIError on generic non-ok status', async () => {
    mockFetchStatus(500)
    const client = makeClient()
    await expect(client.invoke('agent', {})).rejects.toBeInstanceOf(WasiAIError)
  })
})

// ─── agents.list() ────────────────────────────────────────────────────────────

describe('agents.list() — happy path', () => {
  it('returns AgentList', async () => {
    const agentList = {
      agents: [{ slug: 'agent-1', name: 'Agent 1', description: '', category: 'nlp', priceUsdc: 0.01, currency: 'USDC', endpoint: '/api/v1/agents/agent-1/invoke' }],
      total: 1,
      page: 1,
      hasMore: false,
    }
    mockFetchOk(agentList)
    const client = makeClient()
    const result = await client.agents.list()
    expect(result.agents).toHaveLength(1)
  })

  it('does NOT send X-API-Key header (public endpoint)', async () => {
    mockFetchOk({ agents: [], total: 0, page: 1, hasMore: false })
    const client = makeClient()
    await client.agents.list()

    const callArgs = vi.mocked(fetch).mock.calls[0]
    const init = callArgs[1] as RequestInit | undefined
    if (init?.headers) {
      const headers = init.headers as Record<string, string>
      expect(headers['X-API-Key']).toBeUndefined()
    }
  })

  it('GETs /api/v1/agents', async () => {
    mockFetchOk({ agents: [], total: 0, page: 1, hasMore: false })
    const client = makeClient()
    await client.agents.list()
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/v1/agents')
  })

  it('throws WasiAIError on non-ok response', async () => {
    mockFetchStatus(503)
    const client = makeClient()
    await expect(client.agents.list()).rejects.toBeInstanceOf(WasiAIError)
  })
})

// ─── agents.get() ─────────────────────────────────────────────────────────────

describe('agents.get() — happy path', () => {
  it('returns Agent on 200', async () => {
    const agent = { slug: 'test', name: 'Test', description: 'desc', category: 'nlp', priceUsdc: 0.01, currency: 'USDC', endpoint: '/api/v1/agents/test/invoke' }
    mockFetchOk(agent)
    const client = makeClient()
    const result = await client.agents.get('test')
    expect(result.slug).toBe('test')
  })

  it('throws AgentNotFoundError on 404', async () => {
    mockFetchStatus(404)
    const client = makeClient()
    await expect(client.agents.get('nonexistent')).rejects.toBeInstanceOf(AgentNotFoundError)
  })

  it('GETs /api/v1/agents/<slug>', async () => {
    const agent = { slug: 'my-agent', name: 'My Agent', description: '', category: 'nlp', priceUsdc: 0.01, currency: 'USDC', endpoint: '/api/v1/agents/my-agent/invoke' }
    mockFetchOk(agent)
    const client = makeClient()
    await client.agents.get('my-agent')
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/v1/agents/my-agent')
  })

  it('throws WasiAIError on non-ok, non-404 response', async () => {
    mockFetchStatus(500)
    const client = makeClient()
    await expect(client.agents.get('agent')).rejects.toBeInstanceOf(WasiAIError)
  })
})

// ─── CRÍTICO: API key must never appear in error messages ─────────────────────

describe('CRÍTICO — API key must NOT appear in error messages', () => {
  const API_KEY = 'wasi_super_secret_key_9999'

  function clientWithKey() {
    return new WasiAI({ apiKey: API_KEY, baseUrl: 'http://localhost' })
  }

  function assertNoKeyInMessage(err: unknown): void {
    if (err instanceof Error) {
      expect(err.message).not.toContain('wasi_')
      expect(err.message).not.toContain(API_KEY)
    }
  }

  it('RateLimitError message does not contain wasi_', async () => {
    mockFetchStatus(429)
    try { await clientWithKey().invoke('agent', {}) } catch (err) { assertNoKeyInMessage(err) }
  })

  it('InsufficientBudgetError message does not contain wasi_', async () => {
    mockFetchStatus(402)
    try { await clientWithKey().invoke('agent', {}) } catch (err) { assertNoKeyInMessage(err) }
  })

  it('AgentNotFoundError message does not contain wasi_', async () => {
    mockFetchStatus(404)
    try { await clientWithKey().invoke('agent', {}) } catch (err) { assertNoKeyInMessage(err) }
  })

  it('WasiAIError (generic) message does not contain wasi_', async () => {
    mockFetchStatus(500)
    try { await clientWithKey().invoke('agent', {}) } catch (err) { assertNoKeyInMessage(err) }
  })

  it('agents.list() WasiAIError message does not contain wasi_', async () => {
    mockFetchStatus(503)
    try { await clientWithKey().agents.list() } catch (err) { assertNoKeyInMessage(err) }
  })

  it('agents.get() WasiAIError message does not contain wasi_', async () => {
    mockFetchStatus(500)
    try { await clientWithKey().agents.get('agent') } catch (err) { assertNoKeyInMessage(err) }
  })
})
