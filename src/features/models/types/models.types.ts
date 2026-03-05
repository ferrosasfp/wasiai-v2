export type ModelCategory = 'nlp' | 'vision' | 'audio' | 'code' | 'multimodal' | 'data'

export type ModelStatus = 'active' | 'paused' | 'reviewing'

export type RegistrationType = 'off_chain' | 'on_chain'

export type AgentType = 'model' | 'agent' | 'workflow'

export interface ModelCapability {
  name: string
  description: string
  inputType: 'text' | 'image' | 'audio' | 'json'
  outputType: 'text' | 'image' | 'audio' | 'json'
  example?: {
    input: string
    output: string
  }
}

export interface Model {
  id: string
  creator_id: string
  name: string
  slug: string
  description: string | null
  category: ModelCategory
  price_per_call: number
  currency: string
  chain: string
  endpoint_url: string | null
  capabilities: ModelCapability[]
  metadata: Record<string, unknown>
  status: ModelStatus
  is_featured: boolean
  total_calls: number
  total_revenue: number
  created_at: string
  updated_at: string

  // Agent-specific fields (migration 006)
  agent_type: AgentType          // 'model' | 'agent' | 'workflow'
  dependencies: string[]         // slugs of other agents this agent calls
  creator_wallet: string | null  // creator's wallet for on-chain payouts
  on_chain_registered: boolean   // registered in WasiAIMarketplace.sol (legacy — use registration_type)
  registration_type: RegistrationType // WAS-160: 'off_chain' | 'on_chain'
  token_id: number | null        // WAS-160: ERC-8004 token ID from selfRegisterAgent/registerAgent
  chain_registered_at: string | null // WAS-160: timestamp of on-chain registration
  erc8004_id: number | null      // ERC-8004 identity token ID
  reputation_score: number | null
  reputation_count: number
  mcp_tool_name: string | null
  mcp_description: string | null
  cover_image: string | null  // IPFS URL via Pinata

  // HU-3.3: Free trial controlado por creator
  free_trial_enabled: boolean
  free_trial_limit: number

  // WAS-72: Escrow para tareas largas
  long_running: boolean

  // joined
  creator?: CreatorProfile
}

/** Alias for semantic clarity in agent-focused code */
export type Agent = Model

export interface CreatorProfile {
  id: string
  username: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  wallet_address: string | null
  total_earnings: number
  total_models: number
  verified: boolean
  created_at: string
}

export interface CreateModelInput {
  name: string
  slug: string
  description?: string
  category: ModelCategory
  price_per_call: number
  endpoint_url: string
  capabilities?: ModelCapability[]
}

// HU-4.3: Tipos para Agent Examples
export interface AgentExample {
  id: string
  agent_id: string
  creator_id: string
  label: string | null
  input: string
  output: string
  sort_order: number
  created_at: string
  updated_at: string
}

export type AgentExampleCreate = {
  label?: string | null
  input: string
  output: string
}

export type AgentExampleUpdate = Partial<AgentExampleCreate>
