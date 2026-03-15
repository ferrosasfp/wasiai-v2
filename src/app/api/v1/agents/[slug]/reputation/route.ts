/**
 * GET /api/v1/agents/[slug]/reputation
 * WAS-185: Endpoint público de reputación pre-invocación
 * Absorbe WAS-195 (/trust) — endpoint unificado
 * No requiere auth. Rate limit: 60 req/min por IP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getClientIp } from '@/lib/get-client-ip'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Rate limiter local: 60 req/min por IP
// checkIpLimit de @/lib/rate-limit-ip usa ventana '1 d' hardcodeada — no sirve para 1 min
const reputationLimiter = new Ratelimit({
  redis:   Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  prefix:  'rl:reputation',
})

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** Calcula score 0-100 a partir de métricas operacionales */
function calcScore(params: {
  errorRate7d:  number | null
  p95Ms:        number | null
  disputeRate:  number
  isVerified:   boolean
}): number {
  const { errorRate7d, p95Ms, disputeRate, isVerified } = params

  // Error rate component (40%): 0% error = 40pts, 100% error = 0pts
  const errorComponent = errorRate7d !== null
    ? (1 - Math.min(errorRate7d / 100, 1)) * 40
    : 30 // valor neutral si no hay datos

  // Latency component (30%): <=200ms = 30pts, >=2000ms = 0pts
  const latencyScore = p95Ms !== null
    ? Math.max(0, 30 - (p95Ms / 2000) * 30)
    : 20 // valor neutral si no hay datos

  // Dispute rate component (20%): 0% = 20pts, 100% = 0pts
  const disputeComponent = (1 - Math.min(disputeRate, 1)) * 20

  // Verified bonus (10%)
  const verifiedBonus = isVerified ? 10 : 0

  return Math.round(Math.min(100, Math.max(0,
    errorComponent + latencyScore + disputeComponent + verifiedBonus
  )))
}

/** Calcula trend comparando error_rate últimos 7 días vs 7 días previos */
async function calcTrend(supabase: Awaited<ReturnType<typeof createClient>>, agentId: string): Promise<'improving' | 'stable' | 'declining'> {
  const { data } = await supabase
    .from('agent_calls')
    .select('status, created_at')
    .eq('agent_id', agentId)
    .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())

  if (!data || data.length < 5) return 'stable'

  const now = Date.now()
  const week1 = data.filter(c => new Date(c.created_at).getTime() > now - 7 * 86400_000)
  const week2 = data.filter(c => {
    const t = new Date(c.created_at).getTime()
    return t > now - 14 * 86400_000 && t <= now - 7 * 86400_000
  })

  if (week1.length < 3 || week2.length < 3) return 'stable'

  const rate1 = week1.filter(c => c.status === 'error').length / week1.length * 100
  const rate2 = week2.filter(c => c.status === 'error').length / week2.length * 100
  const delta = rate1 - rate2

  if (delta < -5) return 'improving'
  if (delta > 5)  return 'declining'
  return 'stable'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Rate limit: 60 req/min por IP (AC-10)
  const ip = getClientIp(req)
  const { success } = await reputationLimiter.limit(ip)
  if (!success) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', message: 'Too many requests' },
      { status: 429, headers: CORS }
    )
  }

  const { slug } = await params
  const supabase  = await createClient()

  // Fetch agent
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, total_calls, reputation_score, reputation_count, is_verified, last_health_check_ok, last_health_check_at, performance_score')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (error || !agent) {
    return NextResponse.json(
      { error: 'agent_not_found' },
      { status: 404, headers: CORS }
    )
  }

  // Métricas de percentil (WAS-183 prerequisito)
  const { data: metricsRaw } = await supabase
    .rpc('get_agent_percentile_metrics', { p_agent_id: agent.id })
    .single()
  const metrics = metricsRaw as {
    p50_latency_ms: number | null
    p95_latency_ms: number | null
    error_rate_7d: number | null
    error_rate_sample: number | null
  } | null

  // Última invocación
  const { data: lastCall } = await supabase
    .from('agent_calls')
    .select('created_at')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Trend (comparación 7d vs 7d previos)
  const trend = await calcTrend(supabase, agent.id)

  // is_available
  const isAvailable = agent.last_health_check_ok === true &&
    agent.last_health_check_at !== null &&
    new Date(agent.last_health_check_at).getTime() > Date.now() - 24 * 60 * 60 * 1000

  // Score
  const score = calcScore({
    errorRate7d:  metrics?.error_rate_7d ?? null,
    p95Ms:        metrics?.p95_latency_ms ?? null,
    disputeRate:  0, // dispute_rate = 0 hasta WAS-194/tabla agent_disputes
    isVerified:   agent.is_verified ?? false,
  })

  return NextResponse.json({
    score,
    p50_ms:                metrics?.p50_latency_ms   ?? null,
    p95_ms:                metrics?.p95_latency_ms   ?? null,
    error_rate_7d:         metrics?.error_rate_7d    ?? null,
    error_rate_sample_size: metrics?.error_rate_sample ?? null,
    trend,
    last_invocation_at:    lastCall?.created_at       ?? null,
    is_available:          isAvailable,
    is_verified:           agent.is_verified          ?? false,
    invocation_count:      agent.total_calls          ?? 0,
    dispute_rate:          0,   // placeholder — WAS-189 implementará tabla agent_disputes
    performance_score:     agent.performance_score    ?? null,  // WAS-213: 0-100, null si <5 calls
    reputation_score:      agent.reputation_score     ?? null,  // votos: 0.0-1.0
    reputation_count:      agent.reputation_count     ?? 0,     // número de votos
    erc8004_score:         agent.reputation_score     ?? null,  // WAS-199: normalizado 0-1 (= reputation_score)
    format_compliance_pct: null,  // placeholder — WAS-202
  }, { status: 200, headers: CORS })
}
