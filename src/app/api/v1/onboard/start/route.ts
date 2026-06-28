import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getAgentSignupLimit, getIdentifier } from '@/lib/ratelimit'
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  // Rate limit: 5/hour per IP
  const identifier = getIdentifier(request)
  const rateLimitResponse = await checkRateLimit(getAgentSignupLimit(), identifier)
  if (rateLimitResponse) return rateLimitResponse

  const serviceClient = createServiceClient()

  // Detect agent-key auth (returning creator registering additional agent)
  const agentKeyHeader = request.headers.get('x-agent-key')
  let ownerIdFromKey: string | null = null

  if (agentKeyHeader) {
    const keyHash = createHash('sha256').update(agentKeyHeader).digest('hex')
    const { data: keyRow } = await serviceClient
      .from('agent_keys')
      .select('owner_id')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()

    if (!keyRow) {
      return NextResponse.json({ error: 'Invalid or inactive agent key' }, { status: 401 })
    }
    ownerIdFromKey = keyRow.owner_id
  }

  // Get IP for session
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const sessionData = ownerIdFromKey ? { owner_id: ownerIdFromKey } : {}

  const { data: session, error } = await serviceClient
    .from('onboarding_sessions')
    .insert({ ip, data: sessionData })
    .select('id')
    .single()

  if (error || !session) {
    logger.error('[onboard/start] insert failed', { error })
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  return NextResponse.json(
    {
      session_id: session.id,
      next_url: `/api/v1/onboard/${session.id}`,
      step: 1,
      total_steps: ownerIdFromKey ? 7 : 8,
      question: "What is your agent's name?",
      hint: 'Choose a descriptive name between 3 and 100 characters.',
    },
    { status: 201 },
  )
}
