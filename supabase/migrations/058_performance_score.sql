-- 058_performance_score.sql
-- WAS-213: performance_score basado en error_rate_7d de agent_calls
-- NOTA: No toca reputation_score ni trg_update_agent_reputation

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS performance_score NUMERIC(5,2) DEFAULT NULL;

COMMENT ON COLUMN agents.performance_score IS
  'Performance score 0–100 basado en error_rate_7d de agent_calls. NULL = <5 calls. NO confundir con reputation_score (votos).';

CREATE INDEX IF NOT EXISTS idx_agents_performance_score
  ON agents(performance_score)
  WHERE performance_score IS NOT NULL;

-- Trigger function
CREATE OR REPLACE FUNCTION update_agent_performance_score()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_score   NUMERIC(5,2);
  v_metrics RECORD;
BEGIN
  -- Solo calcular si el status es terminal
  IF NEW.status NOT IN ('success', 'error') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT * INTO v_metrics
    FROM get_agent_percentile_metrics(NEW.agent_id);

    IF v_metrics.error_rate_7d IS NOT NULL THEN
      -- error_rate_7d is already 0–100 (e.g. 5.00 = 5% errors)
      -- performance_score = 100 - error_rate_7d
      v_score := ROUND(100.0 - v_metrics.error_rate_7d, 1);
      v_score := GREATEST(0, LEAST(100, v_score)); -- clamp 0-100

      UPDATE agents
        SET performance_score = v_score
        WHERE id = NEW.agent_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'update_agent_performance_score failed for agent %: %', NEW.agent_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_agent_performance_score
  AFTER INSERT OR UPDATE OF status ON agent_calls
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_performance_score();
