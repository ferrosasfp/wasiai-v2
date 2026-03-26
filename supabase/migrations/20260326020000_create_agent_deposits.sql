CREATE TABLE agent_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key_id UUID REFERENCES agent_keys(id),
  agent_id UUID REFERENCES agents(id),
  owner_id UUID REFERENCES auth.users(id),
  wallet_address TEXT NOT NULL,
  amount_usdc DECIMAL(18,6) NOT NULL,
  gas_fee_usdc DECIMAL(18,6) NOT NULL DEFAULT 0,
  total_debited_usdc DECIMAL(18,6) NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_deposits_key ON agent_deposits(agent_key_id);
CREATE INDEX idx_agent_deposits_agent ON agent_deposits(agent_id);

ALTER TABLE agent_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON agent_deposits USING (false);
