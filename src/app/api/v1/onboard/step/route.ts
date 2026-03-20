import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { generateApiKey } from '@/features/agent-api/services/agent-keys.service'
import { randomBytes } from 'crypto'
import { CHAIN_NAME } from '@/lib/chain'

const QUESTIONS: Record<number, { question: string; hint: string }> = {
  1: { question: "What is your agent's name?", hint: 'Choose a descriptive name between 3 and 100 characters.' },
  2: { question: 'Describe your agent.', hint: 'Max 500 characters. What does it do?' },
  3: { question: "What is your agent's endpoint URL?", hint: 'A publicly reachable HTTPS URL that accepts POST requests.' },
  4: { question: 'What category does your agent belong to?', hint: 'e.g. defi, nlp, vision, code, data, security' },
  5: { question: 'What is your price per call (in USDC)?', hint: 'A number between 0.001 and 100.' },
  6: { question: 'Add tags for your agent (optional).', hint: 'Comma-separated list of tags, or type "skip" to continue.' },
  7: { question: 'What is your email address?', hint: 'We will create your creator account and generate your API key.' },
}

function generateSlug(name: string, suffix?: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 76)
  return suffix ? `${base}-${suffix}` : base
}

export async function processOnboardStep(session_id: string, answer: unknown): Promise<NextResponse> {
  const serviceClient = createServiceClient()

  // Fetch session — must not be expired
  const { data: session, error: sessionError } = await serviceClient
    .from('onboarding_sessions')
    .select('*')
    .eq('id', session_id)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 })
  }

  if (session.status === 'completed') {
    return NextResponse.json({ error: 'Session already completed' }, { status: 409 })
  }

  const step: number = session.current_step
  const data: Record<string, unknown> = session.data ?? {}

  // Validate answer per step
  switch (step) {
    case 1: {
      if (typeof answer !== 'string' || answer.trim().length < 3 || answer.trim().length > 100) {
        return NextResponse.json({ error: 'Name must be between 3 and 100 characters' }, { status: 400 })
      }
      data.name = answer.trim()
      break
    }
    case 2: {
      if (typeof answer !== 'string' || answer.trim().length > 500) {
        return NextResponse.json({ error: 'Description must be max 500 characters' }, { status: 400 })
      }
      data.description = answer.trim()
      break
    }
    case 3: {
      if (typeof answer !== 'string') {
        return NextResponse.json({ error: 'endpoint_url must be a string' }, { status: 400 })
      }
      try {
        await validateEndpointUrlAsync(answer)
      } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 })
      }
      // Inline ping
      let pingOk = false
      let pingError: string | undefined
      try {
        const res = await fetch(answer, { signal: AbortSignal.timeout(5000) })
        pingOk = res.ok
        if (!res.ok) pingError = `Endpoint returned HTTP ${res.status}`
      } catch (err) {
        pingError = err instanceof Error ? err.message : 'Endpoint unreachable'
      }
      data.endpoint_url = answer
      if (!pingOk) {
        // Advance step but warn
        await serviceClient
          .from('onboarding_sessions')
          .update({ current_step: step + 1, data })
          .eq('id', session_id)
        return NextResponse.json({
          step: step + 1,
          warning: `Endpoint ping failed: ${pingError}. You can still continue.`,
          ...QUESTIONS[step + 1],
        })
      }
      break
    }
    case 4: {
      if (typeof answer !== 'string') {
        return NextResponse.json({ error: 'Category must be a string' }, { status: 400 })
      }
      const { data: cats, error: dbError } = await serviceClient
        .from('agent_categories')
        .select('slug')
        .eq('is_active', true)

      if (dbError) {
        console.error('[onboard/step4] agent_categories query failed', dbError)
        return NextResponse.json(
          { error: 'Unable to load categories. Please try again later.' },
          { status: 503 }
        )
      }

      const validSlugs = (cats ?? []).map((c: { slug: string }) => c.slug)
      if (validSlugs.length === 0) {
        return NextResponse.json(
          { error: 'No active categories available. Please contact support.' },
          { status: 500 }
        )
      }
      if (!validSlugs.includes(answer)) {
        return NextResponse.json(
          { error: `Category must be one of: ${validSlugs.join(', ')}` },
          { status: 400 },
        )
      }
      data.category = answer
      break
    }
    case 5: {
      const num = typeof answer === 'number' ? answer : parseFloat(String(answer))
      if (isNaN(num) || num < 0.001 || num > 100) {
        return NextResponse.json({ error: 'price_per_call must be between 0.001 and 100' }, { status: 400 })
      }
      data.price_per_call = num
      break
    }
    case 6: {
      if (answer === 'skip' || (typeof answer === 'string' && answer.trim() === '')) {
        data.tags = []
      } else if (typeof answer === 'string') {
        data.tags = answer.split(',').map((t) => t.trim()).filter(Boolean)
      } else if (Array.isArray(answer)) {
        data.tags = answer
      } else {
        return NextResponse.json({ error: 'tags must be a comma-separated string, array, or "skip"' }, { status: 400 })
      }
      break
    }
    case 7: {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (typeof answer !== 'string' || !emailRegex.test(answer)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
      }

      // Create user via Supabase admin
      const { data: userData, error: createError } = await serviceClient.auth.admin.createUser({
        email: answer,
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
        console.error('[onboard/step7] createUser failed', createError)
        return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
      }

      // Generate API key
      const { raw, hash } = generateApiKey()

      const { error: keyError } = await serviceClient.from('agent_keys').insert({
        owner_id: userData.user.id,
        name: 'wizard-agent',
        key_hash: hash,
        budget_usdc: 0,
        spent_usdc: 0,
        is_active: true,
      })

      if (keyError) {
        // Compensating: delete user
        await serviceClient.auth.admin.deleteUser(userData.user.id).catch((e) =>
          console.error('[onboard/step7] ZOMBIE USER cleanup failed', e),
        )
        return NextResponse.json({ error: 'Failed to create agent key' }, { status: 500 })
      }

      // Register agent — slug collision handled with random suffix
      const name = String(data.name ?? 'Unnamed Agent')
      let slug = generateSlug(name)

      // Check slug availability and resolve collision (F2 fix)
      const { data: existing } = await serviceClient.from('agents').select('id').eq('slug', slug).single()
      if (existing) {
        slug = generateSlug(name, randomBytes(3).toString('hex'))
      }

      // WAS-250: webhook_secret is NOT NULL — must be generated at insert time
      const webhookSecret = 'whsec_' + randomBytes(32).toString('hex')

      const { data: agent, error: agentError } = await serviceClient
        .from('agents')
        .insert({
          name,
          slug,
          description: data.description ?? null,
          category: data.category ?? 'nlp',
          price_per_call: data.price_per_call ?? 0.001,
          currency: 'USDC',
          chain: CHAIN_NAME,
          endpoint_url: data.endpoint_url ?? null,
          tags: data.tags ?? [],
          status: 'active',
          is_featured: false,
          creator_id: userData.user.id,
          registration_type: 'off_chain',
          mcp_tool_name: slug.replace(/-/g, '_'),
          webhook_secret: webhookSecret,
          metadata: { registered_via: 'onboarding_wizard' },
        })
        .select('id, slug')
        .single()

      // F1 fix: agent insert failure is fatal — rollback user+key and return error
      if (agentError || !agent) {
        console.error('[onboard/step7] agent insert failed — rolling back', agentError)
        await serviceClient.from('agent_keys').delete().eq('key_hash', hash)
        await serviceClient.auth.admin.deleteUser(userData.user.id).catch((e) =>
          console.error('[onboard/step7] ZOMBIE USER cleanup failed', e),
        )
        return NextResponse.json({ error: 'Failed to register agent. Please try again.' }, { status: 500 })
      }

      const finalSlug = agent.slug

      // Mark session completed
      await serviceClient
        .from('onboarding_sessions')
        .update({ status: 'completed', data })
        .eq('id', session_id)

      return NextResponse.json({
        completed: true,
        agent_key: raw,
        agent_key_warning: 'Store this key securely. It will not be shown again.',
        slug: finalSlug,
        status: 'active',
        status_message: 'Your agent is now live on the marketplace.',
        agent_url: `https://app.wasiai.io/en/models/${finalSlug}`,
        dashboard_url: `https://app.wasiai.io/en/dashboard`,
      })
    }
    default:
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  }

  // Advance step
  const nextStep = step + 1
  await serviceClient
    .from('onboarding_sessions')
    .update({ current_step: nextStep, data })
    .eq('id', session_id)

  const nextQ = QUESTIONS[nextStep]
  return NextResponse.json({
    step: nextStep,
    ...(nextQ ?? { question: 'Done', hint: '' }),
  })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { session_id, answer } = body as { session_id?: string; answer?: unknown }

  if (!session_id) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  if (answer === null || answer === undefined) {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 })
  }

  return processOnboardStep(session_id, answer)
}
