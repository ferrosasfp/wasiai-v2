-- Route C anti-replay: enforce tx_hash uniqueness at DB level
-- Partial index: only non-null tx_hash values (Route A calls have NULL tx_hash)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_calls_tx_hash_unique
  ON agent_calls (tx_hash) WHERE tx_hash IS NOT NULL;
