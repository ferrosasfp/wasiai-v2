-- Migration 055: IDOR fix — step_outputs solo expuesto al owner
-- WAS-206 | Sprint 3 | fix/206-idor-pipeline-ownership

-- SECURITY FIX: CASE WHEN oculta step_outputs cuando el caller no es el owner.
-- Antes (052): pe.step_outputs siempre expuesto aunque owned_by_key=false.
-- Ahora: step_outputs=null cuando key_hash no coincide → elimina IDOR-001.

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
    CASE WHEN ak.key_hash = p_key_hash THEN pe.step_outputs ELSE NULL END AS step_outputs,
    (ak.key_hash = p_key_hash) AS owned_by_key
  FROM pipeline_executions pe
  JOIN agent_keys ak ON ak.id = pe.key_id
  WHERE pe.id = p_pipeline_id
  FOR UPDATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_pipeline_for_retry(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_pipeline_for_retry(UUID, TEXT) TO service_role;
