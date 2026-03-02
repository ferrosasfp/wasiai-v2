/**
 * POST /api/v1/jobs
 * WAS-70 — Async Jobs API — crear job asíncrono
 *
 * Auth: usuario autenticado via sesión (createClient)
 * Crea un job con status = 'pending' para ser procesado por process/[id]
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Ratelimit } from '@upstash/ratelimit'
import { getSharedRedis, checkRateLimit } from '@/lib/ratelimit'

// 10 jobs/min por usuario — sliding window
let _jobsLimit: Ratelimit | null = null
function getJobsLimit(): Ratelimit {
  return _jobsLimit ??= new Ratelimit({
    redis:   getSharedRedis(),
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix:  'rl:jobs',
  })
}

interface CreateJobRequest {
  agent_slug: string
  input: Record<string, unknown>
}

interface CreateJobResponse {
  jobId: string
  status: 'pending'
  createdAt: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()

  // [1] Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // [2] Rate limit — 10 jobs/min por usuario
  const rlHit = await checkRateLimit(getJobsLimit(), `user:${user.id}`)
  if (rlHit) return rlHit

  // [3-orig] Parse body
  let body: CreateJobRequest
  try {
    body = await request.json() as CreateJobRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.agent_slug || body.input === undefined || body.input === null) {
    return NextResponse.json({ error: 'agent_slug and input are required' }, { status: 400 })
  }

  // [4-orig] Verificar agente activo
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id, status')
    .eq('slug', body.agent_slug)
    .single()

  if (agentError || !agent || agent.status !== 'active') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // [4] Insertar job
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert({
      user_id:    user.id,
      agent_slug: body.agent_slug,
      input:      body.input,
      status:     'pending',
    })
    .select('id, created_at')
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }

  // [5] Retornar 201
  return NextResponse.json(
    {
      jobId:     job.id,
      status:    'pending',
      createdAt: job.created_at,
    } satisfies CreateJobResponse,
    { status: 201 },
  )
}
