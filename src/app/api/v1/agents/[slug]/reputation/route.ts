/**
 * GET /api/v1/agents/[slug]/reputation
 * WAS-185: Endpoint público de reputación pre-invocación
 * Absorbe WAS-195 (/trust) — endpoint unificado
 * No requiere auth. Rate limit: 60 req/min por IP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
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

/** Calcula score 0-100 a partir de métricas operacionales (WAS-188: ponderación diferenciada) */
function calcScore(params: {
  errorRate7d:       number | null
  p95Ms:             number | null
  disputeRate:       number
  isVerified:        boolean
  reputationScore:   number | null  // votos raw 0-1 (NO se modifica)
  paidRatio:         number         // (x402 + key) / totalCalls
  totalCalls:        number
}): { score: number; signalWeights: { paid_ratio: number; votes_boost: number; model: string } } {
  const { errorRate7d, p95Ms, disputeRate, isVerified, reputationScore, paidRatio, totalCalls } = params

  // Error rate component (35%): 0% error = 35pts, 100% error = 0pts
  const errorComponent = errorRate7d !== null
    ? (1 - Math.min(errorRate7d / 100, 1)) * 35
    : 26.25 // valor neutral si no hay datos (35 * 0.75)

  // Latency component (25%): <=200ms = 25pts, >=2000ms = 0pts
  const latencyScore = p95Ms !== null
    ? Math.max(0, 25 - (p95Ms / 2000) * 25)
    : 16.67 // valor neutral si no hay datos

  // Dispute rate component (20%): 0% = 20pts, 100% = 0pts
  const disputeComponent = (1 - Math.min(disputeRate, 1)) * 20

  // Verified bonus (10%)
  const verifiedBonus = isVerified ? 10 : 0

  // Votes weighted component (10%) — WAS-188
  // Si totalCalls < 5, no penalizar agentes nuevos (votesBoost = 1.0)
  const votesBoost = totalCalls >= 5 && paidRatio > 0.5 ? 1.2 : 1.0
  const votesComponent = Math.min(10, (reputationScore ?? 0.5) * 10 * votesBoost)

  const score = Math.round(Math.min(100, Math.max(0,
    errorComponent + latencyScore + disputeComponent + verifiedBonus + votesComponent
  )))

  return {
    score,
    signalWeights: {
      paid_ratio:  paidRatio,
      votes_boost: votesBoost,
      model:       'v2-weighted',
    },
  }
}

/** Calcula trend comparando error_rate últimos 7 días vs 7 días previos */
async function calcTrend(supabase: Awaited<ReturnType<typeof createClient>>, agentId: string): Promise<'improving' | 'stable' | 'declining'> {
  const { data } = await supabase
    .from('agent_calls')
    .select('status, called_at')
    .eq('agent_id', agentId)
    .gte('called_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())

  if (!data || data.length < 5) return 'stable'

  const now = Date.now()
  const week1 = data.filter(c => new Date(c.called_at).getTime() > now - 7 * 86400_000)
  const week2 = data.filter(c => {
    const t = new Date(c.called_at).getTime()
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
    .select('id, total_calls, reputation_score, reputation_count, is_verified, health_check, last_checked_at, performance_score')
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

  // Última invocación — serviceClient para bypass RLS (agent_calls solo visible con service role)
  const serviceClient = createServiceClient()

  // Leer ventana de disponibilidad desde app_settings (WAS-245)
  const { data: windowSetting } = await serviceClient
    .from('app_settings')
    .select('value')
    .eq('key', 'agent_available_window_days')
    .single()
  const availableWindowDays = Math.max(1, parseInt(windowSetting?.value ?? '7', 10) || 7)
  const availableWindowMs = availableWindowDays * 24 * 60 * 60 * 1000

  const { data: lastCall } = await serviceClient
    .from('agent_calls')
    .select('called_at')
    .eq('agent_id', agent.id)
    .order('called_at', { ascending: false })
    .limit(1)
    .single()

  // Señal de disponibilidad: calls exitosas en ventana configurable (WAS-245)
  const { data: recentCalls } = await serviceClient
    .from('agent_calls')
    .select('status')
    .eq('agent_id', agent.id)
    .gte('called_at', new Date(Date.now() - availableWindowMs).toISOString())

  const hasRecentActivity = (recentCalls ?? []).some(c => c.status === 'success')

  // Breakdown de tipos de invocación últimos 30 días (WAS-188) — usa called_at (idx_agent_calls_agent_called_at)
  const { data: callsBreakdown } = await supabase
    .from('agent_calls')
    .select('payment_type, is_trial')
    .eq('agent_id', agent.id)
    .gte('called_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  const totalCalls30d  = callsBreakdown?.length ?? 0
  const paidCount      = callsBreakdown?.filter(c => c.payment_type === 'x402').length ?? 0
  const keyCount       = callsBreakdown?.filter(c => c.payment_type === 'key').length ?? 0
  const trialCount     = callsBreakdown?.filter(c => c.is_trial === true).length ?? 0
  // WAS-188 BUG-02 fix: weighted ratio (x402=3, key=2, trial=1) instead of flat ratio
  const weightedTotal    = paidCount * 3 + keyCount * 2 + trialCount * 1
  const weightedPaidRatio = totalCalls30d > 0
    ? (paidCount * 3 + keyCount * 2) / Math.max(1, weightedTotal)
    : 0
  const paidRatio = weightedPaidRatio

  // Trend (comparación 7d vs 7d previos)
  const trend = await calcTrend(supabase, agent.id)

  // is_available
  // health_check JSONB (migración 057) — legacy columns last_health_check_ok/at no existen en prod
  const healthCheck = agent.health_check as { passed?: boolean } | null

  // Primary signal: health_check cron result (cuando el cron ha corrido)
  const healthCheckPassed = healthCheck?.passed === true &&
    agent.last_checked_at !== null &&
    new Date(agent.last_checked_at as string).getTime() > Date.now() - availableWindowMs

  // Secondary signal: hasRecentActivity already calculated from 24h query above

  // Explicit health_check failure overrides all other signals
  const healthCheckFailed = healthCheck?.passed === false

  const isAvailable = !healthCheckFailed && (healthCheckPassed || hasRecentActivity)

  // Score (WAS-188: ponderación diferenciada v2-weighted)
  const { score, signalWeights } = calcScore({
    errorRate7d:      metrics?.error_rate_7d ?? null,
    p95Ms:            metrics?.p95_latency_ms ?? null,
    disputeRate:      0, // dispute_rate = 0 hasta WAS-194/tabla agent_disputes
    isVerified:       agent.is_verified ?? false,
    reputationScore:  agent.reputation_score ?? null,
    paidRatio,
    totalCalls:       totalCalls30d,
  })

  return NextResponse.json({
    score,
    p50_ms:                metrics?.p50_latency_ms   ?? null,
    p95_ms:                metrics?.p95_latency_ms   ?? null,
    error_rate_7d:         metrics?.error_rate_7d    ?? null,
    error_rate_sample_size: metrics?.error_rate_sample ?? null,
    trend,
    last_invocation_at:    lastCall?.called_at        ?? null,
    is_available:          isAvailable,
    is_verified:           agent.is_verified          ?? false,
    invocation_count:      agent.total_calls          ?? 0,
    dispute_rate:          0,   // placeholder — WAS-189 implementará tabla agent_disputes
    performance_score:     agent.performance_score    ?? null,  // WAS-213: 0-100, null si <5 calls
    reputation_score:      agent.reputation_score     ?? null,  // votos: 0.0-1.0 (NO modificado — fuente on-chain)
    reputation_count:      agent.reputation_count     ?? 0,     // número de votos
    erc8004_score:         agent.reputation_score     ?? null,  // WAS-199: normalizado 0-1 (= reputation_score)
    format_compliance_pct: null,  // placeholder — WAS-202
    signal_weights:        signalWeights,             // WAS-188: metadata de ponderación
  }, { status: 200, headers: CORS })
}
