-- 20260702020000_fix_permissive_rls_escrow_ratings.sql
--
-- SECURITY (2026-07-02) — permissive RLS policies applied to PUBLIC, not
-- service_role. Confirmed live on BOTH caldz (mainnet) and bdwv (testnet):
-- pg_policy.polroles = '{0}' (PUBLIC) on the offending policies.
--
-- Root cause (two compounding factors):
--   1. The "service_*" policies below were CREATEd with `FOR ALL/INSERT/UPDATE`
--      USING(true)/WITH CHECK(true) but WITHOUT a `TO service_role` clause, so
--      Postgres defaults them to PUBLIC — i.e. they authorize anon AND
--      authenticated, not just the backend.
--   2. This Supabase project's default ACL grants INSERT/UPDATE/DELETE/SELECT
--      on every new table to anon + authenticated (the same default-ACL that
--      forced 20260702010000_fix_revoke_supabase_default_acl.sql on functions).
--   Together: anyone holding the public anon key (shipped in the frontend) can
--   read/insert/update/delete these rows via direct PostgREST
--   (`POST /rest/v1/escrow_transactions`, `/rest/v1/agent_ratings`).
--
-- Impact:
--   * escrow_transactions (CRITICAL): escrow/settlement bookkeeping — full IDOR
--     (read every escrow) + tampering (insert/flip status/delete any escrow).
--   * agent_ratings (MED-HIGH): reputation integrity — reputation drives agent
--     selection, so unauthenticated ballot-stuffing skews discovery.
--
-- Fix: bind each "service_*" policy to service_role and REVOKE the write grants
-- (and, for escrow, anon SELECT) from anon/authenticated. Mirrors the
-- revoke-from-explicit-roles pattern of 20260701000000 / 20260702010000.
-- App impact: NONE. Every legit call site writes/reads these tables through
-- createServiceClient() (SUPABASE_SERVICE_ROLE_KEY = service_role, BYPASSRLS):
--   escrow_transactions — invoke-long (insert), internal/escrow/release-expired
--     (update), escrow/[escrowId]/status (select, app-gated by payer_user_id).
--   agent_ratings — models/[slug]/rate (upsert + select), cron/reputation-batch.
-- No browser/anon client touches either table.
--
-- Preserved intentionally:
--   * escrow_transactions.payer_read — legit gated SELECT
--     (payer_user_id = auth.uid()); an authenticated payer may read only their
--     own escrows. authenticated keeps table-level SELECT so this still works;
--     anon has no payer identity so its SELECT is revoked.
--   * agent_ratings.ratings_public_read — ratings are public marketplace data
--     (discovery); SELECT for anon/authenticated is intentional and untouched.
--
-- Idempotent / re-appliable: ALTER POLICY ... TO is a no-op if already bound;
-- REVOKE is idempotent by nature. Wrapped in a transaction so the lock-down is
-- all-or-nothing (no window where escrow is revoked but ratings still open).

BEGIN;

-- ─── escrow_transactions ─────────────────────────────────────────────────────
-- Bind the "do everything" backend policy to service_role only (was PUBLIC).
ALTER POLICY "service_all" ON escrow_transactions TO service_role;

-- Strip default-ACL write grants from public roles (backend uses service_role).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON escrow_transactions FROM anon, authenticated;

-- anon must not read escrows at all (no payer identity). authenticated KEEPS
-- SELECT so payer_read can scope it to their own rows.
REVOKE SELECT ON escrow_transactions FROM anon;

-- ─── agent_ratings ───────────────────────────────────────────────────────────
-- Bind the write policies to service_role only (were PUBLIC).
ALTER POLICY "ratings_service_insert" ON agent_ratings TO service_role;
ALTER POLICY "ratings_service_update" ON agent_ratings TO service_role;

-- Strip default-ACL write grants from public roles (backend uses service_role).
-- SELECT is deliberately left intact: ratings_public_read exposes ratings as
-- public discovery data.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON agent_ratings FROM anon, authenticated;

COMMIT;
