-- Migration 056: Output Schema para agents + result_type en agent_calls
-- WAS-202 | Sprint 3

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS output_schema JSONB DEFAULT NULL;

COMMENT ON COLUMN agents.output_schema IS
  'JSON Schema draft-07 para validar outputs. NULL = sin validación de output (comportamiento actual).';

ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS result_type TEXT DEFAULT 'success';

COMMENT ON COLUMN agent_calls.result_type IS
  'Resultado de la llamada: ''success'' | ''schema_violation'' | ''agent_error''';
