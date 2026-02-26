/**
 * Server-side data fetcher for public creator profiles.
 * HU-1.5: Perfil Público del Creator
 *
 * Security: does NOT expose email, wallet_address, or any private field.
 */
import { createServiceClient } from '@/lib/supabase/server'

export interface CreatorAgentCard {
  id: string
  slug: string
  name: string
  description: string | null
  price_per_call: number
  category: string
  cover_image: string | null
  total_calls: number
}

export interface CreatorPublicProfile {
  username: string
  displayName: string
  bio: string | null
  memberSince: string        // ISO date string
  agentCount: number
  totalCalls: number
  agents: CreatorAgentCard[]
}

export async function getCreatorByUsername(
  username: string
): Promise<CreatorPublicProfile | null> {
  const svc = createServiceClient()

  // 1. Buscar creator por username (case-insensitive)
  const { data: profile } = await svc
    .from('creator_profiles')
    .select('id, username, bio, created_at')
    .ilike('username', username)
    .single()

  if (!profile) return null

  // 2. Agentes activos del creator — no exponer endpoint_url ni auth_header
  const { data: agentsData } = await svc
    .from('agents')
    .select('id, slug, name, description, price_per_call, category, cover_image, total_calls')
    .eq('creator_id', profile.id)
    .eq('status', 'active')
    .order('total_calls', { ascending: false })

  const agents: CreatorAgentCard[] = (agentsData ?? []).map(a => ({
    id:            a.id,
    slug:          a.slug,
    name:          a.name,
    description:   a.description,
    price_per_call: a.price_per_call,
    category:      a.category,
    cover_image:   a.cover_image,
    total_calls:   a.total_calls ?? 0,
  }))

  // 3. Total de llamadas acumuladas
  const agentIds = agents.map(a => a.id)
  let totalCalls = 0
  if (agentIds.length > 0) {
    const { count } = await svc
      .from('agent_calls')
      .select('id', { count: 'exact', head: true })
      .in('agent_id', agentIds)
    totalCalls = count ?? 0
  }

  // 4. displayName: username (never expose email)
  const displayName = (profile.username as string | null) ?? 'Creator'

  return {
    username:    profile.username as string,
    displayName,
    bio:         profile.bio as string | null,
    memberSince: profile.created_at as string,
    agentCount:  agents.length,
    totalCalls,
    agents,
  }
}
