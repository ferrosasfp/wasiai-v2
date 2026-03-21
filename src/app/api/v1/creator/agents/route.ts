/**
 * GET /api/v1/creator/agents
 *
 * Returns the list of agents owned by the authenticated creator.
 *
 * Auth options (one required):
 *   A) Bearer <supabase-jwt>  → user.id becomes creator_id
 *   B) x-agent-key: wasi_xxx → owner_id from agent_keys lookup
 *
 * Query params:
 *   ?status=active|paused  → filter by agent status (AC4)
 *
 * Response: { agents: [...], total: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const serviceClient = createServiceClient()

  // ── Auth ──────────────────────────────────────────────────────────────────
  let resolvedCreatorId: string | null = null

  const authHeader = request.headers.get('authorization')
  const agentKey   = request.headers.get('x-agent-key')

  if (authHeader?.startsWith('Bearer ')) {
    // JWT auth
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      resolvedCreatorId = user.id
    }
  } else if (agentKey) {
    // Agent key auth
    const hash = createHash('sha256').update(agentKey).digest('hex')
    const { data: validKey } = await serviceClient
      .from('agent_keys')
      .select('owner_id')
      .eq('key_hash', hash)
      .eq('is_active', true)
      .single()

    if (validKey) {
      resolvedCreatorId = validKey.owner_id
    }
  }

  if (!resolvedCreatorId) {
    return NextResponse.json(
      { error: 'Authentication required. Use Authorization: Bearer <jwt> or x-agent-key.' },
      { status: 401 },
    )
  }

  // ── Query ─────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')

  let query = serviceClient
    .from('agents')
    .select('slug, name, status, category, price_per_call, total_calls, total_revenue, created_at, endpoint_url, tags')
    .eq('creator_id', resolvedCreatorId)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  query = query.order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    agents: data ?? [],
    total:  (data ?? []).length,
  })
}
