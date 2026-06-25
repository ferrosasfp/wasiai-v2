-- V8 (audit 2026-06-25): atomic guard against concurrent withdrawal vouchers.
--
-- Problem: /api/creator/earnings/voucher signs an EIP-712 ClaimEarnings voucher
-- for grossAmount = pending_earnings_usdc(T0) and only THEN inserts an audit row
-- (fire-and-forget). With the 10/hour rate limit a creator could request two
-- vouchers in quick succession; both read the same pending balance, both get a
-- valid signature with distinct nonces. If the contract holds enough USDC both
-- claims could execute on-chain → the creator withdraws ~2x the real balance.
-- The withdraw flow does NOT mark vouchers consumed (it only verifies the
-- on-chain EarningsClaimed event by tx_hash), so the only thing releasing a
-- voucher today is its deadline (expiry).
--
-- Fix: make the audit INSERT the gate (no longer fire-and-forget) and do it
-- atomically: insert the voucher ONLY when there is no other voucher for the
-- same creator that is still 'pending' AND not past its deadline. The single
-- INSERT ... SELECT ... WHERE NOT EXISTS(...) is evaluated atomically by
-- Postgres, so two concurrent requests can never both insert: exactly one wins,
-- the other inserts 0 rows and is rejected (409) by the route BEFORE signing.
--
-- M1 (fix-pack): the INSERT ... SELECT ... WHERE NOT EXISTS is NOT a structural
-- guarantee under READ COMMITTED. Two concurrent requests each insert a NEW row,
-- so they never collide on a shared row — both can pass the NOT EXISTS predicate
-- and insert 2 pending vouchers → 2 valid signatures → possible double-withdraw.
-- The structural fix is a PARTIAL UNIQUE INDEX: at most one 'pending' voucher per
-- creator can physically exist. The 2nd concurrent INSERT then fails on the index
-- (unique_violation), which the function below catches and maps to false — the
-- exact same "already pending" outcome the route turns into a 409.
--
-- Valid: creator_withdrawal_vouchers has a `status` column (043_withdrawal_vouchers).
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_one_pending_per_creator
  ON creator_withdrawal_vouchers (creator_id)
  WHERE status = 'pending';

-- deadline is a unix epoch (BIGINT) exactly as the route stores it
-- (Number(deadline) = floor(now/1000) + 3600). "vigent" = deadline > now epoch.
-- Columns mirror EXACTLY what the route inserts today into
-- creator_withdrawal_vouchers.
--
-- M3 (fix-pack): SET search_path is pinned (SECURITY DEFINER hardening) so an
-- attacker cannot shadow `creator_withdrawal_vouchers`/`now()` via a malicious
-- search_path and divert the insert.
CREATE OR REPLACE FUNCTION insert_voucher_if_none_pending(
  p_creator_id     UUID,
  p_wallet_address TEXT,
  p_gross_amount   NUMERIC,
  p_nonce          TEXT,
  p_deadline       BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INT;
BEGIN
  -- NOTE: the WHERE NOT EXISTS still rejects expired/stale pending rows cheaply
  -- without raising; the partial unique index is the hard structural backstop for
  -- the concurrent case (two live inserts racing on a fresh, non-expired slot).
  INSERT INTO creator_withdrawal_vouchers (
    creator_id, wallet_address, gross_amount_usdc, nonce, deadline, status
  )
  SELECT p_creator_id, p_wallet_address, p_gross_amount, p_nonce, p_deadline, 'pending'
  WHERE NOT EXISTS (
    SELECT 1
    FROM creator_withdrawal_vouchers v
    WHERE v.creator_id = p_creator_id
      AND v.status = 'pending'
      AND v.deadline > EXTRACT(EPOCH FROM now())
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 0 rows → a pending, non-expired voucher already exists → reject (do NOT sign).
  RETURN v_inserted > 0;
EXCEPTION
  -- M1: the 2nd of two concurrent inserts lost the race on
  -- uq_voucher_one_pending_per_creator → another pending voucher now exists →
  -- same outcome as the NOT EXISTS path: reject. Resolves the race as 409, not 500.
  WHEN unique_violation THEN
    RETURN false;
END;
$$;
