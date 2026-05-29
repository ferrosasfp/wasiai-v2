import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'

async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request, 'listAgents')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

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
