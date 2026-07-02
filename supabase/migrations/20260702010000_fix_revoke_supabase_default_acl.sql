-- 20260702010000_fix_revoke_supabase_default_acl.sql
--
-- CRITICAL FOLLOW-UP to 20260701000000_security_revoke_rpc_execute.sql: the
-- earlier migration's `REVOKE EXECUTE ... FROM PUBLIC` did NOT close the
-- vulnerability, verified empirically post-deploy on bdwv.
--
-- Root cause: this Supabase project has an ALTER DEFAULT PRIVILEGES entry for
-- the `postgres` role in the `public` schema (`pg_default_acl`, defaclobjtype
-- 'f') that grants EXECUTE on every newly created function EXPLICITLY to
-- anon, authenticated AND service_role — independent of the PUBLIC
-- pseudo-role. `REVOKE ... FROM PUBLIC` only removes PUBLIC's own grant; it
-- does not touch these separate, explicit per-role grants. Confirmed via
-- information_schema.routine_privileges: anon/authenticated remained listed
-- as explicit grantees on all 6 functions after 20260701000000 applied
-- cleanly (no error — REVOKE FROM PUBLIC succeeded, it just revoked a grant
-- that wasn't the one actually authorizing the callers).
--
-- Fix: revoke from PUBLIC, anon, authenticated explicitly (matches the
-- pattern already used correctly for claim_refund in
-- 20260702000000_reconcile_bdwv_drift.sql, and for refund_key_balance in 048).
REVOKE EXECUTE ON FUNCTION check_and_deduct_budget(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_key_budget(UUID, NUMERIC, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION deduct_sandbox_balance(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refund_sandbox_balance(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;

-- Re-grant to service_role explicitly (idempotent no-op if already granted;
-- ensures the legit server-side call sites, all on createServiceClient(),
-- keep working).
GRANT EXECUTE ON FUNCTION check_and_deduct_budget(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION increment_key_budget(UUID, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_pending_earnings(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION decrement_pending_earnings(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION deduct_sandbox_balance(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION refund_sandbox_balance(UUID, NUMERIC) TO service_role;
