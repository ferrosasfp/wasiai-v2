// Shared TypeScript types for DeFi Risk Intelligence Pipeline

export interface ChainlinkResult {
  feed_address: string
  token_symbol: string
  price_usd: number
  timestamp: number
  round_id: string
  history: Array<{ round_id: string; price_usd: number; timestamp: number }>
  volatility_7d_pct: number
  error?: string
}

export interface OnChainResult {
  token_address: string
  name: string
  symbol: string
  total_supply: string
  decimals: number
  contract_age_days: number
  holder_count: number | null
  top10_concentration_pct: number | null
  flags: {
    has_mint_function: boolean
    owner_renounced: boolean
    is_paused: boolean
    is_proxy: boolean
    bytecode_size_bytes: number
  }
  error?: string
}

export interface AuditFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title: string
  description: string
}

export interface AuditResult {
  token_address: string
  findings: AuditFinding[]
  summary: string
  powered_by: 'groq-llama' | 'kite-ai'
  error?: string
}

export interface SentimentResult {
  token_name: string
  token_symbol: string
  sentiment_score: number       // 0 (clean) to 100 (very suspicious)
  flags: string[]               // e.g. ["FOMO naming", "Too-good-to-be-true"]
  analysis: string
  error?: string
}

export interface RiskScore {
  total: number                  // 0-100
  rating: 'SAFE' | 'CAUTION' | 'AVOID'
  breakdown: {
    volatility:    { score: number; weight: number; contribution: number }
    concentration: { score: number; weight: number; contribution: number }
    audit:         { score: number; weight: number; contribution: number }
    sentiment:     { score: number; weight: number; contribution: number }
  }
}

export interface RiskReport {
  token_address: string
  generated_at: string          // ISO timestamp
  risk_score: RiskScore
  agents: {
    chainlink:   ChainlinkResult | null
    onchain:     OnChainResult | null
    audit:       AuditResult | null
    sentiment:   SentimentResult | null
  }
  summary: string               // Human-readable summary
  disclaimer: string
}
