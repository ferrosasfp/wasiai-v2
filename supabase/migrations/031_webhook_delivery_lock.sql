-- WAS-74 B2: Add optimistic lock column to prevent race conditions in cron retry
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;

-- Index to speed up unlock-aware queries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_locked_until
  ON webhook_deliveries (locked_until)
  WHERE locked_until IS NOT NULL;
