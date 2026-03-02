/**
 * POST /api/v1/jobs/process/[id]
 * WAS-70 — Async Jobs API — procesar job en background
 *
 * Auth: service key (bypass RLS) + JOB_PROCESSOR_SECRET header
 * Ejecuta el agente externo y actualiza el job a 'completed' o 'failed'
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { triggerAgentEvent } from '@/lib/webhooks/triggerAgentEvent'

interface ProcessJobResponse {
  jobId: string
  status: 'completed' | 'failed'
  completedAt: string
}

interface JobRow {
  id: string
  user_id: string
  agent_slug: string
  status: string
  input: Record<string, unknown>
}

interface AgentRow {
  id: string
  endpoint_url: string
  user_id: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // [1] Verificar secret
  const authHeader = request.headers.get('authorization') ?? ''
  const expectedSecret = process.env.JOB_PROCESSOR_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const serviceClient = createServiceClient()

  // [2] Obtener job
  const { data: job, error: jobError } = await serviceClient
    .from('jobs')
    .select('id, user_id, agent_slug, status, input')
    .eq('id', id)
    .single<JobRow>()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // [3+4] Atomic claim: UPDATE WHERE status='pending' → previene doble-ejecución
  const { data: updated } = await serviceClient
    .from('jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'already_processing' }, { status: 409 })
  }

  // [5] Obtener agente
  const { data: agent, error: agentError } = await serviceClient
    .from('agents')
    .select('id, endpoint_url, user_id')
    .eq('slug', job.agent_slug)
    .single<AgentRow>()

  if (agentError || !agent) {
    const completedAt = new Date().toISOString()
    await serviceClient
      .from('jobs')
      .update({ status: 'failed', error: 'Agent not found', completed_at: completedAt, updated_at: completedAt })
      .eq('id', id)

    return NextResponse.json(
      { jobId: id, status: 'failed', completedAt } satisfies ProcessJobResponse,
      { status: 200 },
    )
  }

  // [6] Llamar al agente externo
  const timeoutMs = parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS ?? '8000', 10)
  let completedAt: string
  let responseJson: Record<string, unknown>
  let errorMessage: string

  try {
    const res = await fetch(agent.endpoint_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ input: job.input }),
      signal:  AbortSignal.timeout(timeoutMs),
    })

    if (res.ok) {
      completedAt  = new Date().toISOString()
      responseJson = await res.json() as Record<string, unknown>

      // [7a] Actualizar job como completed
      await serviceClient
        .from('jobs')
        .update({ status: 'completed', result: responseJson, completed_at: completedAt, updated_at: completedAt })
        .eq('id', id)

      // Webhook best-effort
      void triggerAgentEvent('job.completed', agent.id, agent.user_id, {
        job_id:       id,
        agent_slug:   job.agent_slug,
        user_id:      job.user_id,
        result:       responseJson,
        completed_at: completedAt,
      })

      return NextResponse.json(
        { jobId: id, status: 'completed', completedAt } satisfies ProcessJobResponse,
        { status: 200 },
      )
    }

    errorMessage = `Upstream ${res.status}`
  } catch (err) {
    errorMessage = err instanceof Error && err.name === 'TimeoutError'
      ? 'step_timeout'
      : `Upstream unreachable: ${String(err)}`
  }

  // [7b] Fallido
  completedAt = new Date().toISOString()
  await serviceClient
    .from('jobs')
    .update({ status: 'failed', error: errorMessage, completed_at: completedAt, updated_at: completedAt })
    .eq('id', id)

  // Webhook best-effort
  void triggerAgentEvent('job.failed', agent.id, agent.user_id, {
    job_id:     id,
    agent_slug: job.agent_slug,
    user_id:    job.user_id,
    error:      errorMessage,
    failed_at:  completedAt,
  })

  return NextResponse.json(
    { jobId: id, status: 'failed', completedAt } satisfies ProcessJobResponse,
    { status: 200 },
  )
}
