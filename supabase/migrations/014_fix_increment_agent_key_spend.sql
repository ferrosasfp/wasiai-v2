-- HAL-012: Fix double-count bug in increment_agent_key_spend
-- Bug: multi-step reset path would update daily_reset_at to NOW() in step 2,
-- then step 3 would see daily_reset_at >= NOW()-24h as TRUE and add again.
-- Fix: single atomic UPDATE with CASE expressions.
CREATE OR REPLACE FUNCTION increment_agent_key_spend(
  p_key_id UUID,
  p_amount NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE agent_keys
  SET
    spent_usdc = spent_usdc + p_amount,
    daily_spent_usdc = CASE
      WHEN daily_reset_at IS NULL OR daily_reset_at < NOW() - INTERVAL '24 hours'
      THEN p_amount                     -- reset: empezar desde p_amount
      ELSE daily_spent_usdc + p_amount  -- mismo día: acumular
    END,
    daily_reset_at = CASE
      WHEN daily_reset_at IS NULL OR daily_reset_at < NOW() - INTERVAL '24 hours'
      THEN NOW()                        -- actualizar timestamp de reset
      ELSE daily_reset_at               -- mantener el timestamp actual
    END
  WHERE id = p_key_id AND is_active = true;
END;
$$;
