-- 057_agents_health_check.sql
-- Replace legacy boolean health check columns with JSONB

-- Drop legacy index first
DROP INDEX IF EXISTS idx_agents_health_check;

-- Drop legacy columns
ALTER TABLE agents
  DROP COLUMN IF EXISTS last_health_check_ok,
  DROP COLUMN IF EXISTS last_health_check_at;

-- Add new columns
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS health_check JSONB,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- New index
CREATE INDEX IF NOT EXISTS idx_agents_last_checked
  ON agents(last_checked_at)
  WHERE last_checked_at IS NOT NULL;
