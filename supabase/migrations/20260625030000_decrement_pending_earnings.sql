-- V7 (audit 2026-06-25): atomic decrement of pending_earnings_usdc on withdraw.
--
-- Problem: /api/creator/withdraw reset pending_earnings_usdc = 0 unconditionally
-- after verifying the on-chain EarningsClaimed event. If the creator accrued new
-- earnings BETWEEN signing the voucher (T0) and claiming on-chain (T1), the claim
-- only releases grossAmount(T0) but the reset to 0 wiped the (T1 - T0) delta →
-- the creator silently lost those earnings.
--
-- Fix: decrement EXACTLY the verified on-chain amount (grossAmount from the
-- event log, NOT a client value), clamped at 0. Atomic single-statement UPDATE
-- avoids read-modify-write races with concurrent increment_pending_earnings().
CREATE OR REPLACE FUNCTION decrement_pending_earnings(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE creator_profiles
  SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
  WHERE id = p_user_id;
END;
$$;
