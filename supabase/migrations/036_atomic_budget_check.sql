-- 036_atomic_budget_check.sql
-- NG-008: Atomic budget check + deduct en una sola operación SQL.
-- Previene race condition TOCTOU: two concurrent calls can both pass the
-- "remaining >= price" check before either decrements the balance.
--
-- Returns: TRUE  → budget deducted successfully
--          FALSE → insufficient budget (no change made)

CREATE OR REPLACE FUNCTION check_and_deduct_budget(
  p_key_id UUID,
  p_amount  NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  -- Atomic: CHECK + DEDUCT en un solo UPDATE con FOR UPDATE implícito via rowlock
  UPDATE agent_keys
  SET
    spent_usdc = spent_usdc + p_amount,
    daily_spent_usdc = CASE
      WHEN daily_reset_at IS NULL OR daily_reset_at < NOW() - INTERVAL '24 hours'
      THEN p_amount
      ELSE daily_spent_usdc + p_amount
    END,
    daily_reset_at = CASE
      WHEN daily_reset_at IS NULL OR daily_reset_at < NOW() - INTERVAL '24 hours'
      THEN NOW()
      ELSE daily_reset_at
    END
  WHERE id        = p_key_id
    AND is_active = true
    AND (budget_usdc - spent_usdc) >= p_amount;  -- condición atómica

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  RETURN v_rows_updated > 0;
END;
$$;
