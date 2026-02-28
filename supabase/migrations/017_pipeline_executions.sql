-- ============================================================
-- Migration 017: pipeline_executions + pipeline_id en agent_calls
-- Proyecto: WasiAI | Sprint: 3 | HU: 5.1
-- NOTA: Referencias a agent_keys (no api_keys — schema real del proyecto)
-- ============================================================

-- Tabla principal de ejecución de pipelines
CREATE TABLE IF NOT EXISTS pipeline_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id            UUID NOT NULL REFERENCES agent_keys(id) ON DELETE RESTRICT,
  steps_requested   SMALLINT NOT NULL CHECK (steps_requested BETWEEN 1 AND 5),
  steps_completed   SMALLINT NOT NULL DEFAULT 0,
  total_cost_usdc   NUMERIC(18, 6) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  failed_at_step    SMALLINT,           -- NULL si success
  error_detail      TEXT,               -- mensaje del error si aplica
  receipt_signature TEXT,               -- ECDSA hex, NULL si failed antes de completar
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- FK opcional en agent_calls para trazabilidad de pipeline
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS pipeline_id  UUID    REFERENCES pipeline_executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_index   INTEGER DEFAULT NULL;

COMMENT ON COLUMN agent_calls.pipeline_id IS 'UUID del pipeline compose; NULL para llamadas individuales vía /invoke';
COMMENT ON COLUMN agent_calls.step_index  IS '0-based índice del step dentro del pipeline; NULL para /invoke';

-- Índices
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_key_id
  ON pipeline_executions(key_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_executions_created_at
  ON pipeline_executions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_id
  ON agent_calls(pipeline_id)
  WHERE pipeline_id IS NOT NULL;

-- Índice compuesto para ordenar steps de un pipeline por orden de ejecución
CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_step
  ON agent_calls(pipeline_id, step_index)
  WHERE pipeline_id IS NOT NULL;

-- RLS
ALTER TABLE pipeline_executions ENABLE ROW LEVEL SECURITY;

-- Service role acceso total (endpoint usa createServiceClient)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pipeline_executions' AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY "service_role_full_access" ON pipeline_executions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Owners de keys pueden leer sus pipelines (futuro dashboard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pipeline_executions' AND policyname = 'key_owner_read'
  ) THEN
    CREATE POLICY "key_owner_read" ON pipeline_executions
      FOR SELECT
      USING (key_id IN (SELECT id FROM agent_keys WHERE owner_id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- Función RPC: deduct_key_balance
-- Descuento atómico — actualiza spent_usdc solo si hay saldo suficiente.
-- Retorna TRUE si el descuento se realizó, FALSE si saldo insuficiente.
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_key_balance(p_key_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_updated INT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive, got %', p_amount;
  END IF;

  UPDATE agent_keys
    SET spent_usdc = spent_usdc + p_amount
  WHERE id = p_key_id
    AND is_active = true
    AND (budget_usdc - spent_usdc) >= p_amount;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- Restringir EXECUTE a service_role únicamente (seguridad)
REVOKE EXECUTE ON FUNCTION deduct_key_balance(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deduct_key_balance(UUID, NUMERIC) TO service_role;
