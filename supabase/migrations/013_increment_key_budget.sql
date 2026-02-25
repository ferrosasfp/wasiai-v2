-- HAL-011: Atomic budget increment to prevent race condition (read-then-write)
CREATE OR REPLACE FUNCTION increment_key_budget(
  p_key_id   UUID,
  p_amount   NUMERIC,
  p_owner_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE agent_keys
  SET budget_usdc = budget_usdc + p_amount
  WHERE id = p_key_id AND owner_id = p_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Key not found or unauthorized';
  END IF;
END;
$$;
