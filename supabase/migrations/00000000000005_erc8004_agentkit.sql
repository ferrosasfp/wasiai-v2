-- WasiAI — ERC-8004 Agent Identity + AgentKit Support
-- Migration 005

-- ── 1. Add ERC-8004 identity field to agent_keys ──────────────────────────
ALTER TABLE agent_keys
  ADD COLUMN IF NOT EXISTS erc8004_identity TEXT,        -- on-chain agent identity address
  ADD COLUMN IF NOT EXISTS erc8004_verified BOOLEAN DEFAULT false, -- verified on-chain
  ADD COLUMN IF NOT EXISTS agentkit_wallet TEXT,         -- Coinbase AgentKit wallet address
  ADD COLUMN IF NOT EXISTS daily_limit_usdc NUMERIC(18,6) DEFAULT NULL, -- optional daily cap
  ADD COLUMN IF NOT EXISTS daily_spent_usdc NUMERIC(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_reset_at TIMESTAMPTZ DEFAULT NOW();

-- ── 2. Agent identities registry (ERC-8004 compatible) ───────────────────
-- Tracks verified on-chain agent identities that interact with WasiAI.
-- Each identity has verifiable permissions and spend authority.
CREATE TABLE IF NOT EXISTS agent_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  chain_address TEXT UNIQUE NOT NULL,   -- ERC-8004 agent address
  chain TEXT NOT NULL DEFAULT 'avalanche',
  chain_id INT NOT NULL DEFAULT 43114,
  display_name TEXT,
  framework TEXT,                        -- 'agentkit', 'langchain', 'custom', etc.
  permissions JSONB DEFAULT '[]',        -- allowed actions
  max_spend_per_call NUMERIC(18,6),      -- hard cap per invocation
  total_calls BIGINT DEFAULT 0,
  total_spent NUMERIC(18,6) DEFAULT 0,
  verified BOOLEAN DEFAULT false,        -- verified via on-chain signature
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agent_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "identities_public_read" ON agent_identities;
CREATE POLICY "identities_public_read" ON agent_identities
  FOR SELECT USING (verified = true);

DROP POLICY IF EXISTS "identities_owner_manage" ON agent_identities;
CREATE POLICY "identities_owner_manage" ON agent_identities
  FOR ALL USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS agent_identities_updated_at ON agent_identities;
CREATE TRIGGER agent_identities_updated_at
  BEFORE UPDATE ON agent_identities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. Add created_at index to model_calls for analytics ─────────────────
CREATE INDEX IF NOT EXISTS model_calls_called_at_idx ON model_calls (called_at DESC);
CREATE INDEX IF NOT EXISTS model_calls_model_id_idx ON model_calls (model_id);

-- ── 4. Function: increment agent key spend (atomic) ───────────────────────
-- Called after each successful invoke to deduct from budget atomically.
CREATE OR REPLACE FUNCTION increment_agent_key_spend(
  p_key_id UUID,
  p_amount NUMERIC
)
RETURNS void AS $$
BEGIN
  UPDATE agent_keys
  SET
    spent_usdc = spent_usdc + p_amount,
    last_used_at = NOW()
  WHERE id = p_key_id;

  -- Reset daily spend if needed
  UPDATE agent_keys
  SET daily_spent_usdc = p_amount,
      daily_reset_at = NOW()
  WHERE id = p_key_id
    AND daily_reset_at < NOW() - INTERVAL '24 hours';

  UPDATE agent_keys
  SET daily_spent_usdc = daily_spent_usdc + p_amount
  WHERE id = p_key_id
    AND daily_reset_at >= NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 5. View: model analytics (for dashboard) ─────────────────────────────
CREATE OR REPLACE VIEW model_analytics AS
SELECT
  m.id,
  m.slug,
  m.name,
  m.category,
  m.creator_id,
  m.price_per_call,
  m.total_calls,
  m.total_revenue,
  COUNT(mc.id) FILTER (WHERE mc.called_at > NOW() - INTERVAL '24 hours') AS calls_24h,
  COUNT(mc.id) FILTER (WHERE mc.called_at > NOW() - INTERVAL '7 days')  AS calls_7d,
  SUM(mc.amount_paid) FILTER (WHERE mc.called_at > NOW() - INTERVAL '24 hours') AS revenue_24h,
  AVG(mc.latency_ms) AS avg_latency_ms,
  COUNT(mc.id) FILTER (WHERE mc.caller_type = 'agent') AS agent_calls,
  COUNT(mc.id) FILTER (WHERE mc.caller_type = 'human') AS human_calls
FROM models m
LEFT JOIN model_calls mc ON mc.model_id = m.id
GROUP BY m.id;
