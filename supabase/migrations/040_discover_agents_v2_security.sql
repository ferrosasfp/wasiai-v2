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
