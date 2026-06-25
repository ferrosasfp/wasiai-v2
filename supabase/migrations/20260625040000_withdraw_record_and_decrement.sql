-- FP-1 (audit 2026-06-25): atomic, idempotent record-withdrawal + decrement.
--
-- Problem: /api/creator/withdraw did
--   1. SELECT creator_withdrawals WHERE tx_hash = ?   (idempotency check)
--   2. rpc('decrement_pending_earnings', realAmount)  (decrement balance)
--   3. INSERT creator_withdrawals (fire-and-forget, UNIQUE(tx_hash))
-- Two concurrent POSTs with the SAME tx_hash both pass step 1 (no row yet) and
-- both decrement in step 2 → pending_earnings_usdc is decremented TWICE for a
-- single on-chain claim. The UNIQUE(tx_hash) only trips on the step-3 INSERT,
-- which is fire-and-forget and does NOT revert the decrement.
--
-- Fix: do the INSERT (idempotency gate) and the decrement in ONE transactional,
-- atomic RPC. The INSERT ... ON CONFLICT (tx_hash) DO NOTHING is the single
-- source of truth: only the row that actually inserts proceeds to decrement.
-- A duplicate inserts 0 rows → returns false → caller treats it as already
-- processed and does NOT decrement.
--
-- Columns mirror EXACTLY what the route inserts today into creator_withdrawals:
--   creator_id (UUID), tx_hash (TEXT, UNIQUE), amount_usdc (NUMERIC).
-- p_amount is the verified on-chain grossAmount (realAmount), never a client value.
CREATE OR REPLACE FUNCTION record_withdrawal_and_decrement(
  p_user_id UUID,
  p_tx_hash TEXT,
  p_amount  NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT;
BEGIN
  INSERT INTO creator_withdrawals (creator_id, tx_hash, amount_usdc)
  VALUES (p_user_id, p_tx_hash, p_amount)
  ON CONFLICT (tx_hash) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Duplicate tx_hash → row already existed → do NOT decrement again.
  IF v_inserted = 0 THEN
    RETURN false;
  END IF;

  UPDATE creator_profiles
  SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
  WHERE id = p_user_id;

  RETURN true;
END;
$$;
