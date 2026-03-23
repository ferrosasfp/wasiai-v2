import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

const OPERATOR_ADDRESS = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '').toLowerCase()
const OWNER_ADDRESS    = (process.env.NEXT_PUBLIC_WASIAI_OWNER ?? '').toLowerCase()
const ADMIN_WALLETS = [
  OPERATOR_ADDRESS,
  OWNER_ADDRESS,
  '0x94DCDb84207724A609B17e4838936832EA59B9eD'.toLowerCase(),
  '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba'.toLowerCase(),
].filter(Boolean)

export const dynamic = 'force-dynamic'

export async function GET() {
  const h = await headers()
  const wallet = (h.get('x-admin-wallet') ?? '').toLowerCase()
  if (!wallet || !ADMIN_WALLETS.includes(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const { data: agents, error } = await supabase
    .from('agents')
    .select(`
      id,
      slug,
      name,
      status,
      consecutive_failures,
      endpoint_url,
      creator_id,
      created_at,
      updated_at,
      health_check,
      last_checked_at
    `)
    .order('status', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch creator profiles for display names
  const creatorIds = [...new Set((agents ?? []).map(a => a.creator_id).filter(Boolean))]
  let profiles: { id: string; username: string }[] = []
  if (creatorIds.length > 0) {
    const { data } = await supabase
      .from('creator_profiles')
      .select('id, username')
      .in('id', creatorIds)
    profiles = data ?? []
  }

  const profileMap = new Map(profiles.map(p => [p.id, p.username]))

  const enriched = (agents ?? []).map(a => ({
    ...a,
    creator_username: profileMap.get(a.creator_id) ?? null,
    // Mask endpoint_url — only show domain (HAL-028)
    endpoint_domain: a.endpoint_url ? new URL(a.endpoint_url).hostname : null,
    endpoint_url: undefined,
  }))

  const summary = {
    total: enriched.length,
    active: enriched.filter(a => a.status === 'active').length,
    reviewing: enriched.filter(a => a.status === 'reviewing').length,
    draft: enriched.filter(a => a.status === 'draft').length,
    suspended: enriched.filter(a => a.status === 'suspended').length,
  }

  return NextResponse.json({ summary, agents: enriched })
}
