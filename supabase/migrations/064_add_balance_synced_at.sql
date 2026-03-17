-- WAS-218: On-chain como fuente de verdad para balances
ALTER TABLE agent_keys
  ADD COLUMN IF NOT EXISTS balance_synced_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN agent_keys.balance_synced_at IS
  'Last time budget_usdc was synced from on-chain getKeyBalance. NULL = never synced.';
