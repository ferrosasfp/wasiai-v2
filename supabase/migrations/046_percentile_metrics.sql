-- Migration 046: métricas de percentil para agentes (WAS-183)
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
    SELECT latency_ms, status, called_at
    FROM agent_calls
    WHERE agent_id = p_agent_id
      AND called_at >= NOW() - INTERVAL '30 days'
      AND latency_ms IS NOT NULL
  ),
  calls_7d AS (
    SELECT status
    FROM agent_calls
    WHERE agent_id = p_agent_id
      AND called_at >= NOW() - INTERVAL '7 days'
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
  ON agent_calls(agent_id, called_at DESC)
  WHERE latency_ms IS NOT NULL;

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
