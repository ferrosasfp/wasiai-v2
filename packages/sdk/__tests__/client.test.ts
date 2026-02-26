import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WasiAI } from '../src/client'
import {
  RateLimitError,
  InsufficientFundsError,
  AgentNotFoundError,
  TimeoutError,
  WasiAIError,
} from '../src/errors'

// ─── helpers ────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'wasi_test_key_12345'

function makeClient() {
  return new WasiAI({ apiKey: TEST_API_KEY, baseUrl: 'http://localhost' })
}

function mockFetchOk(body: unknown, status = 200): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

function mockFetchStatus(status: number): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: 'error' }),
  } as Response)
}

// ─── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── constructor ─────────────────────────────────────────────────────────────

describe('WasiAI constructor', () => {
  it('throws WasiAIError if apiKey is empty', () => {
    expect(() => new WasiAI({ apiKey: '' })).toThrow(WasiAIError)
  })
})

// ─── invoke() happy path ──────────────────────────────────────────────────────

describe('invoke() — happy path', () => {
  it('returns InvokeResult on 200', async () => {
    const expected = { output: 'hello', latencyMs: 100, receiptId: '0xabc' }
    mockFetchOk(expected)

    const client = makeClient()
    const result = await client.invoke('my-agent', { input: 'hi' })

    expect(result.output).toBe('hello')
    expect(result.latencyMs).toBe(100)
    expect(result.receiptId).toBe('0xabc')
  })

  it('sends X-API-Key header', async () => {
    mockFetchOk({ output: 'ok', latencyMs: 1, receiptId: '0x1' })
    const client = makeClient()
    await client.invoke('agent', { input: 'test' })

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = callArgs[1].headers as Record<string, string>
    expect(headers['X-API-Key']).toBe(TEST_API_KEY)
  })

  it('POSTs to /api/v1/agents/<slug>/invoke', async () => {
    mockFetchOk({ output: 'ok', latencyMs: 1, receiptId: '0x1' })
    const client = makeClient()
    await client.invoke('text-summarizer', { input: 'test' })

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[0]).toContain('/api/v1/agents/text-summarizer/invoke')
    expect(callArgs[1].method).toBe('POST')
  })
})

// ─── invoke() errors ──────────────────────────────────────────────────────────

describe('invoke() — error cases', () => {
  it('throws RateLimitError on 429', async () => {
    mockFetchStatus(429)
    const client = makeClient()
    await expect(client.invoke('agent', { input: 'test' })).rejects.toBeInstanceOf(RateLimitError)
  })

  it('throws InsufficientFundsError on 402', async () => {
    mockFetchStatus(402)
    const client = makeClient()
    await expect(client.invoke('agent', { input: 'test' })).rejects.toBeInstanceOf(InsufficientFundsError)
  })

  it('throws AgentNotFoundError on 404', async () => {
    mockFetchStatus(404)
    const client = makeClient()
    await expect(client.invoke('agent', { input: 'test' })).rejects.toBeInstanceOf(AgentNotFoundError)
  })

  it('throws TimeoutError on AbortError', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    global.fetch = vi.fn().mockRejectedValueOnce(abortError)
    const client = makeClient()
    await expect(client.invoke('agent', { input: 'test' })).rejects.toBeInstanceOf(TimeoutError)
  })

  it('throws WasiAIError on generic non-ok status', async () => {
    mockFetchStatus(500)
    const client = makeClient()
    await expect(client.invoke('agent', { input: 'test' })).rejects.toBeInstanceOf(WasiAIError)
  })
})

// ─── list() happy path ────────────────────────────────────────────────────────

describe('list() — happy path', () => {
  it('returns array of agents', async () => {
    const agents = [{ slug: 'agent-1', name: 'Agent 1', description: '', category: 'nlp', priceUsdc: '0.01' }]
    mockFetchOk(agents)
    const client = makeClient()
    const result = await client.list()
    expect(result).toEqual(agents)
  })

  it('also handles { agents: [...] } shape', async () => {
    const agents = [{ slug: 'agent-2', name: 'Agent 2', description: '', category: 'vision', priceUsdc: '0.02' }]
    mockFetchOk({ agents })
    const client = makeClient()
    const result = await client.list()
    expect(result).toEqual(agents)
  })

  it('does NOT send X-API-Key header (public endpoint)', async () => {
    mockFetchOk([])
    const client = makeClient()
    await client.list()

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    // list() only passes URL, no init object with headers — or headers without X-API-Key
    const init = callArgs[1] as RequestInit | undefined
    if (init?.headers) {
      const headers = init.headers as Record<string, string>
      expect(headers['X-API-Key']).toBeUndefined()
    } else {
      // No headers at all — that's correct
      expect(true).toBe(true)
    }
  })

  it('GETs /api/v1/agents', async () => {
    mockFetchOk([])
    const client = makeClient()
    await client.list()
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[0]).toContain('/api/v1/agents')
  })

  it('throws WasiAIError on non-ok response', async () => {
    mockFetchStatus(503)
    const client = makeClient()
    await expect(client.list()).rejects.toBeInstanceOf(WasiAIError)
  })
})

// ─── get() happy path ─────────────────────────────────────────────────────────

describe('get() — happy path', () => {
  it('returns Agent on 200', async () => {
    const agent = { slug: 'test', name: 'Test', description: 'desc', category: 'nlp', priceUsdc: '0.01' }
    mockFetchOk(agent)
    const client = makeClient()
    const result = await client.get('test')
    expect(result).toEqual(agent)
  })

  it('returns null on 404', async () => {
    mockFetchStatus(404)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => null,
    } as unknown as Response)

    const client = makeClient()
    const result = await client.get('nonexistent')
    expect(result).toBeNull()
  })

  it('does NOT send X-API-Key header (public endpoint)', async () => {
    const agent = { slug: 'test', name: 'Test', description: '', category: 'nlp', priceUsdc: '0.01' }
    mockFetchOk(agent)
    const client = makeClient()
    await client.get('test')

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const init = callArgs[1] as RequestInit | undefined
    if (init?.headers) {
      const headers = init.headers as Record<string, string>
      expect(headers['X-API-Key']).toBeUndefined()
    } else {
      expect(true).toBe(true)
    }
  })

  it('GETs /api/v1/agents/<slug>', async () => {
    const agent = { slug: 'my-agent', name: 'My Agent', description: '', category: 'nlp', priceUsdc: '0.01' }
    mockFetchOk(agent)
    const client = makeClient()
    await client.get('my-agent')
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[0]).toContain('/api/v1/agents/my-agent')
  })

  it('throws WasiAIError on non-ok, non-404 response', async () => {
    mockFetchStatus(500)
    const client = makeClient()
    await expect(client.get('agent')).rejects.toBeInstanceOf(WasiAIError)
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
    try {
      await clientWithKey().invoke('agent', { input: 'test' })
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })

  it('InsufficientFundsError message does not contain wasi_', async () => {
    mockFetchStatus(402)
    try {
      await clientWithKey().invoke('agent', { input: 'test' })
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })

  it('AgentNotFoundError message does not contain wasi_', async () => {
    mockFetchStatus(404)
    try {
      await clientWithKey().invoke('agent', { input: 'test' })
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })

  it('TimeoutError message does not contain wasi_', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    global.fetch = vi.fn().mockRejectedValueOnce(abortError)
    try {
      await clientWithKey().invoke('agent', { input: 'test' })
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })

  it('WasiAIError (generic) message does not contain wasi_', async () => {
    mockFetchStatus(500)
    try {
      await clientWithKey().invoke('agent', { input: 'test' })
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })

  it('list() WasiAIError message does not contain wasi_', async () => {
    mockFetchStatus(503)
    try {
      await clientWithKey().list()
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })

  it('get() WasiAIError message does not contain wasi_', async () => {
    mockFetchStatus(500)
    try {
      await clientWithKey().get('agent')
    } catch (err) {
      assertNoKeyInMessage(err)
    }
  })
})
