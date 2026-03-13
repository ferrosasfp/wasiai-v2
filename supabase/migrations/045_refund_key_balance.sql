-- Migration 045: refund_key_balance RPC
-- Revierte un deduct_key_balance decrementando spent_usdc
-- Patrón: simétrico a deduct_key_balance en migration 017

CREATE OR REPLACE FUNCTION refund_key_balance(p_key_id UUID, p_amount NUMERIC)
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
    SET spent_usdc = GREATEST(0, spent_usdc - p_amount)
  WHERE id = p_key_id
    AND is_active = true;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION refund_key_balance(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_key_balance(UUID, NUMERIC) TO service_role;
