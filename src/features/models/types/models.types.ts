export type ModelCategory = 'nlp' | 'vision' | 'audio' | 'code' | 'multimodal' | 'data'

export type ModelStatus = 'active' | 'paused' | 'reviewing'

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
  // joined
  creator?: CreatorProfile
}

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
