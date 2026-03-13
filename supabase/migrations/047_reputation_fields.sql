-- Migration 047: campos de reputación en tabla agents
-- is_verified, last_health_check_ok, last_health_check_at

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_verified           BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_health_check_ok  BOOLEAN   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_health_check_at  TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN agents.is_verified IS 'Verificado manualmente por admins de WasiAI';
COMMENT ON COLUMN agents.last_health_check_ok IS 'Resultado del último health check automático';
COMMENT ON COLUMN agents.last_health_check_at IS 'Timestamp del último health check';

-- Índice para is_available lookup
CREATE INDEX IF NOT EXISTS idx_agents_health_check
  ON agents(last_health_check_ok, last_health_check_at)
  WHERE last_health_check_at IS NOT NULL;
