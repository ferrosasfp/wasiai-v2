-- ═══════════════════════════════════════════════════════════════════
-- Migration 006: WasiAI Agents + Marketplace Contract Integration
-- ═══════════════════════════════════════════════════════════════════
-- Run in Supabase Dashboard → SQL Editor
-- IMPORTANT: Run AFTER deploying WasiAIMarketplace.sol

-- ── 1. Rename models → agents ────────────────────────────────────────────────
ALTER TABLE models        RENAME TO agents;
ALTER TABLE model_calls   RENAME TO agent_calls;

-- Rename existing agent_id (TEXT, A2A caller) to avoid conflict
ALTER TABLE agent_calls RENAME COLUMN agent_id TO caller_agent_id;
-- Rename FK column model_id → agent_id (UUID FK to agents table)
ALTER TABLE agent_calls RENAME COLUMN model_id TO agent_id;

-- ── 2. New agent fields ───────────────────────────────────────────────────────
ALTER TABLE agents
  -- On-chain state
  ADD COLUMN IF NOT EXISTS on_chain_registered BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketplace_address  TEXT,          -- WasiAIMarketplace.sol address
  ADD COLUMN IF NOT EXISTS erc8004_id           BIGINT,        -- ERC-8004 token ID (after registration)
  ADD COLUMN IF NOT EXISTS creator_wallet        TEXT,          -- creator's wallet for on-chain payouts

  -- Agent composition (which other agents this agent calls)
  ADD COLUMN IF NOT EXISTS dependencies          TEXT[]        DEFAULT '{}',

  -- Agent type
  ADD COLUMN IF NOT EXISTS agent_type            TEXT          NOT NULL DEFAULT 'model'
    CHECK (agent_type IN ('model', 'agent', 'workflow')),

  -- MCP tool definition
  ADD COLUMN IF NOT EXISTS mcp_tool_name         TEXT,
  ADD COLUMN IF NOT EXISTS mcp_description       TEXT,

  -- Rating / reputation (cached from ERC-8004, updated periodically)
  ADD COLUMN IF NOT EXISTS reputation_score      NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reputation_count      INT          DEFAULT 0;

-- ── 3. New agent_calls fields ────────────────────────────────────────────────
ALTER TABLE agent_calls
  -- On-chain settlement
  ADD COLUMN IF NOT EXISTS on_chain_recorded    BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_chain_tx_hash     TEXT,          -- tx hash of recordInvocation()
  ADD COLUMN IF NOT EXISTS caller_wallet         TEXT,          -- payer address on-chain

  -- A2A tracking (which agent called which)
  ADD COLUMN IF NOT EXISTS called_by_agent       TEXT;          -- calling agent slug (for A2A calls)

-- ── 4. Marketplace contract registry ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_contracts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain        TEXT NOT NULL,
  chain_id     INT  NOT NULL,
  address      TEXT NOT NULL UNIQUE,
  usdc_address TEXT NOT NULL,
  deployed_at  TIMESTAMPTZ DEFAULT NOW(),
  active       BOOLEAN DEFAULT true
);

INSERT INTO marketplace_contracts (chain, chain_id, address, usdc_address)
VALUES
  ('avalanche-fuji', 43113, '0x0000000000000000000000000000000000000000', '0x5425890298aed601595a70AB815c96711a31Bc65'),
  ('avalanche',      43114, '0x0000000000000000000000000000000000000000', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E')
ON CONFLICT DO NOTHING;
-- UPDATE these addresses after deploy:
-- UPDATE marketplace_contracts SET address = '0xYourContract' WHERE chain_id = 43113;

-- ── 5. Creator pending payouts view ──────────────────────────────────────────
CREATE OR REPLACE VIEW creator_pending_earnings AS
SELECT
  cp.id                                               AS creator_id,
  cp.username,
  cp.wallet_address,
  COUNT(ac.id)                                        AS total_calls,
  SUM(ac.amount_paid)                                 AS total_earned,
  SUM(ac.amount_paid) * 0.90                          AS creator_share,
  SUM(ac.amount_paid) * 0.10                          AS platform_share,
  MAX(ac.called_at)                                   AS last_call_at
FROM creator_profiles cp
JOIN agents           a  ON a.creator_id = cp.id
JOIN agent_calls      ac ON ac.agent_id  = a.id AND ac.status = 'success'
GROUP BY cp.id, cp.username, cp.wallet_address;

-- ── 6. Agent analytics view (updated) ────────────────────────────────────────
DROP VIEW IF EXISTS model_analytics;

CREATE OR REPLACE VIEW agent_analytics AS
SELECT
  a.id,
  a.slug,
  a.name,
  a.category,
  a.agent_type,
  a.creator_id,
  a.price_per_call,
  a.total_calls,
  a.total_revenue,
  a.on_chain_registered,
  a.erc8004_id,
  a.reputation_score,

  COUNT(ac.id) FILTER (WHERE ac.called_at > NOW() - INTERVAL '24 hours')  AS calls_24h,
  COUNT(ac.id) FILTER (WHERE ac.called_at > NOW() - INTERVAL '7 days')    AS calls_7d,
  COUNT(ac.id) FILTER (WHERE ac.caller_type = 'agent')                     AS agent_calls,
  COUNT(ac.id) FILTER (WHERE ac.caller_type = 'human')                     AS human_calls,

  SUM(ac.amount_paid) FILTER (WHERE ac.called_at > NOW() - INTERVAL '24 hours') AS revenue_24h,
  AVG(ac.latency_ms)                                                              AS avg_latency_ms

FROM agents     a
LEFT JOIN agent_calls ac ON ac.agent_id = a.id
GROUP BY a.id;

-- ── 7. RLS: agents (renamed from models) ─────────────────────────────────────
-- Re-apply policies (renamed table loses them)
-- Drop old policies (from migration 003, renamed with table)
DROP POLICY IF EXISTS "models_public_read"       ON agents;
DROP POLICY IF EXISTS "models_creator_manage"    ON agents;
-- Drop new policies if re-running
DROP POLICY IF EXISTS "agents_public_read"       ON agents;
DROP POLICY IF EXISTS "agents_creator_manage"    ON agents;
DROP POLICY IF EXISTS "agents_service_all"       ON agents;

CREATE POLICY "agents_public_read" ON agents
  FOR SELECT USING (status = 'active');

CREATE POLICY "agents_creator_manage" ON agents
  FOR ALL USING (creator_id = auth.uid());

CREATE POLICY "agents_service_all" ON agents
  FOR ALL USING (auth.role() = 'service_role');

-- ── 8. RLS: agent_calls ───────────────────────────────────────────────────────
-- Drop old policy (from migration 003, renamed with table)
DROP POLICY IF EXISTS "calls_creator_read"       ON agent_calls;
-- Drop new policies if re-running
DROP POLICY IF EXISTS "agent_calls_service_all"  ON agent_calls;
DROP POLICY IF EXISTS "agent_calls_creator_read" ON agent_calls;

CREATE POLICY "agent_calls_service_all" ON agent_calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "agent_calls_creator_read" ON agent_calls
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = agent_calls.agent_id
        AND a.creator_id = auth.uid()
    )
  );
