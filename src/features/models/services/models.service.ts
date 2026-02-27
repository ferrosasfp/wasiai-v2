import { createClient } from '@/lib/supabase/server'
import type { Model, ModelCategory, CreateModelInput } from '../types/models.types'

export type AgentTypeFilter = 'llm' | 'rag' | 'tool' | 'multimodal' | 'code'

export async function getModels({
  category,
  search,
  agent_type,
  max_price,
  limit = 12,
  offset = 0,
}: {
  category?: ModelCategory
  search?: string
  agent_type?: AgentTypeFilter | string
  max_price?: number
  limit?: number
  offset?: number
} = {}): Promise<{ models: Model[]; total: number }> {
  const supabase = await createClient()
  let query = supabase
    .from('agents')
    .select('*, creator:creator_profiles(id, username, display_name, avatar_url, verified)', { count: 'exact' })
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_calls', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) query = query.eq('category', category)
  if (agent_type) query = query.eq('agent_type', agent_type)
  if (max_price !== undefined && !isNaN(max_price)) {
    query = query.lte('price_per_call', max_price)
  }
  if (search) {
    query = query.textSearch('search_vector', search, { type: 'websearch' })
  }

  const { data, error, count } = await query
  if (error) throw error
  return { models: (data as Model[]) ?? [], total: count ?? 0 }
}

export async function getModelBySlug(slug: string): Promise<Model | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*, creator:creator_profiles(id, username, display_name, avatar_url, verified, bio)')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (error) return null
  return data as Model
}

export async function getCreatorModels(creatorId: string): Promise<Model[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as Model[]) ?? []
}

export async function createModel(input: CreateModelInput): Promise<Model> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data, error } = await supabase
    .from('agents')
    .insert({ ...input, creator_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data as Model
}

export async function getFeaturedModels(limit = 6): Promise<Model[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*, creator:creator_profiles(id, username, display_name, avatar_url, verified)')
    .eq('status', 'active')
    .eq('is_featured', true)
    .limit(limit)

  if (error) throw error
  return (data as Model[]) ?? []
}
