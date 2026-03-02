/**
 * POST /api/v1/jobs
 * WAS-70 — Async Jobs API
 *
 * Inserta un job en Supabase y retorna el jobId de inmediato.
 * El procesamiento ocurre non-blocking (processJobAsync sin await).
 *
 * KNOWN LIMITATION: processJobAsync puede ser cortado por Vercel antes de
 * completarse si el request termina. Jobs colgados se limpian via
 * POST /api/v1/admin/jobs/cleanup (cron cada 10 min).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deliverWebhook } from '@/lib/webhooks/deliverWebhook'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { agent_slug, input } = body as { agent_slug?: string; input?: unknown }

  if (!agent_slug) {
    return NextResponse.json({ error: 'agent_slug required' }, { status: 400 })
  }

  // Insertar job con estado inicial 'pending'
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({ user_id: user.id, agent_slug, input: input ?? null, status: 'pending' })
    .select('id, status, created_at')
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create job' }, { status: 500 })
  }

  // Non-blocking: no await — known limitation bajo Vercel serverless
  processJobAsync(job.id as string, agent_slug, input, user.id, supabase).catch(console.error)

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    createdAt: job.created_at,
  })
}

async function processJobAsync(
  jobId: string,
  agentSlug: string,
  input: unknown,
  userId: string,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await supabase
      .from('jobs')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', jobId)

    // TODO: conectar lógica real de invocación del agente aquí
    // Placeholder — retorna output genérico hasta que se integre invoke
    const result = {
      output: 'placeholder — connect to agent invoke logic',
      agent_slug: agentSlug,
      input,
    }

    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        result,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    // Fire-and-forget: disparar webhooks job.completed sin bloquear
    fireJobWebhooks(supabase, userId, jobId, agentSlug, 'job.completed', { result }).catch(console.error)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await supabase
      .from('jobs')
      .update({
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    // Fire-and-forget: disparar webhooks job.failed sin bloquear
    fireJobWebhooks(supabase, userId, jobId, agentSlug, 'job.failed', { error: message }).catch(console.error)
  }
}

/**
 * Busca webhooks activos del usuario suscritos al evento y los entrega.
 * Guarda cada delivery en webhook_deliveries.
 * Diseñado para uso fire-and-forget.
 */
async function fireJobWebhooks(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  agentSlug: string,
  event: 'job.completed' | 'job.failed',
  extraData: Record<string, unknown>,
): Promise<void> {
  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', [event])

  if (error || !webhooks?.length) return

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data: {
      jobId,
      agentSlug,
      ...extraData,
    },
  }

  await Promise.allSettled(
    webhooks.map(async (wh) => {
      const result = await deliverWebhook(wh.url as string, wh.secret as string, payload)
      await supabase.from('webhook_deliveries').insert({
        webhook_id: wh.id,
        event: payload.event,
        payload,
        status_code: result.statusCode ?? null,
        success: result.success,
      })
    })
  )
}
