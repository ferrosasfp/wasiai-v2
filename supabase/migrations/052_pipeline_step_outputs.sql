-- Migration 052: Step outputs para compose retry
-- WAS-204 | Sprint 2

ALTER TABLE pipeline_executions
  ADD COLUMN IF NOT EXISTS step_outputs JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pipeline_executions.step_outputs IS
  'Array de outputs por step: [{step: 0, output: "...", agent_slug: "..."}]';

-- RPC: get_pipeline_for_retry — SELECT FOR UPDATE para ownership check y concurrencia
CREATE OR REPLACE FUNCTION get_pipeline_for_retry(
  p_pipeline_id UUID,
  p_key_hash    TEXT
)
RETURNS TABLE (
  id            UUID,
  status        TEXT,
  step_outputs  JSONB,
  owned_by_key  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id,
    pe.status,
    pe.step_outputs,
    (ak.key_hash = p_key_hash) AS owned_by_key
  FROM pipeline_executions pe
  JOIN agent_keys ak ON ak.id = pe.key_id
  WHERE pe.id = p_pipeline_id
  FOR UPDATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_pipeline_for_retry(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_pipeline_for_retry(UUID, TEXT) TO service_role;

-- RPC: append_step_output — acumula outputs por step (best-effort)
CREATE OR REPLACE FUNCTION append_step_output(
  p_pipeline_id UUID,
  p_step        INTEGER,
  p_output      TEXT,
  p_agent_slug  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pipeline_executions
  SET step_outputs = COALESCE(step_outputs, '[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object(
      'step', p_step,
      'output', p_output,
      'agent_slug', p_agent_slug
    ))
  WHERE id = p_pipeline_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION append_step_output(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION append_step_output(UUID, INTEGER, TEXT, TEXT) TO service_role;
