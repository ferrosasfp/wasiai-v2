-- WAS-281: contador de fallos consecutivos de health probe
ALTER TABLE agents ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

-- Índice para que el cron filtre eficientemente agentes con fallos
CREATE INDEX IF NOT EXISTS agents_consecutive_failures_idx ON agents (consecutive_failures) WHERE consecutive_failures > 0;
