import type { SupabaseClient } from '@supabase/supabase-js'
import { isAgentInScope } from '@/lib/scope-check'

interface DiscoveryConstraints {
  max_price_usdc?:  number
  min_reputation?:  number
  min_performance?: number  // performance_score 0-100 — NUEVO
  category?:        string
}

export interface DiscoveredAgent {
  id:                string
  slug:              string
  name:              string
  category:          string
  price_per_call:    number
  endpoint_url:      string
  status:            string
  max_rpm:           number | null
  max_rpd:           number | null
  performance_score?: number | null  // NUEVO (WAS-187)
}

/**
 * Descubre el mejor agente activo para una capability dada.
 * Aplica scope check de WAS-186.
 * Retorna null si no hay match dentro del scope y constraints.
 */
export async function discoverAgent(
  supabase:          SupabaseClient,
  capability:        string,
  constraints:       DiscoveryConstraints = {},
  allowedSlugs:      string[] | null,
  allowedCategories: string[] | null,
): Promise<DiscoveredAgent | null> {
  // capabilities es JSONB array de objetos {name, description, inputType, outputType}
  // Usar contains para buscar agentes con esa capability por nombre
  let query = supabase
    .from('agents')
    .select('id, slug, name, category, price_per_call, endpoint_url, status, max_rpm, max_rpd, capabilities, reputation_score, performance_score')
    .eq('status', 'active')
    .contains('capabilities', JSON.stringify([{ name: capability }]))

  if (constraints.max_price_usdc !== undefined) {
    query = query.lte('price_per_call', constraints.max_price_usdc)
  }
  if (constraints.min_reputation !== undefined) {
    query = query.gte('reputation_score', constraints.min_reputation)
  }
  if (constraints.min_performance !== undefined) {
    query = query.gte('performance_score', constraints.min_performance)
  }
  if (constraints.category) {
    query = query.eq('category', constraints.category)
  }

  const { data: candidates } = await query
    .order('performance_score', { ascending: false, nullsFirst: false })
    .order('reputation_score', { ascending: false, nullsFirst: false })
    .order('price_per_call', { ascending: true })
    .limit(10)

  if (!candidates || candidates.length === 0) return null

  // AC-7: filtrar por scope de key (WAS-186)
  const scoped = candidates.filter((a: DiscoveredAgent) =>
    isAgentInScope(a.slug, a.category, allowedSlugs, allowedCategories)
  )

  return (scoped[0] as DiscoveredAgent) ?? null
}
