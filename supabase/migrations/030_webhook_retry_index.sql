-- supabase/migrations/030_webhook_retry_index.sql
-- WAS-74: Index para cron de retry + columna error_message
-- NOTA: Se usa 030 porque 028 y 029 ya estaban tomados.

-- Índice parcial para el cron query: success=false AND attempt < 3
CREATE INDEX IF NOT EXISTS idx_deliveries_retry
  ON webhook_deliveries(success, attempt, delivered_at)
  WHERE success = false AND attempt < 3;

-- Columna para capturar el error de deliverWebhook
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error_message TEXT;
