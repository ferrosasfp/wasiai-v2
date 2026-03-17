-- WAS-219: Backfill payment_type for rows incorrectly defaulted to 'x402'
-- Column already exists as NOT NULL DEFAULT 'x402' (migration 032)
-- Constraint already expanded (migration 063)

-- 1. Backfill: rows that used api_key but got default 'x402'
UPDATE agent_calls SET payment_type = 'api_key'
  WHERE payment_type = 'x402'
  AND key_id IS NOT NULL
  AND tx_hash IS NULL;

-- 2. Backfill: free trial rows that got default 'x402'
UPDATE agent_calls SET payment_type = 'free_trial'
  WHERE payment_type = 'x402'
  AND amount_paid = 0
  AND key_id IS NULL
  AND tx_hash IS NULL;

-- 3. amount_paid >= 0 constraint
ALTER TABLE agent_calls
  DROP CONSTRAINT IF EXISTS chk_amount_paid_positive;
ALTER TABLE agent_calls
  ADD CONSTRAINT chk_amount_paid_non_negative
  CHECK (amount_paid >= 0);

-- 4. Index for settlement queries
CREATE INDEX IF NOT EXISTS idx_agent_calls_settlement
  ON agent_calls (agent_slug, payment_type, settled_at)
  WHERE settled_at IS NULL AND payment_type = 'api_key';
