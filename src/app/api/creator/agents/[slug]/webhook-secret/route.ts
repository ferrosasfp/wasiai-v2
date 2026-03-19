/**
 * GET /api/creator/agents/[slug]/webhook-secret
 * Returns the webhook_secret for a creator's own agent.
 * WAS-078: Webhook Secret & Upstream Auth
 *
 * Auth: JWT required (createClient + getUser)
 * Ownership: creator_id must match authenticated user
 */
import { type NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const { data: agent } = await serviceClient
    .from('agents')
    .select('id, creator_id, webhook_secret')
    .eq('slug', slug)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (agent.creator_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ webhook_secret: agent.webhook_secret })
}
