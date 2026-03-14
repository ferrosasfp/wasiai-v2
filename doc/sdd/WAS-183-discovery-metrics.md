# SDD — WAS-183: Discovery con métricas p50/p95/error_rate

**Sprint:** 1 | **Clasificación:** QUALITY | **Fecha:** 2026-03-13

---

## Context Map

| Archivo | Rol |
|---|---|
| `src/app/api/v1/agents/discover/route.ts` | Handler GET /discover — MODIFICAR |
| `src/app/api/v1/agents/[slug]/route.ts` | Handler GET /:slug — MODIFICAR |
| `supabase/migrations/046_percentile_metrics.sql` | Nueva función RPC — CREAR |
| `supabase/migrations/040_discover_agents_v2_security.sql` | `discover_agents_v2` existente — referencia |

---

## Acceptance Criteria (EARS)

- AC-1: GIVEN migration 046 aplicada, WHEN GET /api/v1/agents/discover, THEN cada agente incluye `p50_latency_ms`, `p95_latency_ms` (30 días), `error_rate_7d` (7 días), `error_rate_sample_size`
- AC-2: WHEN GET /api/v1/agents/:slug, THEN mismo agente incluye las mismas métricas
- AC-3: WHEN agente tiene <10 calls en 30 días, THEN `p50_latency_ms: null`, `p95_latency_ms: null`
- AC-4: WHEN agente tiene <5 calls en 7 días, THEN `error_rate_7d: null`, `error_rate_sample_size: N`
- AC-5: WHEN agente tiene 0 calls, THEN todas las métricas = null
- AC-6: Métricas calculadas en RPC Supabase (no en API layer) para evitar N+1 queries
- AC-7: WHEN discover retorna resultados, THEN responde en <500ms

---

## Wave 0 — Pre-flight

- [ ] Leer `discover/route.ts` — confirmar que llama `discover_agents_v2` RPC y no hace N+1
- [ ] Leer `agents/[slug]/route.ts` — confirmar columnas actuales que se seleccionan
- [ ] Confirmar que `agent_calls` tiene columnas `latency_ms INT`, `status TEXT`, `created_at TIMESTAMPTZ`, `agent_id UUID`
- [ ] Confirmar que NO existe función `get_agent_metrics` ni `percentile_metrics` en las migrations
- [ ] Confirmar que `discover_agents_v2` RPC retorna un SETOF con columnas conocidas

---

## Wave 1 — Migration: `get_agent_percentile_metrics` RPC

**Archivo:** `supabase/migrations/046_percentile_metrics.sql`

```sql
-- Migration 046: métricas de percentil para agentes
-- p50/p95 sobre últimos 30 días, error_rate sobre últimos 7 días
-- Mínimo 10 calls para p50/p95, mínimo 5 calls para error_rate

CREATE OR REPLACE FUNCTION get_agent_percentile_metrics(p_agent_id UUID)
RETURNS TABLE (
  p50_latency_ms    NUMERIC,
  p95_latency_ms    NUMERIC,
  error_rate_7d     NUMERIC,
  error_rate_sample INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH calls_30d AS (
    SELECT latency_ms, status, created_at
    FROM agent_calls
    WHERE agent_id = p_agent_id
      AND created_at >= NOW() - INTERVAL '30 days'
      AND latency_ms IS NOT NULL
  ),
  calls_7d AS (
    SELECT status
    FROM agent_calls
    WHERE agent_id = p_agent_id
      AND created_at >= NOW() - INTERVAL '7 days'
  ),
  metrics_30d AS (
    SELECT
      CASE WHEN COUNT(*) >= 10
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms))
        ELSE NULL
      END AS p50,
      CASE WHEN COUNT(*) >= 10
        THEN ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))
        ELSE NULL
      END AS p95
    FROM calls_30d
  ),
  metrics_7d AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'error') AS errors
    FROM calls_7d
  )
  SELECT
    metrics_30d.p50                                                        AS p50_latency_ms,
    metrics_30d.p95                                                        AS p95_latency_ms,
    CASE WHEN metrics_7d.total >= 5
      THEN ROUND((metrics_7d.errors::NUMERIC / metrics_7d.total) * 100, 2)
      ELSE NULL
    END                                                                    AS error_rate_7d,
    metrics_7d.total::INTEGER                                              AS error_rate_sample
  FROM metrics_30d, metrics_7d;
$$;

REVOKE EXECUTE ON FUNCTION get_agent_percentile_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_agent_percentile_metrics(UUID) TO service_role, anon, authenticated;

-- Índice para acelerar las queries de métricas
CREATE INDEX IF NOT EXISTS idx_agent_calls_agent_created
  ON agent_calls(agent_id, created_at DESC)
  WHERE latency_ms IS NOT NULL;
```

**Build gate:** `npx supabase db lint 2>&1 | tail -5 || echo "lint-skipped"`

---

## Wave 2 — Modificar `discover_agents_v2` para incluir métricas

**Archivo:** `supabase/migrations/046_percentile_metrics.sql` (agregar al mismo archivo)

Las columnas existentes de `discover_agents_v2` (migration 040) son exactamente estas 19:
`id, name, slug, description, category, agent_type, price_per_call, currency, chain, registration_type, on_chain_registered, total_calls, is_featured, status, capabilities, cover_image, creator_wallet, created_at, updated_at`

Reemplazar manteniendo `SECURITY INVOKER` (igual que migration 040) y conservando el ORDER BY con boost on-chain:

```sql
-- Drop primero porque cambia el RETURNS TABLE (agrega 4 columnas)
DROP FUNCTION IF EXISTS discover_agents_v2(TEXT, NUMERIC, INT);

CREATE OR REPLACE FUNCTION discover_agents_v2(
  p_category  TEXT    DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit     INT     DEFAULT 20
)
RETURNS TABLE (
  -- 19 columnas originales de migration 040 (preservar todas)
  id                  UUID,
  name                TEXT,
  slug                TEXT,
  description         TEXT,
  category            TEXT,
  agent_type          TEXT,
  price_per_call      NUMERIC,
  currency            TEXT,
  chain               TEXT,
  registration_type   TEXT,
  on_chain_registered BOOLEAN,
  total_calls         BIGINT,
  is_featured         BOOLEAN,
  status              TEXT,
  capabilities        JSONB,
  cover_image         TEXT,
  creator_wallet      TEXT,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ,
  -- 4 columnas nuevas WAS-183
  p50_latency_ms         NUMERIC,
  p95_latency_ms         NUMERIC,
  error_rate_7d          NUMERIC,
  error_rate_sample_size INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER  -- mantener INVOKER para respetar RLS del usuario (igual que migration 040)
AS $$
  SELECT
    a.id, a.name, a.slug, a.description, a.category, a.agent_type,
    a.price_per_call, a.currency, a.chain, a.registration_type,
    a.on_chain_registered, a.total_calls, a.is_featured, a.status,
    a.capabilities, a.cover_image, a.creator_wallet,
    a.created_at, a.updated_at,
    m.p50_latency_ms,
    m.p95_latency_ms,
    m.error_rate_7d,
    m.error_rate_sample AS error_rate_sample_size
  FROM agents a
  LEFT JOIN LATERAL get_agent_percentile_metrics(a.id) m ON true
  WHERE a.status = 'active'
    AND (p_category IS NULL OR a.category = p_category)
    AND (p_max_price IS NULL OR a.price_per_call <= p_max_price)
  ORDER BY
    CASE WHEN a.registration_type = 'on_chain' THEN 1 ELSE 0 END DESC,  -- boost on-chain preservado
    a.total_calls DESC
  LIMIT p_limit;
$$;
```

**Build gate:** `npx supabase db lint 2>&1 | tail -5 || echo "lint-skipped"`

---

## Wave 3 — Actualizar `discover/route.ts`

Agregar las 4 métricas al response (el RPC ya las retorna, solo exponerlas):

```ts
// En el return NextResponse.json({ agents: filtered, ... })
// filtered ya contiene p50_latency_ms, p95_latency_ms, error_rate_7d, error_rate_sample_size
// No hay cambio de código necesario si el RPC retorna correctamente los campos
// Solo verificar que no hay un .select() que excluya las nuevas columnas
```

Si hay un `.select()` explícito en `discover/route.ts` que filtra columnas, agregar las 4 nuevas. Si no hay (RPC retorna todo), este wave no requiere cambio de código.

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 4 — Actualizar `agents/[slug]/route.ts`

En la query existente, agregar join con `get_agent_percentile_metrics`:

```ts
// Opción A: Segunda query (más simple)
const { data: metrics } = await supabase
  .rpc('get_agent_percentile_metrics', { p_agent_id: agent.id })
  .single()

// Agregar al body de respuesta:
const body = {
  // ...campos existentes...
  p50_latency_ms:        metrics?.p50_latency_ms ?? null,
  p95_latency_ms:        metrics?.p95_latency_ms ?? null,
  error_rate_7d:         metrics?.error_rate_7d ?? null,
  error_rate_sample_size: metrics?.error_rate_sample ?? null,
}
```

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 5 — Commit

```bash
git add supabase/migrations/046_percentile_metrics.sql \
        src/app/api/v1/agents/discover/route.ts \
        src/app/api/v1/agents/[slug]/route.ts
git commit -m "feat(WAS-183): add p50/p95/error_rate metrics to discover and agent detail endpoints"
git push origin main
```

---

## Rollback

```bash
git revert HEAD
# Si migration 046 ya fue aplicada en Supabase:
supabase migration repair --status reverted 046
# Además ejecutar en DB para eliminar las funciones creadas:
# DROP FUNCTION IF EXISTS get_agent_percentile_metrics(UUID);
# DROP FUNCTION IF EXISTS discover_agents_v2(TEXT, NUMERIC, INT);
# Luego re-aplicar migration 040 para restaurar discover_agents_v2 original:
# supabase db push --include-all
```

---

## Critical Constraints

- ❌ NO calcular percentiles en API layer (N+1 queries con N agentes)
- ❌ NO modificar tabla `agent_calls` — solo agregar índice
- ❌ NO romper columnas existentes de `discover_agents_v2`
- ✅ Builder DEBE leer migration 040 para copiar columnas existentes antes de reemplazar RPC
- ✅ Mínimo 10 calls para p50/p95, mínimo 5 para error_rate — si menos → null
- ✅ `error_rate_sample_size` siempre presente (aunque métricas sean null)
