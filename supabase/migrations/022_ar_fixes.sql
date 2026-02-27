-- supabase/migrations/022_ar_fixes.sql
-- AR Sprint 8 fixes: B-01 (race condition), M-01 (RLS WITH CHECK)
-- Aplicado: 2026-02-27

-- M-01: Recrear policy con WITH CHECK explícito para evitar ambigüedad futura
DROP POLICY IF EXISTS "agent_examples_creator_write" ON agent_examples;
DROP POLICY IF EXISTS "Creator write" ON agent_examples;

CREATE POLICY "Creator write"
  ON agent_examples
  FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- B-01: Función RPC para INSERT atómico con límite de 5 ejemplos por agente
-- Si ya hay 5 ejemplos, el INSERT no inserta nada y retorna NULL.
-- El caller debe verificar si retorna NULL → 409 Conflict.
CREATE OR REPLACE FUNCTION insert_agent_example(
  p_agent_id   UUID,
  p_creator_id UUID,
  p_input      TEXT,
  p_output     TEXT,
  p_label      TEXT
) RETURNS agent_examples
LANGUAGE plpgsql
SECURITY INVOKER  -- respeta RLS del caller (no bypass)
AS $$
DECLARE
  v_result agent_examples;
BEGIN
  INSERT INTO agent_examples (agent_id, creator_id, input, output, label)
  SELECT p_agent_id, p_creator_id, p_input, p_output, p_label
  WHERE (
    SELECT COUNT(*)
    FROM agent_examples
    WHERE agent_id = p_agent_id
  ) < 5
  RETURNING * INTO v_result;

  RETURN v_result;  -- NULL si el WHERE falló (ya hay 5)
END;
$$;
