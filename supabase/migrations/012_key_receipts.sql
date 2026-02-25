-- ============================================================
-- Migration 012: Recibos criptográficos + Batch Settlement
-- ============================================================
-- Permite auditar que WasiAI no inventó llamadas.
-- Rastrea batches diarios de settlement on-chain.
-- ============================================================

-- Agregar columnas a agent_calls (todas con IF NOT EXISTS)
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS key_id UUID REFERENCES agent_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_slug TEXT,
  ADD COLUMN IF NOT EXISTS receipt_signature TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS settlement_batch_id UUID;

-- Tabla para trackear batches de settlement on-chain
CREATE TABLE IF NOT EXISTS key_batch_settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id       TEXT NOT NULL,              -- DB key id (UUID as text)
  key_hash     TEXT NOT NULL,              -- SHA-256 hash (bytes32 on-chain)
  tx_hash      TEXT,                       -- on-chain tx hash del batch
  total_usdc   NUMERIC(18,6) NOT NULL,
  call_count   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | failed
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- Índices para queries del cron diario
CREATE INDEX IF NOT EXISTS idx_agent_calls_unsettled
  ON agent_calls (key_id, settled_at)
  WHERE key_id IS NOT NULL AND settled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_calls_key_id
  ON agent_calls (key_id)
  WHERE key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_key_batch_settlements_status
  ON key_batch_settlements (status, created_at);

CREATE INDEX IF NOT EXISTS idx_key_batch_settlements_key_id
  ON key_batch_settlements (key_id);
