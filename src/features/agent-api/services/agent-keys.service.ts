import { createClient } from '@/lib/supabase/server'
import { randomBytes, createHash } from 'crypto'

export interface AgentKey {
  id: string
  owner_id: string
  name: string
  key_hash: string
  budget_usdc: number
  spent_usdc: number
  is_active: boolean
  last_used_at: string | null
  created_at: string
  balance_synced_at: string | null
  owner_wallet_address?: string | null   // HU-058: first depositor's wallet
  allowed_slugs: string[] | null
  allowed_categories: string[] | null
  // Only returned on creation
  raw_key?: string
}

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `wasi_${randomBytes(24).toString('hex')}`
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

export async function getAgentKeys(): Promise<AgentKey[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data, error } = await supabase
    .from('agent_keys')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as AgentKey[]) ?? []
}

export async function createAgentKey(
  name: string,
  budgetUsdc: number,
  options?: { allowed_slugs?: string[], allowed_categories?: string[] }
): Promise<AgentKey> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  if (options?.allowed_slugs && options.allowed_slugs.length > 0) {
    const { data: foundAgents } = await supabase
      .from('agents')
      .select('slug')
      .in('slug', options.allowed_slugs)
      .eq('status', 'active')

    const foundSlugs = new Set((foundAgents ?? []).map((a: {slug: string}) => a.slug))
    const invalidSlugs = options.allowed_slugs.filter(s => !foundSlugs.has(s))

    if (invalidSlugs.length > 0) {
      throw Object.assign(
        new Error(`Slugs no encontrados: ${invalidSlugs.join(', ')}`),
        { code: 'invalid_slugs', status: 422, invalidSlugs }
      )
    }
  }

  const { raw, hash } = generateApiKey()

  const { data, error } = await supabase
    .from('agent_keys')
    .insert({
      owner_id: user.id,
      name,
      key_hash: hash,
      budget_usdc: budgetUsdc,
      allowed_slugs: options?.allowed_slugs ?? null,
      allowed_categories: options?.allowed_categories ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return { ...(data as AgentKey), raw_key: raw }
}

export async function revokeAgentKey(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase
    .from('agent_keys')
    .update({ is_active: false })
    .eq('id', id)
    .eq('owner_id', user.id)
}

export async function validateAgentKey(rawKey: string): Promise<AgentKey | null> {
  const supabase = await createClient()
  const hash = createHash('sha256').update(rawKey).digest('hex')

  const { data } = await supabase
    .from('agent_keys')
    .select('*')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .single()

  if (!data) return null

  const key = data as AgentKey
  if (key.budget_usdc <= 0) return null // on-chain balance is 0 or negative = exhausted

  return key
}
