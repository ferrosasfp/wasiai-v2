-- Migration 049: fix discover_agents_v2 post migration 048
-- Problema: discover_agents_v2 es SECURITY INVOKER y llama a get_agent_percentile_metrics via LATERAL.
-- Cuando el caller es 'anon' (endpoint público), no puede ejecutar get_agent_percentile_metrics
-- porque migration 048 revocó ese GRANT a anon.
-- Solución: cambiar discover_agents_v2 a SECURITY DEFINER (solo retorna datos públicos de agentes activos).

CREATE OR REPLACE FUNCTION discover_agents_v2(
  p_category  TEXT    DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit     INT     DEFAULT 20
)
RETURNS TABLE (
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
  p50_latency_ms         NUMERIC,
  p95_latency_ms         NUMERIC,
  error_rate_7d          NUMERIC,
  error_rate_sample_size INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER  -- necesario: llama a get_agent_percentile_metrics que requiere service_role
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
    CASE WHEN a.registration_type = 'on_chain' THEN 1 ELSE 0 END DESC,
    a.total_calls DESC
  LIMIT p_limit;
$$;

-- Permisos: anon y authenticated pueden llamar discover (es público)
REVOKE EXECUTE ON FUNCTION discover_agents_v2(TEXT, NUMERIC, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discover_agents_v2(TEXT, NUMERIC, INT) TO anon, authenticated, service_role;
