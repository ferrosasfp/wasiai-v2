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
  owner_wallet_address?: string | null   // HU-058: first depositor's wallet
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

export async function createAgentKey(name: string, budgetUsdc: number): Promise<AgentKey> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { raw, hash } = generateApiKey()

  const { data, error } = await supabase
    .from('agent_keys')
    .insert({
      owner_id: user.id,
      name,
      key_hash: hash,
      budget_usdc: budgetUsdc,
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
  if (key.spent_usdc >= key.budget_usdc) return null // Budget exhausted

  return key
}
