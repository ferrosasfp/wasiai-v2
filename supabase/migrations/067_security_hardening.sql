-- Migration 067: Security hardening
-- Fixes Supabase security linter ERRORs:
--   1. Remove SECURITY DEFINER from creator_pending_earnings view
--   2. Remove SECURITY DEFINER from agent_analytics view
--   3. Enable RLS on marketplace_contracts (public read-only)
--   4. Enable RLS on key_batch_settlements (service role only)
--   5. Enable RLS on onboarding_sessions (service role only + owner read)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. creator_pending_earnings — recreate WITHOUT SECURITY DEFINER
-- The view aggregates earnings per creator. Access is controlled by the
-- service role key on the API side — no direct user access needed.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.creator_pending_earnings;

CREATE VIEW public.creator_pending_earnings AS
SELECT
  cp.id                                               AS creator_id,
  cp.username,
  cp.wallet_address,
  COUNT(ac.id)                                        AS total_calls,
  SUM(ac.amount_paid)                                 AS total_earned,
  SUM(ac.amount_paid) * 0.90                          AS creator_share,
  SUM(ac.amount_paid) * 0.10                          AS platform_share,
  MAX(ac.called_at)                                   AS last_call_at
FROM creator_profiles cp
JOIN agents           a  ON a.creator_id = cp.id
JOIN agent_calls      ac ON ac.agent_id  = a.id AND ac.status = 'success'
GROUP BY cp.id, cp.username, cp.wallet_address;

-- Revoke anon/authenticated direct access — only service_role queries this view
REVOKE ALL ON public.creator_pending_earnings FROM anon, authenticated;
GRANT SELECT ON public.creator_pending_earnings TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. agent_analytics — recreate WITHOUT SECURITY DEFINER
-- Used in the public marketplace; anon read is intentional.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.agent_analytics;

CREATE VIEW public.agent_analytics AS
SELECT
  a.id,
  a.slug,
  a.name,
  a.category,
  a.agent_type,
  a.creator_id,
  a.price_per_call,
  a.total_calls,
  a.total_revenue,
  a.on_chain_registered,
  a.erc8004_id,
  a.reputation_score,

  COUNT(ac.id) FILTER (WHERE ac.called_at > NOW() - INTERVAL '24 hours')  AS calls_24h,
  COUNT(ac.id) FILTER (WHERE ac.called_at > NOW() - INTERVAL '7 days')    AS calls_7d,
  COUNT(ac.id) FILTER (WHERE ac.caller_type = 'agent')                     AS agent_calls,
  COUNT(ac.id) FILTER (WHERE ac.caller_type = 'human')                     AS human_calls,

  SUM(ac.amount_paid) FILTER (WHERE ac.called_at > NOW() - INTERVAL '24 hours') AS revenue_24h,
  AVG(ac.latency_ms)                                                              AS avg_latency_ms
FROM agents a
LEFT JOIN agent_calls ac ON ac.agent_id = a.id
GROUP BY a.id;

-- Public marketplace view — anon and authenticated can read
GRANT SELECT ON public.agent_analytics TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. marketplace_contracts — enable RLS (public read-only table)
-- Contains chain/contract address config. Anyone can read, nobody can write
-- directly (writes go through service_role in migrations only).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.marketplace_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketplace_contracts_read_all"
  ON public.marketplace_contracts
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true);

-- No INSERT/UPDATE/DELETE policies for anon or authenticated
-- (service_role bypasses RLS by default)

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. key_batch_settlements — enable RLS (cron/service_role only)
-- Settlements are written by the cron job (service_role) and read by the
-- creator transactions API (also service_role). No direct user access.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.key_batch_settlements ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS; no policy needed for service_role.
-- Deny all access to anon and authenticated (they use the API, not direct DB).
-- (No policies = deny by default for non-service_role roles)

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. onboarding_sessions — enable RLS (service_role only)
-- The onboarding wizard API uses service_role for all DB operations.
-- No direct user access to this table is needed.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- No policies = deny by default for anon/authenticated.
-- service_role bypasses RLS — wizard API continues to work as-is.
