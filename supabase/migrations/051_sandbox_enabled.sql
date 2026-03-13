-- Migration 051: Sandbox opt-in/out
-- WAS-196 | Sprint 2
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN agents.sandbox_enabled IS 'Si false, el endpoint sandbox/invoke rechaza invocaciones con HTTP 403';
