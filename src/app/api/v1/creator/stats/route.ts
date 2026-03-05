/**
 * GET /api/v1/creator/stats
 * Returns creator summary stats. Auth via x-agent-key header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const agentKey = request.headers.get('x-agent-key')

  if (!agentKey) {
    return NextResponse.json(
      { error: 'Missing x-agent-key header' },
      { status: 401 },
    )
  }

  const supabase = await createClient()

  // Lookup key → creator
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('creator_id')
    .eq('api_key', agentKey)
    .eq('is_active', true)
    .single()

  if (!keyRow) {
    return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 })
  }

  const creatorId = keyRow.creator_id

  // Aggregate stats for this creator
  const { data: agents } = await supabase
    .from('agents')
    .select('id, total_calls, total_revenue')
    .eq('creator_id', creatorId)
    .eq('status', 'active')

  const agentList = agents ?? []
  const stats = {
    agent_count: agentList.length,
    total_calls: agentList.reduce((sum, a) => sum + (a.total_calls ?? 0), 0),
    total_revenue: agentList.reduce((sum, a) => sum + parseFloat(String(a.total_revenue ?? 0)), 0),
    agents: agentList.map(a => ({
      id: a.id,
      total_calls: a.total_calls ?? 0,
      total_revenue: parseFloat(String(a.total_revenue ?? 0)),
    })),
  }

  return NextResponse.json(stats)
}
