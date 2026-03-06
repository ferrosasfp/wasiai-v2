# Story File — SDD #052: discover_agents_v2 — SECURITY INVOKER + columnas limitadas
**Sprint TBD | WAS-163**
**Classification: QUALITY**
**Source of truth: this file only. Read every file before modifying.**

## Context

La función RPC `discover_agents_v2` usa `SECURITY DEFINER` y `RETURNS SETOF agents` con `SELECT *`. Esto:
1. Bypassa Row Level Security (RLS) — cualquier usuario autenticado obtiene todos los agentes activos sin filtro RLS
2. Retorna **todas** las columnas incluyendo `endpoint_url`, que es dato sensible (URL interna del agente)

**Riesgo: MEDIUM** — exposición de datos sensibles vía RPC.

## Acceptance Criteria

1. La función usa `SECURITY INVOKER` (respeta RLS del caller)
2. La función retorna solo columnas públicas (NO `endpoint_url`, NO `metadata`)
3. La migración es idempotente (`CREATE OR REPLACE`)
4. El endpoint `/api/v1/agents/discover` sigue funcionando correctamente
5. Build pasa sin errores

## Wave 1 — Nueva migración SQL

**Archivo:** `supabase/migrations/040_discover_agents_v2_security.sql` (crear)

```sql
-- WAS-163 / NG-104: Fix discover_agents_v2 — SECURITY INVOKER + limited columns
CREATE OR REPLACE FUNCTION discover_agents_v2(
  p_category TEXT DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  category TEXT,
  agent_type TEXT,
  price_per_call NUMERIC,
  currency TEXT,
  chain TEXT,
  registration_type TEXT,
  on_chain_registered BOOLEAN,
  total_calls BIGINT,
  is_featured BOOLEAN,
  status TEXT,
  capabilities JSONB,
  cover_image TEXT,
  creator_wallet TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    id, name, slug, description, category, agent_type,
    price_per_call, currency, chain, registration_type,
    on_chain_registered, total_calls, is_featured, status,
    capabilities, cover_image, creator_wallet,
    created_at, updated_at
  FROM agents
  WHERE status = 'active'
    AND (p_category IS NULL OR category = p_category)
    AND (p_max_price IS NULL OR price_per_call <= p_max_price)
  ORDER BY
    CASE WHEN registration_type = 'on_chain' THEN 1 ELSE 0 END DESC,
    total_calls DESC
  LIMIT p_limit;
$$;
```

## Wave 2 — Actualizar tipo en el frontend si aplica

**Archivo:** `src/app/api/v1/agents/discover/route.ts`

Verificar que el endpoint no dependa de `endpoint_url` en el response. Si lo usa, eliminar del response.

## Wave 3 — Commit + Push

```bash
git add -A
git commit -m "fix(NG-104): discover_agents_v2 SECURITY INVOKER + limit columns [WAS-163]"
git push
```

## Critical Constraints

- NO eliminar columnas que el frontend consume (verificar antes)
- `endpoint_url` NUNCA debe estar en la respuesta de discover
- La migración DEBE ser idempotente
- Verificar que RLS policies de `agents` permitan SELECT para usuarios autenticados
