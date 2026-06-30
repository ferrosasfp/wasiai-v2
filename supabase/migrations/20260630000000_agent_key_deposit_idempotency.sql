-- ============================================================
-- Migration: 20260630000000_agent_key_deposit_idempotency
-- TB-06 (audit 2026-06-30): deposit idempotency + anti-replay.
--
-- Mirrors the wasiai-a2a pattern (20260529000000_a2a_key_deposits.sql):
-- a per-deposit ledger with a DB-level UNIQUE (chain_id, tx_hash) so the SAME
-- confirmed deposit transaction can NEVER credit the key budget twice (client
-- retries, double-submits, etc.), plus an atomic insert-then-credit RPC.
--
-- ⚠️ DEFER-TO-HU (prod apply): this migration MUST run on prod caldz before the
-- route code that calls increment_key_budget_idempotent() is deployed. Until it
-- is applied, the deposit routes keep using the existing increment_key_budget()
-- (no idempotency). Do NOT deploy the route change ahead of this migration.
-- ============================================================

-- 1. Per-deposit ledger (auditable; does not bloat the key row) ───────────────
CREATE TABLE IF NOT EXISTS agent_key_deposits (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key_id UUID          NOT NULL REFERENCES agent_keys(id),
  owner_id     UUID          NOT NULL,            -- snapshot of crediting owner
  chain_id     INT           NOT NULL,
  tx_hash      TEXT          NOT NULL,
  amount_usdc  DECIMAL(18,6) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- Anti-replay: the same (chain, tx) is credited at most once.
  CONSTRAINT uq_agent_key_deposits_chain_tx UNIQUE (chain_id, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_agent_key_deposits_key
  ON agent_key_deposits (agent_key_id);

ALTER TABLE agent_key_deposits ENABLE ROW LEVEL SECURITY;
-- service_role bypasses RLS; deny everyone else (defense in depth).
DROP POLICY IF EXISTS "service_only" ON agent_key_deposits;
CREATE POLICY "service_only" ON agent_key_deposits USING (false);

-- 2. Idempotent + atomic credit RPC ──────────────────────────────────────────
--    Reuses the ownership guard from increment_key_budget (HAL-011) and adds the
--    (chain_id, tx_hash) anti-replay. On a duplicate tx it raises a typed error
--    and does NOT credit; the caller treats it as "already credited" (no-op).
CREATE OR REPLACE FUNCTION increment_key_budget_idempotent(
  p_key_id   UUID,
  p_amount   NUMERIC,
  p_owner_id UUID,
  p_chain_id INT,
  p_tx_hash  TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Ownership guard: lock the key row and verify owner before any credit.
  PERFORM 1 FROM agent_keys
   WHERE id = p_key_id AND owner_id = p_owner_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Key not found or unauthorized';
  END IF;

  -- Anti-replay: UNIQUE(chain_id, tx_hash) → a duplicate (chain, tx) raises
  -- unique_violation, which we surface as a typed error and roll back (no credit).
  BEGIN
    INSERT INTO agent_key_deposits (agent_key_id, owner_id, chain_id, tx_hash, amount_usdc)
    VALUES (p_key_id, p_owner_id, p_chain_id, p_tx_hash, p_amount);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DEPOSIT_ALREADY_CREDITED: chain % tx % already credited', p_chain_id, p_tx_hash;
  END;

  UPDATE agent_keys
     SET budget_usdc = budget_usdc + p_amount
   WHERE id = p_key_id AND owner_id = p_owner_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_key_budget_idempotent(uuid, numeric, uuid, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_key_budget_idempotent(uuid, numeric, uuid, int, text)
  TO service_role;
