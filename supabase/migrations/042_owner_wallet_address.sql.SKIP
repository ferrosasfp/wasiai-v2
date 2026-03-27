-- HU-058: Add owner_wallet_address to agent_keys
-- Persists the wallet address of the first depositor.
-- NULL is intentional: existing keys use getKeyOwnerOnChain as fallback.
ALTER TABLE agent_keys
  ADD COLUMN IF NOT EXISTS owner_wallet_address TEXT;
