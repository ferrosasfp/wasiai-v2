-- 039: Dual Registration — off-chain (free) + on-chain (ERC-8004) with upgrade path
-- WAS-160a: Schema migration + discovery RPC function

-- Enum for registration type
DO $$ BEGIN
  CREATE TYPE registration_type AS ENUM ('off_chain', 'on_chain');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- New columns on agents table
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS registration_type registration_type DEFAULT 'off_chain',
  ADD COLUMN IF NOT EXISTS token_id BIGINT,
  ADD COLUMN IF NOT EXISTS chain_registered_at TIMESTAMPTZ;

-- Retrocompat: existing on-chain agents get marked as 'on_chain'
UPDATE agents
  SET registration_type = 'on_chain',
      chain_registered_at = COALESCE(updated_at, created_at)
  WHERE on_chain_registered = true
    AND registration_type = 'off_chain';

-- Index for discovery boost ordering
CREATE INDEX IF NOT EXISTS idx_agents_registration_type
  ON agents(registration_type);

-- RPC function for discovery with on-chain boost
CREATE OR REPLACE FUNCTION discover_agents_v2(
  p_category TEXT DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS SETOF agents
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT *
  FROM agents
  WHERE status = 'active'
    AND (p_category IS NULL OR category = p_category)
    AND (p_max_price IS NULL OR price_per_call <= p_max_price)
  ORDER BY
    CASE WHEN registration_type = 'on_chain' THEN 1 ELSE 0 END DESC,
    total_calls DESC
  LIMIT p_limit;
$$;
