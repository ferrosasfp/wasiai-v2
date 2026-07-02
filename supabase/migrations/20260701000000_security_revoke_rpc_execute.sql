-- 20260701000000_security_revoke_rpc_execute.sql
-- Security audit (2026-07-01) remediation — C3, C4, C5, H2, M2.
--
-- Root cause: several SECURITY DEFINER financial RPCs were CREATEd without a
-- `REVOKE EXECUTE ... FROM PUBLIC`. In Postgres `CREATE FUNCTION` grants EXECUTE
-- to PUBLIC by default, and Supabase exposes the `public` schema via PostgREST;
-- `anon`/`authenticated` are members of PUBLIC. Because these functions are
-- SECURITY DEFINER (run as owner, BYPASSRLS), any authenticated caller could
-- invoke them directly over `/rest/v1/rpc/...` and manipulate budgets / earnings
-- / sandbox credits with no ownership or sign check.
--
-- Fix (mirrors the pattern already used by refund_key_balance in migration 048):
--   1. REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO service_role — the only
--      role legitimate server-side call sites use (createServiceClient()).
--   2. Defense in depth inside each function:
--        - amount sign guard (check_and_deduct_budget), and
--        - ownership guard `p_user_id/p_owner_id = auth.uid()` that is a no-op
--          for the service-role caller (auth.uid() IS NULL) but blocks any
--          direct authenticated PostgREST call that might slip through.
--   3. DROP the dead legacy `increment_agent_key_spend` (superseded by
--      check_and_deduct_budget; no call sites in src/).
--
-- NOTE: file is timestamp-named so it sorts AFTER every existing migration
-- (including the 20260625* ones that define decrement_pending_earnings); a
-- `0NN_` name would sort before them and break a fresh replay.
--
-- Idempotent: CREATE OR REPLACE preserves each function's existing logic; the
-- REVOKE/GRANT pair is safe to re-run.

-- ─── C3: check_and_deduct_budget(UUID, NUMERIC) ──────────────────────────────
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
  -- Defense in depth: reject negative amounts (would credit budget instead of debit).
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'p_amount must be non-negative, got %', p_amount;
  END IF;

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

REVOKE EXECUTE ON FUNCTION check_and_deduct_budget(UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION check_and_deduct_budget(UUID, NUMERIC) TO service_role;

-- ─── H2: increment_agent_key_spend(UUID, NUMERIC) — DROP (dead) ──────────────
-- Superseded by check_and_deduct_budget (NG-008). No call sites in src/ (only
-- comments/tests). Dropping removes the redundant unguarded attack surface.
DROP FUNCTION IF EXISTS increment_agent_key_spend(UUID, NUMERIC);

-- ─── C4: increment_key_budget(UUID, NUMERIC, UUID) ───────────────────────────
CREATE OR REPLACE FUNCTION increment_key_budget(
  p_key_id   UUID,
  p_amount   NUMERIC,
  p_owner_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Defense in depth: when invoked by an authenticated PostgREST caller
  -- (auth.uid() IS NOT NULL) the credited owner must be the caller itself.
  -- No-op for the service-role call site (auth.uid() IS NULL).
  IF auth.uid() IS NOT NULL AND p_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'ownership mismatch';
  END IF;

  UPDATE agent_keys
  SET budget_usdc = budget_usdc + p_amount
  WHERE id = p_key_id AND owner_id = p_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Key not found or unauthorized';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_key_budget(UUID, NUMERIC, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION increment_key_budget(UUID, NUMERIC, UUID) TO service_role;

-- ─── C5: increment_pending_earnings(UUID, NUMERIC) ───────────────────────────
CREATE OR REPLACE FUNCTION increment_pending_earnings(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Defense in depth: an authenticated caller may only credit its own profile.
  -- No-op for the service-role call site (auth.uid() IS NULL).
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'ownership mismatch';
  END IF;

  UPDATE creator_profiles
  SET pending_earnings_usdc = pending_earnings_usdc + p_amount
  WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC) TO service_role;

-- ─── C5 (idem): decrement_pending_earnings(UUID, NUMERIC) ────────────────────
-- Same unrevoked SECURITY DEFINER pattern; only ever called internally by the
-- record_withdrawal_and_decrement wrapper (service-role). Revoke to close the
-- direct-PostgREST surface. Logic preserved verbatim (clamped-at-0 decrement).
REVOKE EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC) TO service_role;

-- ─── M2: deduct_sandbox_balance(UUID, NUMERIC) ───────────────────────────────
CREATE OR REPLACE FUNCTION deduct_sandbox_balance(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  -- Defense in depth: an authenticated caller may only debit its own credits.
  -- No-op for the service-role call site (auth.uid() IS NULL).
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'ownership mismatch';
  END IF;

  SELECT balance_usdc INTO v_balance
  FROM sandbox_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE sandbox_credits
  SET balance_usdc = balance_usdc - p_amount,
      total_used   = total_used + p_amount,
      updated_at   = now()
  WHERE user_id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION deduct_sandbox_balance(UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION deduct_sandbox_balance(UUID, NUMERIC) TO service_role;

-- ─── M2: refund_sandbox_balance(UUID, NUMERIC) ───────────────────────────────
CREATE OR REPLACE FUNCTION refund_sandbox_balance(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS VOID AS $$
BEGIN
  -- Defense in depth: an authenticated caller may only refund its own credits.
  -- No-op for the service-role call site (auth.uid() IS NULL).
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'ownership mismatch';
  END IF;

  UPDATE sandbox_credits
  SET balance_usdc = balance_usdc + p_amount,
      updated_at   = now()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION refund_sandbox_balance(UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION refund_sandbox_balance(UUID, NUMERIC) TO service_role;
