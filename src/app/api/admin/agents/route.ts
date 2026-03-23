import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
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
      health_check (
        passed,
        status_code,
        latency_ms,
        checked_at
      )
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
