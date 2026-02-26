export interface WasiAIOptions {
  apiKey: string
  baseUrl?: string
}

export interface InvokeResult {
  output: unknown
  agentSlug: string
  callId: string
  latencyMs: number
}

export interface Agent {
  slug: string
  name: string
  description: string
  category: string
  priceUsdc: number
  currency: string
  endpoint: string
}

export interface AgentList {
  agents: Agent[]
  total: number
  page: number
  hasMore: boolean
}

export interface AgentListOptions {
  page?: number
  category?: string
}
