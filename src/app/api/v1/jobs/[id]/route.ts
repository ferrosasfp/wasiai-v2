/**
 * GET /api/v1/jobs/:id
 * WAS-70 — Async Jobs API — polling endpoint
 *
 * Retorna el estado actual de un job del usuario autenticado.
 * RLS en Supabase garantiza que solo el owner puede consultar su job.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, status, result, error, created_at, updated_at, completed_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({
    jobId:       job.id,
    status:      job.status,
    ...(job.result      !== null && job.result      !== undefined ? { result: job.result }           : {}),
    ...(job.error       !== null && job.error       !== undefined ? { error: job.error }             : {}),
    createdAt:   job.created_at,
    updatedAt:   job.updated_at,
    ...(job.completed_at !== null && job.completed_at !== undefined ? { completedAt: job.completed_at } : {}),
  })
}
