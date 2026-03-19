import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getAgentSignupLimit, getIdentifier } from '@/lib/ratelimit'

export async function POST(request: NextRequest) {
  // Rate limit: 5/hour per IP
  const identifier = getIdentifier(request)
  const rateLimitResponse = await checkRateLimit(getAgentSignupLimit(), identifier)
  if (rateLimitResponse) return rateLimitResponse

  const serviceClient = createServiceClient()

  // Get IP for session
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const { data: session, error } = await serviceClient
    .from('onboarding_sessions')
    .insert({ ip })
    .select('id')
    .single()

  if (error || !session) {
    console.error('[onboard/start] insert failed', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  return NextResponse.json(
    {
      session_id: session.id,
      next_url: `/api/v1/onboard/${session.id}`,
      step: 1,
      total_steps: 7,
      question: "What is your agent's name?",
      hint: 'Choose a descriptive name between 3 and 100 characters.',
    },
    { status: 201 },
  )
}
