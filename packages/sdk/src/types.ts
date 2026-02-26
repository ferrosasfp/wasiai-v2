export interface WasiAIConfig {
  /** WasiAI API key (starts with `wasi_`) */
  apiKey: string
  /** Override the base URL (useful for tests or self-hosted deployments) */
  baseUrl?: string
}

export interface InvokeOptions {
  /** Text input for the agent */
  input: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

export interface InvokeResult {
  /** The agent's output */
  output: string
  /** Time taken by the agent in milliseconds */
  latencyMs: number
  /** On-chain payment receipt identifier */
  receiptId: string
}

export interface Agent {
  slug: string
  name: string
  description: string
  category: string
  /** Price per call in USDC (as a string for precision, e.g. "0.02") */
  priceUsdc: string
  inputExample?: string
}

export interface ListOptions {
  /** Filter by category (e.g. "nlp", "vision") */
  category?: string
  /** Full-text search term */
  search?: string
  /** Maximum number of results (default: 20) */
  limit?: number
  /** Pagination offset */
  offset?: number
}
