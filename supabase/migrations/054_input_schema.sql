-- Migration 054: Input Schema para agents
-- WAS-200 | Sprint 2

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS input_schema JSONB DEFAULT NULL;

COMMENT ON COLUMN agents.input_schema IS
  'JSON Schema draft-07 para validar inputs. NULL = sin validación (comportamiento actual).';
