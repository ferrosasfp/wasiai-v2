-- 20260705000001_revoke_legacy_earnings_columns.sql
--
-- WKH-SEC-03 (Phase B) — after the W1 code cutover (all readers/writers now use
-- creator_earnings), do two things:
--   1. Simplify the 3 earnings RPCs from DUAL-WRITE back to SINGLE-WRITE (only
--      creator_earnings — the legacy creator_profiles mirror is no longer read).
--   2. Close the cross-read vector on the 4 legacy earnings/PII columns of
--      creator_profiles at the Postgres level.
--
-- IMPORTANT (BLQ-ALTO-1 fix): a column-level `REVOKE SELECT (col) ... FROM
-- authenticated` is a NO-OP here. Supabase's default ACL grants SELECT
-- *table-level* to anon/authenticated; a column-level REVOKE only removes
-- column-level grants, so the broad table grant keeps every column readable and
-- the cross-read stays open. The correct pattern (same as 20260702020000 and the
-- anon fix applied by hand today) is: REVOKE the table-level SELECT, then GRANT
-- SELECT back on ONLY the safe (catalog) columns. The 4 financial/PII columns are
-- simply left out of every GRANT → service_role only.
--
-- MUST be applied AFTER the W1 code is deployed. Revoking before cutover would
-- break the still-legacy readers. NO DROP COLUMN (reversibility, CD-12) — the
-- columns stay for rollback; only their access is revoked and the RPC writes
-- stop touching them.
--
-- `wallet_address` is NOT revoked (public on-chain datum, DT-3/CD-9).
--
-- Idempotent / re-appliable: CREATE OR REPLACE FUNCTION; REVOKE is idempotent by
-- nature. Wrapped in a single transaction.

BEGIN;

-- ─── RPCs — Phase B: SINGLE-WRITE (only creator_earnings) ─────────────────────
-- Same signatures (CD-7) and the same ownership guard on increment (CD-8); the
-- legacy `UPDATE creator_profiles ...` line is removed.

CREATE OR REPLACE FUNCTION increment_pending_earnings(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'ownership mismatch';
  END IF;
  UPDATE creator_earnings
    SET pending_earnings_usdc = pending_earnings_usdc + p_amount
    WHERE creator_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_pending_earnings(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE creator_earnings
    SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
    WHERE creator_id = p_user_id;
END;
$$;

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

  IF v_inserted = 0 THEN
    RETURN false;
  END IF;

  UPDATE creator_earnings
    SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
    WHERE creator_id = p_user_id;

  RETURN true;
END;
$$;

-- Re-assert service_role-only EXECUTE (idempotent; CREATE OR REPLACE preserves
-- grants but keep this self-contained).
REVOKE EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_withdrawal_and_decrement(UUID, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION record_withdrawal_and_decrement(UUID, TEXT, NUMERIC) TO service_role;

-- ─── Revoke legacy column access ─────────────────────────────────────────────
-- Close the cross-read vector at the Postgres level. A column-level REVOKE SELECT
-- would be a NO-OP against the table-level default-ACL grant (see header), so:
-- REVOKE the table-level SELECT from anon/authenticated, then re-GRANT SELECT on
-- ONLY the safe catalog columns. The 4 financial/PII columns (total_earnings,
-- pending_earnings_usdc, account_status, email_domain) are deliberately excluded
-- from every GRANT → readable by service_role only. `wallet_address` (public
-- on-chain datum, DT-3/CD-9) and every catalog column stay readable. No DROP
-- COLUMN (reversibility, CD-12). REVOKE/GRANT are idempotent by nature.
REVOKE SELECT ON public.creator_profiles FROM anon, authenticated;

-- authenticated: catalog columns + onboarding_* (its own dashboard reads them).
GRANT SELECT (
  id, username, display_name, bio, avatar_url, wallet_address,
  total_models, verified, created_at, onboarding_completed, onboarding_step
) ON public.creator_profiles TO authenticated;

-- anon (public catalog / discovery): catalog columns only, no onboarding_*.
GRANT SELECT (
  id, username, display_name, bio, avatar_url, wallet_address,
  total_models, verified, created_at
) ON public.creator_profiles TO anon;

-- Also strip write access to the 4 legacy columns (all writes go via the
-- SECURITY DEFINER RPCs / service_role). Column-level REVOKE is correct here:
-- these roles have no table-level INSERT/UPDATE path that matters (writes are
-- RPC-only), so this simply removes any residual default-ACL column write grant.
REVOKE INSERT, UPDATE
  ON creator_profiles (total_earnings, pending_earnings_usdc, account_status, email_domain)
  FROM anon, authenticated;

COMMIT;
