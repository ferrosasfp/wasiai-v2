-- Migration 026: creator_price separation + system_config
-- Idempotente: IF NOT EXISTS + ON CONFLICT DO NOTHING

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS creator_price NUMERIC(18,6);

-- Backfill: el precio histórico era 100% del creator
UPDATE agents
  SET creator_price = price_per_call
  WHERE creator_price IS NULL;

-- Tabla de configuración del sistema (toggle settlement, etc.)
CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: solo service role
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON system_config
  USING (false) WITH CHECK (false);

-- Seed: modo default = vercel
INSERT INTO system_config (key, value)
  VALUES ('settlement_mode', 'vercel')
  ON CONFLICT (key) DO NOTHING;
