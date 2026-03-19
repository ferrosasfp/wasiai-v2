/**
 * POST /api/creator/agents/[slug]/webhook-secret/rotate
 * Generates a new webhook_secret for a creator's own agent.
 * WAS-078: Webhook Secret & Upstream Auth
 *
 * Auth: JWT required (createClient + getUser)
 * CSRF: validated
 * Ownership: creator_id must match authenticated user
 */
import { type NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const { data: agent } = await serviceClient
    .from('agents')
    .select('id, creator_id')
    .eq('slug', slug)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (agent.creator_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const newSecret = 'whsec_' + randomBytes(32).toString('hex')

  const { error } = await serviceClient
    .from('agents')
    .update({ webhook_secret: newSecret, updated_at: new Date().toISOString() })
    .eq('id', agent.id)

  if (error) return NextResponse.json({ error: 'Failed to rotate secret' }, { status: 500 })

  return NextResponse.json({
    webhook_secret: newSecret,
    rotated_at: new Date().toISOString(),
  })
}
