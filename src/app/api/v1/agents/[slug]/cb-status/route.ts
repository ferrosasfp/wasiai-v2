import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getState } from '@/lib/circuit-breaker/CircuitBreaker'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // 1. Verificar sesión
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Verificar ownership del agente
  const serviceClient = createServiceClient()
  const { data: agent } = await serviceClient
    .from('agents')
    .select('user_id')
    .eq('slug', slug)
    .single()

  // Si el agente no existe o no pertenece al usuario, devolver estado default (sin 404)
  if (!agent || agent.user_id !== user.id) {
    return NextResponse.json({ state: 'closed', failures: 0 })
  }

  // 3. Leer estado CB
  const state = await getState(slug)
  const failures = await redis.get<number>(`cb:provider:${slug}:failures`) ?? 0

  return NextResponse.json({ state, failures })
}
