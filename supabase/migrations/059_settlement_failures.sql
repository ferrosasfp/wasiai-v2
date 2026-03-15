-- 059_settlement_failures.sql
-- Tabla para registrar casos "cobro sin servicio" (settlement ok + upstream falla)
-- WAS-x402: parte del error recovery post-settlement (S6-01)

CREATE TABLE IF NOT EXISTS settlement_failures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_tx_hash  TEXT NOT NULL,
  agent_slug          TEXT NOT NULL,
  amount_usdc         NUMERIC(10,6) NOT NULL,
  caller_wallet       TEXT,
  error_reason        TEXT,
  agent_call_id       UUID,
  resolved_at         TIMESTAMPTZ,
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_failures_pending
  ON settlement_failures (created_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_failures_tx
  ON settlement_failures (settlement_tx_hash);

-- RLS: tabla financiera — acceso solo via service_role (backend)
ALTER TABLE settlement_failures ENABLE ROW LEVEL SECURITY;

-- Bloquear acceso anon/authenticated vía PostgREST
CREATE POLICY "settlement_failures_service_only"
  ON settlement_failures
  FOR ALL
  TO authenticated, anon
  USING (false);
