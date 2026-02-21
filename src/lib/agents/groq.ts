/**
 * Groq API client — free tier, ultra-fast inference
 * Models: llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
 * Free tier: 14,400 req/day — https://console.groq.com
 *
 * Required env var: GROQ_API_KEY
 */

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.1-8b-instant' // fastest, free

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GroqResponse {
  result: string
  model: string
  tokens: number
  latency_ms: number
}

export async function callGroq({
  messages,
  model = DEFAULT_MODEL,
  maxTokens = 1024,
  temperature = 0.3,
}: {
  messages: GroqMessage[]
  model?: string
  maxTokens?: number
  temperature?: number
}): Promise<GroqResponse> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY not configured')

  const startMs = Date.now()

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Groq error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? ''
  const tokens  = data.usage?.total_tokens ?? 0

  return {
    result:     content,
    model:      data.model ?? model,
    tokens,
    latency_ms: Date.now() - startMs,
  }
}
