-- 20260702000000_reconcile_bdwv_drift.sql
--
-- bdwv (the DB wasiai-v2 actually uses at runtime, per NEXT_PUBLIC_SUPABASE_URL)
-- had significant drift from the migration history: several migrations (065,
-- 070, 071, 073, 076, 20260625080000) had their target objects created
-- out-of-band at some point without going through the tracked migration flow,
-- so re-running the original files hit "already exists" errors on their
-- unguarded statements. Verified read-only (pg_catalog / information_schema)
-- against bdwv before writing this file; only the two gaps below were
-- confirmed genuinely missing. Everything else from those files was already
-- present and matched the intended definition exactly.
--
-- Gap 1 (from 076_add_account_status.sql): the enum type, both columns, and
-- the email_domain index already existed — only this partial index was
-- missing.
CREATE INDEX IF NOT EXISTS creator_profiles_account_status_idx
  ON creator_profiles (account_status)
  WHERE account_status != 'active';

-- Gap 2 (from 20260625080000_x402_refunds.sql): the refunds table, both
-- indexes, RLS, and the claim_refund() function all already existed — but the
-- REVOKE/GRANT pair at the end of that file had never actually run, so
-- claim_refund() was still executable by anon/authenticated (confirmed via
-- information_schema.routine_privileges) instead of service_role-only as the
-- migration intended. This is a real, if minor, privilege gap — claim_refund
-- only flips a refund row pending->processing and is guarded by
-- `WHERE status = 'pending'`, so the practical exposure is limited to
-- griefing the refund queue's `attempts` counter, not moving funds — but it
-- should still be service_role-only per the original design.
REVOKE EXECUTE ON FUNCTION claim_refund(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_refund(UUID) TO service_role;
