/**
 * LLM fallback chain: Groq → Cerebras → Together AI
 *
 * All three expose OpenAI-compatible /chat/completions endpoints.
 * If a provider returns 401, 402, 429 or 5xx, the next one is tried.
 * The first successful response wins.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMOptions {
  messages: LLMMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export interface LLMResult {
  result: string
  model: string
  provider: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

interface Provider {
  name: string
  url: string
  apiKey: string | undefined
  model: string
}

function getProviders(preferredModel?: string): Provider[] {
  return [
    {
      name:   'groq',
      url:    'https://api.groq.com/openai/v1/chat/completions',
      apiKey: process.env.GROQ_API_KEY,
      model:  preferredModel ?? 'llama-3.3-70b-versatile',
    },
    {
      name:   'cerebras',
      url:    'https://api.cerebras.ai/v1/chat/completions',
      apiKey: process.env.CEREBRAS_API_KEY,
      model:  'llama3.1-8b',
    },
    {
      name:   'together',
      url:    'https://api.together.xyz/v1/chat/completions',
      apiKey: process.env.TOGETHER_API_KEY,
      model:  'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    },
  ]
}

async function callProvider(provider: Provider, opts: LLMOptions): Promise<LLMResult> {
  if (!provider.apiKey) throw new Error(`${provider.name}: API key not set`)

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model:       provider.model,
      messages:    opts.messages,
      max_tokens:  opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${provider.name} API error ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>
    model: string
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  }

  return {
    result:   data.choices[0]?.message?.content ?? '',
    model:    data.model,
    provider: provider.name,
    usage:    data.usage,
  }
}

/**
 * Main entry point. Tries providers in order, falls back on 401, 402, 429 or 5xx.
 */
export async function callLLM(opts: LLMOptions): Promise<LLMResult> {
  const providers = getProviders(opts.model)
  const errors: string[] = []

  for (const provider of providers) {
    if (!provider.apiKey) {
      errors.push(`${provider.name}: no API key`)
      continue
    }
    try {
      const result = await callProvider(provider, opts)
      if (errors.length > 0) {
        console.warn(`[llm] primary failed, used fallback: ${provider.name}. Errors: ${errors.join(' | ')}`)
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Extract HTTP status code from error message (e.g. "API error 504: ...")
      const statusMatch = msg.match(/\b([45]\d{2})\b/)
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0
      const isRetryable = status === 401 || status === 402 || status === 429 || status >= 500 ||
        (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
      errors.push(msg)
      if (!isRetryable) {
        // Hard error (bad request, schema error) — no point trying next provider
        throw new Error(`[llm/${provider.name}] ${msg}`)
      }
      console.warn(`[llm] ${provider.name} failed (retryable), trying next. Error: ${msg.slice(0, 100)}`)
    }
  }

  throw new Error(`[llm] all providers failed: ${errors.join(' | ')}`)
}

// ── Backward-compat alias ─────────────────────────────────────────────────────
export type GroqMessage = LLMMessage
export type GroqOptions = LLMOptions
export type GroqResult  = LLMResult & { provider: string }
export const callGroq   = callLLM
