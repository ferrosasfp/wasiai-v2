-- 20260705000000_creator_earnings_table.sql
--
-- WKH-SEC-03 (Phase A) — close the `authenticated` cross-read vector on
-- earnings/PII columns of creator_profiles.
--
-- Problem: `creator_profiles` is a public catalog (policy profiles_public_read
-- USING(true)) with column-level GRANTs to `authenticated`. That is NOT
-- row-scoped, so any logged-in creator can read another creator's financial /
-- PII columns (total_earnings, pending_earnings_usdc, account_status,
-- email_domain) via a direct PostgREST call with their own JWT.
--
-- Fix (Phase A): move those 4 columns into a new `creator_earnings` table
-- protected by per-row RLS (USING (creator_id = auth.uid())). This migration is
-- ADDITIVE and DUAL-WRITE: the 3 earnings RPCs update BOTH the legacy column in
-- creator_profiles AND the new creator_earnings row, so there is zero staleness
-- during the A -> code-cutover window (caldz is mainnet with real earnings).
-- Phase B (20260705000001) simplifies the RPCs to single-write and REVOKEs the
-- legacy column access. `wallet_address` stays in creator_profiles (public
-- on-chain datum, DT-3) — it is NOT touched here.
--
-- Idempotent / re-appliable: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY /
-- DROP TRIGGER IF EXISTS before CREATE, INSERT ... ON CONFLICT DO NOTHING,
-- CREATE OR REPLACE FUNCTION. Wrapped in a single transaction.

BEGIN;

-- ─── Table ───────────────────────────────────────────────────────────────────
-- Types mirror creator_profiles EXACTLY (verified against the live DB): reusing
-- the existing account_status_enum (do NOT recreate it).
CREATE TABLE IF NOT EXISTS creator_earnings (
  creator_id            UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE,
  total_earnings        NUMERIC(18,6)          DEFAULT 0,               -- nullable (mirror exacto)
  pending_earnings_usdc NUMERIC(20,6) NOT NULL DEFAULT 0,
  account_status        account_status_enum NOT NULL DEFAULT 'active',  -- REUSA el enum existente
  email_domain          TEXT,                                           -- nullable
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: mirror of creator_profiles_account_status_idx (076). Only the
-- non-'active' rows (the spam/review queue) are indexed.
CREATE INDEX IF NOT EXISTS creator_earnings_account_status_idx
  ON creator_earnings (account_status)
  WHERE account_status != 'active';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE creator_earnings ENABLE ROW LEVEL SECURITY;

-- Self-read: an authenticated creator may SELECT only their own row.
DROP POLICY IF EXISTS "creator_earnings_self_read" ON creator_earnings;
CREATE POLICY "creator_earnings_self_read"
  ON creator_earnings
  FOR SELECT
  TO authenticated
  USING (creator_id = auth.uid());

-- Backend: service_role does everything (BYPASSRLS anyway; the policy is
-- defense-in-depth). `TO service_role` is EXPLICIT — omitting it defaults the
-- policy to PUBLIC (the exact bug fixed in 20260702020000).
DROP POLICY IF EXISTS "creator_earnings_service_all" ON creator_earnings;
CREATE POLICY "creator_earnings_service_all"
  ON creator_earnings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No policy for anon — anon gets no access at all.

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- This Supabase project's default ACL grants SELECT/INSERT/UPDATE/DELETE on
-- every new table to anon + authenticated. Strip everything, then grant back
-- ONLY table-level SELECT to authenticated (the RLS policy scopes it to their
-- own row). Writes happen exclusively via SECURITY DEFINER RPCs / service_role.
REVOKE ALL ON creator_earnings FROM anon;
REVOKE ALL ON creator_earnings FROM authenticated;
GRANT SELECT ON creator_earnings TO authenticated;
GRANT ALL   ON creator_earnings TO service_role;

-- ─── Auto-create the mirror row on creator signup ────────────────────────────
-- Covers ALL profile-creation paths (handle_new_user signup trigger,
-- ensureCreatorProfile, v1/agents/register bootstrap): whenever a
-- creator_profiles row is inserted, its creator_earnings mirror is created.
CREATE OR REPLACE FUNCTION create_creator_earnings_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO creator_earnings (creator_id)
  VALUES (NEW.id)
  ON CONFLICT (creator_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_creator_profile_created ON creator_profiles;
CREATE TRIGGER on_creator_profile_created
  AFTER INSERT ON creator_profiles
  FOR EACH ROW EXECUTE FUNCTION create_creator_earnings_row();

-- ─── Backfill existing creators ──────────────────────────────────────────────
-- Copy the current values of the 4 columns for every existing creator.
INSERT INTO creator_earnings (creator_id, total_earnings, pending_earnings_usdc, account_status, email_domain)
  SELECT id, total_earnings, pending_earnings_usdc, account_status, email_domain
  FROM creator_profiles
  ON CONFLICT (creator_id) DO NOTHING;

-- ─── RPCs — Phase A: DUAL-WRITE (firma intacta CD-7, guard intacto CD-8) ──────
-- Each RPC updates creator_earnings AND the legacy creator_profiles column so
-- readers still on the legacy column (until code cutover) stay consistent.

-- increment: keep the ownership guard (CD-8). Dual-write.
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
  UPDATE creator_profiles
    SET pending_earnings_usdc = pending_earnings_usdc + p_amount
    WHERE id = p_user_id;  -- legacy mirror (Phase A)
END;
$$;

-- decrement: clamp at 0 in BOTH tables. Dual-write.
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
  UPDATE creator_profiles
    SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
    WHERE id = p_user_id;  -- legacy mirror (Phase A)
END;
$$;

-- record_withdrawal_and_decrement: idempotent insert-gate unchanged; the balance
-- decrement is applied to BOTH tables. Dual-write.
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

  UPDATE creator_earnings
    SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
    WHERE creator_id = p_user_id;
  UPDATE creator_profiles
    SET pending_earnings_usdc = GREATEST(pending_earnings_usdc - p_amount, 0)
    WHERE id = p_user_id;  -- legacy mirror (Phase A)

  RETURN true;
END;
$$;

-- ─── Function ACL ────────────────────────────────────────────────────────────
-- CREATE OR REPLACE preserves existing grants, but re-assert the service_role-
-- only policy so this migration is self-contained and closes the default-ACL
-- re-grant (pattern from 20260701000000 / 20260702010000).
REVOKE EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_withdrawal_and_decrement(UUID, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION record_withdrawal_and_decrement(UUID, TEXT, NUMERIC) TO service_role;

-- ─── Reconcile (re-runnable) — cutover-drift guard (BLQ-BAJO-1) ───────────────
-- The one-shot backfill above is `ON CONFLICT DO NOTHING`, so it does NOT update
-- an already-existing creator_earnings row. During the Phase-A → deploy window,
-- legacy writers that touch ONLY creator_profiles (the old immediateSettlement
-- `UPDATE creator_profiles SET pending=0`, and the admin/settlement direct
-- fallback) can leave creator_earnings stale. creator_profiles is the source of
-- truth until the code cutover, so re-align creator_earnings from it. The
-- `IS DISTINCT FROM` guard makes this idempotent (updates only drifted rows) and
-- safe to re-run. Cutover procedure (no data-incorrect window):
--   1. apply this Phase A migration,
--   2. deploy the new (single-read/creator_earnings) code IMMEDIATELY,
--   3. re-run ONLY this reconcile block once, AFTER the deploy,
--   4. apply Phase B (20260705000001).
-- See story-WKH-SEC-03.md "Cutover sin-drift".
UPDATE public.creator_earnings ce
SET pending_earnings_usdc = cp.pending_earnings_usdc,
    total_earnings        = cp.total_earnings,
    account_status        = cp.account_status,
    email_domain          = cp.email_domain
FROM public.creator_profiles cp
WHERE ce.creator_id = cp.id
  AND (ce.pending_earnings_usdc IS DISTINCT FROM cp.pending_earnings_usdc
    OR ce.total_earnings        IS DISTINCT FROM cp.total_earnings
    OR ce.account_status        IS DISTINCT FROM cp.account_status
    OR ce.email_domain          IS DISTINCT FROM cp.email_domain);

COMMIT;
