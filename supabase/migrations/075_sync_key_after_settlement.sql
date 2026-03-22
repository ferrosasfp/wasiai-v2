-- Migration 075: sync_key_after_settlement RPC
-- Sincroniza budget_usdc y spent_usdc post-settlement en un solo UPDATE atómico
-- Fixes WAS-275: spent_usdc desync after settlement batch

CREATE OR REPLACE FUNCTION sync_key_after_settlement(
  p_key_id    UUID,
  p_call_ids  UUID[],
  p_new_budget NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settled_amount NUMERIC;
  v_old_spent      NUMERIC;
  v_new_spent      NUMERIC;
  rows_updated     INT;
BEGIN
  -- Compute settled_amount from the calls included in this batch
  SELECT COALESCE(SUM(amount_paid), 0)
    INTO v_settled_amount
    FROM agent_calls
   WHERE id = ANY(p_call_ids);

  -- Fetch current spent_usdc to detect clamping
  SELECT spent_usdc INTO v_old_spent
    FROM agent_keys
   WHERE id = p_key_id AND is_active = true;

  v_new_spent := GREATEST(0, v_old_spent - v_settled_amount);

  IF v_new_spent = 0 AND (v_old_spent - v_settled_amount) < 0 THEN
    RAISE WARNING 'sync_key_after_settlement: clamping applied for key %', p_key_id;
  END IF;

  UPDATE agent_keys
     SET budget_usdc       = p_new_budget,
         spent_usdc        = GREATEST(0, spent_usdc - v_settled_amount),
         balance_synced_at = now()
   WHERE id = p_key_id
     AND is_active = true;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE WARNING 'sync_key_after_settlement: key % not found or inactive', p_key_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_key_after_settlement(UUID, UUID[], NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_key_after_settlement(UUID, UUID[], NUMERIC) TO service_role;
