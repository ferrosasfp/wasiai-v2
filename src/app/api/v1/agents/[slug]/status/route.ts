import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const agentKey = request.headers.get('x-agent-key')
  if (!agentKey) {
    return NextResponse.json({ error: 'Missing x-agent-key header' }, { status: 401 })
  }

  const serviceClient = createServiceClient()

  // Hash SHA256 of the key → lookup in agent_keys
  const hash = createHash('sha256').update(agentKey).digest('hex')
  const { data: keyRecord } = await serviceClient
    .from('agent_keys')
    .select('id, owner_id, is_active')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .single()

  if (!keyRecord) {
    return NextResponse.json({ error: 'Invalid or inactive agent key' }, { status: 401 })
  }

  const { slug } = await params

  // Lookup agent by slug
  const { data: agent } = await serviceClient
    .from('agents')
    .select('id, slug, status, health_check, last_checked_at, creator_id')
    .eq('slug', slug)
    .single()

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Ownership check
  if (keyRecord.owner_id !== agent.creator_id) {
    return NextResponse.json({ error: 'Unauthorized: key does not own this agent' }, { status: 401 })
  }

  const response: Record<string, unknown> = {
    slug: agent.slug,
    status: agent.status,
    health_check: agent.health_check ?? null,
    last_checked_at: agent.last_checked_at ?? null,
  }

  if (agent.status === 'reviewing') {
    response.next_step =
      'Your endpoint is being verified or failed verification. Update via PATCH /api/creator/agents/:slug with a valid endpoint_url to re-trigger the health check.'
  }

  return NextResponse.json(response, { status: 200 })
}
