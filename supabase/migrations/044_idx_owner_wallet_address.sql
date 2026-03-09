-- NG-113: Add index on agent_keys.owner_wallet_address
-- Used in deposit/route.ts and withdraw/route.ts for wallet lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_keys_owner_wallet_address
  ON agent_keys (owner_wallet_address)
  WHERE owner_wallet_address IS NOT NULL;
