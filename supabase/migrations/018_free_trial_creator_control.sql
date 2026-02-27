-- Migration 018: Free trial controlado por creator (HU-3.3)
-- Agrega free_trial_enabled y free_trial_limit a la tabla agents.
-- Agrega times_used a agent_trials para soportar límites > 1.
-- Default FALSE — ningún agente existente tiene trial ON automáticamente.

-- ── agents: control del creator ──────────────────────────────────────────────

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS free_trial_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS free_trial_limit   INT     NOT NULL DEFAULT 1;

-- Constraint: límite entre 1 y 10 (idempotente)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_free_trial_limit_range' AND conrelid = 'agents'::regclass) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_free_trial_limit_range CHECK (free_trial_limit >= 1 AND free_trial_limit <= 10);
  END IF;
END $$;

-- Índice parcial: acelera lookup de agentes con trial activo
CREATE INDEX IF NOT EXISTS idx_agents_free_trial_enabled
  ON agents (id)
  WHERE free_trial_enabled = TRUE AND status = 'active';

COMMENT ON COLUMN agents.free_trial_enabled IS
  'Si TRUE el creator permite invocaciones gratuitas a usuarios sin API key con fondos.';
COMMENT ON COLUMN agents.free_trial_limit IS
  'Número máximo de invocaciones gratuitas por usuario para este agente (rango 1-10).';

-- ── agent_trials: contador de usos ───────────────────────────────────────────

ALTER TABLE agent_trials
  ADD COLUMN IF NOT EXISTS times_used INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN agent_trials.times_used IS
  'Cuántas veces este usuario ha usado el trial de este agente. Máx = agents.free_trial_limit.';

-- ── Verificación post-apply ───────────────────────────────────────────────────
-- Ejecutar manualmente para confirmar:
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'agents'
--   AND column_name IN ('free_trial_enabled', 'free_trial_limit');
-- → 2 filas
--
-- SELECT COUNT(*) FROM agents WHERE free_trial_enabled = true;
-- → 0 (antes de que ningún creator active el toggle)

-- ── Función atómica use_trial (BLOCKER-1: evita race condition TOCTOU) ───────

CREATE OR REPLACE FUNCTION use_trial(
  p_user_id  UUID,
  p_agent_id UUID,
  p_limit    INT
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_times_used INT;
BEGIN
  UPDATE agent_trials
     SET times_used = times_used + 1
   WHERE user_id   = p_user_id
     AND agent_id  = p_agent_id
     AND times_used < p_limit
  RETURNING times_used INTO v_times_used;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM agent_trials WHERE user_id = p_user_id AND agent_id = p_agent_id) THEN
      RETURN -1;
    END IF;
    INSERT INTO agent_trials (user_id, agent_id, times_used) VALUES (p_user_id, p_agent_id, 1) RETURNING times_used INTO v_times_used;
  END IF;
  RETURN v_times_used;
END;
$$;
REVOKE EXECUTE ON FUNCTION use_trial(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION use_trial(UUID, UUID, INT) TO service_role;
