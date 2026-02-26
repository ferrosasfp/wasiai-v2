import { AgentNotFoundError, InsufficientBudgetError, RateLimitError, WasiAIError } from './errors'
import type { WasiAIOptions } from './types'

const DEFAULT_BASE_URL = 'https://wasiai-v2.vercel.app'

export class HttpClient {
  readonly baseUrl: string
  readonly apiKey: string

  constructor(options: WasiAIOptions) {
    if (!options.apiKey) throw new Error('apiKey is required')
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    auth = false,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (auth) {
      headers['X-API-Key'] = this.apiKey
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      let errorMessage = res.statusText
      try {
        const errBody = (await res.json()) as { message?: string; error?: string }
        errorMessage = errBody.message ?? errBody.error ?? errorMessage
      } catch {
        // ignore parse errors
      }

      if (res.status === 402) throw new InsufficientBudgetError(errorMessage)
      if (res.status === 404) {
        const match = /\/agents\/([^/]+)/.exec(path)
        throw new AgentNotFoundError(match?.[1] ?? path)
      }
      if (res.status === 429) throw new RateLimitError(errorMessage)
      throw new WasiAIError(errorMessage, res.status)
    }

    return res.json() as Promise<T>
  }
}
