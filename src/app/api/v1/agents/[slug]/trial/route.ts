/**
 * GET  /api/v1/agents/[slug]/trial — Check if user already used their trial
 * POST /api/v1/agents/[slug]/trial — Use 1 free trial call (1 per user/agent lifetime)
 *
 * HU-3.1: Free Trial
 * Rate limit: 3 req/hour per IP (Upstash sliding window)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { z } from 'zod'
import { checkIpLimit } from '@/lib/rate-limit-ip'

const BodySchema = z.object({ input: z.string().min(1).max(2000) })

// Lazy singleton — 3 req/hour per IP
let _trialLimit: Ratelimit | null = null
function getTrialLimit(): Ratelimit {
  return (_trialLimit ??= new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(3, '1 h'),
    prefix: 'wasiai:trial',
  }))
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Anonymous: return generic trial info (no usage tracking)
    return NextResponse.json({
      used: false,
      trialsUsed: 0,
      trialsRemaining: 3,
      limit: 3,
      usedAt: null,
      anonymous: true,
    })
  }

  const svc = createServiceClient()
  const { data: agent } = await svc
    .from('agents')
    .select('id, free_trial_enabled, free_trial_limit')   // HU-3.3
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // HU-3.3: Guard — creator desactivó el trial
  if (!agent.free_trial_enabled) {
    return NextResponse.json(
      { error: 'trial_disabled', message: 'Free trial not available for this agent.' },
      { status: 403 },
    )
  }

  const { data: trial } = await svc
    .from('agent_trials')
    .select('times_used, used_at')   // HU-3.3: añadir times_used
    .eq('user_id', user.id)
    .eq('agent_id', agent.id)
    .single()

  const timesUsed       = trial?.times_used ?? 0
  const trialsRemaining = Math.max(0, agent.free_trial_limit - timesUsed)

  return NextResponse.json({
    used:            timesUsed >= agent.free_trial_limit,
    trialsUsed:      timesUsed,
    trialsRemaining,
    limit:           agent.free_trial_limit,
    usedAt:          trial?.used_at ?? null,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // 1. Auth (optional — anonymous allowed)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAnonymous = !user

  // 2. Rate limit por IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'

  if (isAnonymous) {
    // Anonymous: 3 calls per agent per IP per day (reuses 058 infra)
    const { success } = await checkIpLimit(ip, `trial-anon:${slug}`, 3)
    if (!success) {
      return NextResponse.json({
        error: 'anon_rate_limited',
        code: 'anon_trial_limited',
        limit: 3,
        message: 'Crea una cuenta gratuita para seguir probando',
      }, { status: 429 })
    }
  } else {
    const { success } = await getTrialLimit().limit(`ip:${ip}`)
    if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // 3. Validate body
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  const { input } = parsed.data

  // 4. Buscar agente
  const svc = createServiceClient()
  const { data: agent } = await svc
    .from('agents')
    .select('id, endpoint_url, name, free_trial_enabled, free_trial_limit')  // HU-3.3
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // HU-3.3: Guard — creator desactivó el trial
  if (!agent.free_trial_enabled) {
    return NextResponse.json(
      { error: 'trial_disabled', message: 'Free trial not available for this agent.' },
      { status: 403 },
    )
  }

  // 5. SSRF check
  try {
    validateEndpointUrl(agent.endpoint_url ?? '')
  } catch {
    return NextResponse.json({ error: 'invalid_endpoint' }, { status: 400 })
  }

  // 6-7. Trial usage tracking (authenticated only — anonymous tracked by IP rate limit)
  if (!isAnonymous) {
    const { data: result } = await svc.rpc('use_trial', {
      p_user_id:  user!.id,
      p_agent_id: agent.id,
      p_limit:    agent.free_trial_limit,
    })
    if (result === -1) {
      return NextResponse.json({ error: 'trial_exhausted', limit: agent.free_trial_limit }, { status: 409 })
    }
  }

  // 8. Llamar al agente con timeout de 8s
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const t0 = Date.now()
  let statusCode = 0
  let output = ''

  try {
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' }

    const agentRes = await fetch(agent.endpoint_url as string, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({ input }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    statusCode = agentRes.status

    if (statusCode >= 400) {
      await logTrialCall(svc, agent.id, statusCode, Date.now() - t0)
      return NextResponse.json({ error: 'agent_error', hint: 'El agente retornó error' }, { status: 502 })
    }

    // Truncar output a 10KB para evitar respuestas masivas
    const raw = await agentRes.text()
    output = raw.length > 10240 ? raw.slice(0, 10240) + '\n[Output truncado]' : raw
  } catch (err) {
    clearTimeout(timeout)
    const isTimeout = (err as Error).name === 'AbortError'
    statusCode = isTimeout ? 504 : 502
    await logTrialCall(svc, agent.id, statusCode, Date.now() - t0)
    if (isTimeout) return NextResponse.json({ error: 'timeout' }, { status: 504 })
    return NextResponse.json({ error: 'agent_error', hint: 'El agente no fue alcanzable' }, { status: 502 })
  }

  const latencyMs = Date.now() - t0
  await logTrialCall(svc, agent.id, statusCode, latencyMs)

  return NextResponse.json({ output, latencyMs })
}

async function logTrialCall(
  svc: ReturnType<typeof createServiceClient>,
  agentId: string,
  statusCode: number,
  durationMs: number
): Promise<void> {
  // Map to actual agent_calls column names
  const status = statusCode >= 400 ? 'error' : 'success'
  await svc.from('agent_calls').insert({
    agent_id: agentId,
    status,
    latency_ms: durationMs,
    is_trial: true,
  })
}
