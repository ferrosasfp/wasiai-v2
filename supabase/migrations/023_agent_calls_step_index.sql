-- Migration 023: Add step_index column to agent_calls
-- HU-5.1 — Compose API

ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS step_index integer DEFAULT NULL;

-- Índice compuesto para ordenar steps de un pipeline por orden de ejecución
CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_step
  ON agent_calls (pipeline_id, step_index)
  WHERE pipeline_id IS NOT NULL;

COMMENT ON COLUMN agent_calls.step_index IS '0-based índice del step dentro del pipeline; NULL para llamadas individuales vía /invoke';
