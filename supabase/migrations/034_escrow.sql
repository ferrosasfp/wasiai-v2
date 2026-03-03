-- 034_escrow.sql
-- WAS-72: Escrow para tareas largas
-- Agrega long_running a agents y crea escrow_transactions

-- ─── Campo long_running en agents ────────────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS long_running BOOLEAN NOT NULL DEFAULT false;

-- ─── Tabla escrow_transactions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id       TEXT NOT NULL UNIQUE,    -- bytes32 hex (0x...)
  agent_slug      TEXT NOT NULL,
  payer_address   TEXT NOT NULL,           -- wallet address hex
  payer_user_id   UUID REFERENCES auth.users(id),
  amount_usdc     NUMERIC(20,6) NOT NULL,  -- en USDC humano (e.g. 1.000000)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','released','refunded','disputed')),
  result_data     JSONB,                   -- payload del agente cuando completa
  tx_create       TEXT,                    -- txHash de createEscrow
  tx_release      TEXT,                    -- txHash de releaseEscrow/releaseExpired
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ
);

ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;

-- Payer puede ver sus propios escrows
CREATE POLICY "payer_read" ON escrow_transactions
  FOR SELECT
  USING (payer_user_id = auth.uid());

-- Service role puede todo (operador backend)
CREATE POLICY "service_all" ON escrow_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_escrow_status     ON escrow_transactions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_escrow_payer      ON escrow_transactions(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_escrow_escrow_id  ON escrow_transactions(escrow_id);
