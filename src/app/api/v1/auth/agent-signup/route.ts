import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getAgentSignupLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { generateApiKey } from '@/features/agent-api/services/agent-keys.service'
import { randomBytes, timingSafeEqual } from 'crypto'
import { env } from '@/lib/env'

const AgentSignupSchema = z.object({
  email: z.string().email('Invalid email format'),
})

export async function POST(request: NextRequest) {
  // 1. Auth check (BEFORE rate limit — don't consume slots for unauthenticated requests)
  // If AGENT_SIGNUP_KEY is not set, the endpoint is fully open (Option A)
  const signupKey = env.AGENT_SIGNUP_KEY
  if (signupKey && signupKey !== '') {
    const providedKey = request.headers.get('x-signup-key') ?? ''
    let keysMatch = false
    try {
      keysMatch = timingSafeEqual(
        Buffer.from(providedKey.padEnd(signupKey.length)),
        Buffer.from(signupKey),
      )
    } catch {
      keysMatch = false
    }
    if (!providedKey || !keysMatch) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
  }

  // 2. Rate limit check
  const identifier = getIdentifier(request)
  const rateLimitResponse = await checkRateLimit(getAgentSignupLimit(), identifier)
  if (rateLimitResponse) return rateLimitResponse

  // 3. Validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 422 })
  }

  const parsed = AgentSignupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 422 })
  }
  const { email } = parsed.data

  // 4. Create user via Service Role (email_confirm: true — no inbox needed)
  // Trigger on_auth_user_created auto-creates creator_profile
  const serviceClient = createServiceClient()
  const { data, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(32).toString('hex'),
  })

  if (createError) {
    if (
      createError.message?.includes('User already registered') ||
      createError.message?.includes('already been registered') ||
      createError.message?.toLowerCase().includes('already exists') ||
      createError.status === 422
    ) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    console.error('[agent-signup] createUser failed', { message: createError.message })
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }

  // 5. Generate and insert agent key (budget_usdc: 0 — agent must fund manually)
  const { raw, hash } = generateApiKey()
  const emailLocalPart = email.split('@')[0].slice(0, 50)

  const { error: keyError } = await serviceClient.from('agent_keys').insert({
    owner_id: data.user.id,
    name: `agent-${emailLocalPart}`,
    key_hash: hash,
    budget_usdc: 0,
    spent_usdc: 0,
    is_active: true,
  })

  if (keyError) {
    // Compensating transaction: delete user to avoid orphaned accounts
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(data.user.id)
    if (deleteError) {
      console.error('[agent-signup] ZOMBIE USER: deleteUser failed after keyError', {
        userId: data.user.id,
        deleteError: deleteError.message,
      })
    }
    return NextResponse.json({ error: 'Failed to create agent key' }, { status: 500 })
  }

  // 6. Return agent key — shown ONLY once, caller must store it
  return NextResponse.json(
    {
      agent_key: raw,
      agent_key_warning: 'Store this key securely. It will not be shown again.',
      user_id: data.user.id,
      next_steps: {
        register_agent: 'POST /api/v1/agents/register with x-agent-key header',
        docs: 'https://wasiai.io/docs/agents/register',
      },
    },
    { status: 201 },
  )
}
