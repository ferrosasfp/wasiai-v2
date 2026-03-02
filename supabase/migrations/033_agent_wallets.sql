-- 033_agent_wallets.sql
-- Tabla de wallets self-custody por agente
-- RLS: USING (false) → solo service role puede acceder

CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id              UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  encrypted_private_key TEXT NOT NULL,     -- AES-256-GCM, formato: base64(iv[12] + tag[16] + ciphertext)
  wallet_address        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS estricto: ningún cliente puede leer ni escribir directamente
ALTER TABLE agent_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON agent_wallets USING (false);

-- Índice para lookup por address
CREATE INDEX IF NOT EXISTS idx_agent_wallets_address ON agent_wallets(wallet_address);
