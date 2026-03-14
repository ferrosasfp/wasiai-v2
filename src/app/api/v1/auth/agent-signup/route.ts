import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getAgentSignupLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { generateApiKey } from '@/features/agent-api/services/agent-keys.service'
import { randomBytes } from 'crypto'
import { env } from '@/lib/env'

const AgentSignupSchema = z.object({
  email: z.string().email('Invalid email format'),
})

export async function POST(request: NextRequest) {
  // 1. Rate limit check
  const identifier = getIdentifier(request)
  const rateLimitResponse = await checkRateLimit(getAgentSignupLimit(), identifier)
  if (rateLimitResponse) return rateLimitResponse

  // 2. Auth check
  const signupKey = env.AGENT_SIGNUP_KEY
  if (signupKey && signupKey !== '') {
    const providedKey = request.headers.get('x-signup-key')
    if (!providedKey || providedKey !== signupKey) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
  }

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

  // 4. Create user
  const serviceClient = createServiceClient()
  const { data, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(32).toString('hex'),
  })

  if (createError) {
    if (createError.message?.includes('User already registered')) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  // 5. Generate and insert agent key
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
    // Compensating transaction
    await serviceClient.auth.admin.deleteUser(data.user.id)
    return NextResponse.json({ error: 'Failed to create agent key' }, { status: 500 })
  }

  // 6. Return 201
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
