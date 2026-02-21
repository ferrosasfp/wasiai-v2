import { createClient } from '@/lib/supabase/server'
import type { Model, ModelCategory, CreateModelInput } from '../types/models.types'

export async function getModels({
  category,
  search,
  limit = 12,
  offset = 0,
}: {
  category?: ModelCategory
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<Model[]> {
  const supabase = await createClient()
  let query = supabase
    .from('models')
    .select('*, creator:creator_profiles(id, username, display_name, avatar_url, verified)')
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_calls', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) query = query.eq('category', category)
  if (search) query = query.ilike('name', `%${search}%`)

  const { data, error } = await query
  if (error) throw error
  return (data as Model[]) ?? []
}

export async function getModelBySlug(slug: string): Promise<Model | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('models')
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
    .from('models')
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
    .from('models')
    .insert({ ...input, creator_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data as Model
}

export async function getFeaturedModels(limit = 6): Promise<Model[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('models')
    .select('*, creator:creator_profiles(id, username, display_name, avatar_url, verified)')
    .eq('status', 'active')
    .eq('is_featured', true)
    .limit(limit)

  if (error) throw error
  return (data as Model[]) ?? []
}
