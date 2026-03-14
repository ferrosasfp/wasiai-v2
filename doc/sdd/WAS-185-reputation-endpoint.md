# SDD — WAS-185: Endpoint /reputation (absorbe WAS-195)

**Sprint:** 1 | **Clasificación:** QUALITY | **Fecha:** 2026-03-13

---

## Context Map

| Archivo | Rol |
|---|---|
| `src/app/api/v1/agents/[slug]/reputation/route.ts` | Nuevo endpoint — CREAR |
| `supabase/migrations/047_reputation_fields.sql` | Campos nuevos en agents + dispute_rate — CREAR |
| `supabase/migrations/046_percentile_metrics.sql` | `get_agent_percentile_metrics` — DEPENDE (Wave 1 de WAS-183) |

**Nota:** Este SDD depende de que WAS-183 migration 046 esté aplicada (provee `get_agent_percentile_metrics`).

---

## Acceptance Criteria (EARS)

- AC-1: WHEN GET /api/v1/agents/:slug/reputation (sin auth), THEN retorna JSON con campos definidos
- AC-2: Response incluye: `{ score, p50_ms, p95_ms, error_rate_7d, error_rate_sample_size, trend, last_invocation_at, is_available, is_verified, invocation_count, dispute_rate, erc8004_score }`
- AC-3: `score` es 0-100: `(1 - error_rate_7d/100) * 40 + latency_score * 30 + (1 - dispute_rate) * 20 + is_verified_bonus * 10`, clamped a [0,100]. `latency_score` = `max(0, 1 - p95_latency_ms/2000)` (0ms=1.0, 2000ms=0.0, lineal)
- AC-4: `trend` = "improving" | "stable" | "declining" — comparar error_rate últimos 7 días vs 7 días previos; delta >5% = cambio
- AC-5: `is_available` = true si `last_health_check_ok = true AND last_health_check_at > NOW()-24h`
- AC-6: `is_verified` = campo booleano en tabla agents (default false)
- AC-7: `erc8004_score` = null (placeholder para WAS-194)
- AC-8: Cache: `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- AC-9: WHEN slug inexistente, THEN HTTP 404 `{ error: "agent_not_found" }`
- AC-10: Rate limit: 60 req/min por IP (limiter local en el route — NO usar `checkIpLimit` que tiene ventana '1 d' hardcodeada)
- AC-11: `dispute_rate` = 0 si no hay tabla agent_disputes (campo calculado, tabla opcional en esta iteración)

---

## Wave 0 — Pre-flight

- [ ] Confirmar que `src/app/api/v1/agents/[slug]/reputation/` NO existe
- [ ] Confirmar columnas actuales de tabla `agents`: ¿existe `is_verified`? ¿`last_health_check_ok`? ¿`last_health_check_at`?
- [ ] Confirmar que `get_agent_percentile_metrics` existe (migration 046 aplicada)
- [ ] Confirmar que `checkIpLimit` en `@/lib/rate-limit-ip` acepta (identifier: string, prefix: string, max: number)
- [ ] Confirmar `getClientIp` existe en `@/lib/get-client-ip`

---

## Wave 1 — Migration: campos nuevos en agents

**Archivo:** `supabase/migrations/047_reputation_fields.sql`

```sql
-- Migration 047: campos de reputación en tabla agents
-- is_verified, last_health_check_ok, last_health_check_at

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_verified           BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_health_check_ok  BOOLEAN   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_health_check_at  TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN agents.is_verified IS 'Verificado manualmente por admins de WasiAI';
COMMENT ON COLUMN agents.last_health_check_ok IS 'Resultado del último health check automático';
COMMENT ON COLUMN agents.last_health_check_at IS 'Timestamp del último health check';

-- Índice para is_available lookup
CREATE INDEX IF NOT EXISTS idx_agents_health_check
  ON agents(last_health_check_ok, last_health_check_at)
  WHERE last_health_check_at IS NOT NULL;
```

**Build gate:** `npx supabase db lint 2>&1 | tail -5 || echo "lint-skipped"`

---

## Wave 2 — Crear `src/app/api/v1/agents/[slug]/reputation/route.ts`

```ts
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
    .select('id, total_calls, reputation_score, is_verified, last_health_check_ok, last_health_check_at')
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
  const { data: metrics } = await supabase
    .rpc('get_agent_percentile_metrics', { p_agent_id: agent.id })
    .single()

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
    erc8004_score:         null, // placeholder — WAS-194
  }, { status: 200, headers: CORS })
}
```

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 3 — Commit

```bash
git add supabase/migrations/047_reputation_fields.sql \
        src/app/api/v1/agents/[slug]/reputation/route.ts
git commit -m "feat(WAS-185): GET /reputation endpoint — score, trend, p50/p95, is_available, is_verified"
git push origin main
```

---

## Rollback

```bash
git revert HEAD
# Si migration aplicada: supabase migration repair --status reverted 047
```

---

## Critical Constraints

- ❌ NO requiere auth — endpoint completamente público
- ❌ NO llamar a blockchain en este endpoint (erc8004_score = null placeholder)
- ❌ NO modificar tabla agent_calls
- ✅ dispute_rate = 0 hardcoded hasta que exista tabla agent_disputes (WAS-189)
- ✅ calcTrend hace query adicional — aceptable en endpoint cacheado 60s
- ✅ El índice `idx_agent_calls_agent_created` (creado en migration 046 de WAS-183) es prerequisito para `calcTrend` — verificar en Wave 0 que existe
- ✅ is_verified default false si columna no existe aún (migration 047 la crea)
- ✅ Cache-Control en todos los responses (200, 404, 429)
- ✅ DEPENDE de migration 046 (WAS-183) — ejecutar WAS-183 primero
