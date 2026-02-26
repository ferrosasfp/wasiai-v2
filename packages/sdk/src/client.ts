import {
  WasiAIError,
  RateLimitError,
  InsufficientFundsError,
  AgentNotFoundError,
  TimeoutError,
} from './errors'
import type {
  WasiAIConfig,
  InvokeOptions,
  InvokeResult,
  Agent,
  ListOptions,
} from './types'

const DEFAULT_BASE_URL = 'https://wasiai-v2.vercel.app'
const DEFAULT_TIMEOUT_MS = 30_000

export class WasiAI {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(config: WasiAIConfig) {
    if (!config.apiKey) throw new WasiAIError('apiKey is required')
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  }

  /**
   * Invoke an agent by slug.
   * Automatically handles timeout, rate-limit, and payment errors.
   */
  async invoke(slug: string, options: InvokeOptions): Promise<InvokeResult> {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      options.timeout ?? DEFAULT_TIMEOUT_MS
    )

    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/agents/${slug}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({ input: options.input }),
          signal: controller.signal,
        }
      )
      clearTimeout(timeoutHandle)

      if (res.status === 429) throw new RateLimitError()
      if (res.status === 402) throw new InsufficientFundsError()
      if (res.status === 404) throw new AgentNotFoundError(slug)
      if (!res.ok) throw new WasiAIError(`Invoke failed: ${res.status}`)

      return (await res.json()) as InvokeResult
    } catch (err) {
      clearTimeout(timeoutHandle)
      if ((err as Error).name === 'AbortError') throw new TimeoutError()
      throw err
    }
  }

  /**
   * List available agents, optionally filtered by category or search term.
   */
  async list(options: ListOptions = {}): Promise<Agent[]> {
    const params = new URLSearchParams()
    if (options.category) params.set('category', options.category)
    if (options.search)   params.set('search', options.search)
    if (options.limit)    params.set('limit', String(options.limit))
    if (options.offset)   params.set('offset', String(options.offset))

    const res = await fetch(
      `${this.baseUrl}/api/v1/agents?${params.toString()}`
    )

    if (!res.ok) throw new WasiAIError(`List failed: ${res.status}`)

    const data = (await res.json()) as { agents?: Agent[] } | Agent[]
    return Array.isArray(data) ? data : (data.agents ?? [])
  }

  /**
   * Get agent details by slug. Returns `null` if the agent is not found.
   */
  async get(slug: string): Promise<Agent | null> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/agents/${slug}`
    )

    if (res.status === 404) return null
    if (!res.ok) throw new WasiAIError(`Get failed: ${res.status}`)

    return (await res.json()) as Agent
  }
}
