-- Migration 025: Rate limits configurables por creator
-- HU-8.4: max_rpm (requests/minuto) y max_rpd (requests/día) por agente

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS max_rpm  INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_rpd  INTEGER NOT NULL DEFAULT 1000;

COMMENT ON COLUMN agents.max_rpm IS 'Max requests per minute per API key consumer (default 60)';
COMMENT ON COLUMN agents.max_rpd IS 'Max requests per day per API key consumer (default 1000)';
