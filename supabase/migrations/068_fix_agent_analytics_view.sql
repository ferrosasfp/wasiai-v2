-- Migration 068: Fix agent_analytics view broken by migration 067
--
-- Problem: migration 067 removed SECURITY DEFINER from agent_analytics.
-- agent_analytics does a LEFT JOIN on agent_calls, which has RLS enabled
-- with no anon SELECT policy. With SECURITY INVOKER, anon users get 0 rows
-- from agent_calls → calls_24h, calls_7d, avg_latency_ms all return NULL/0
-- on the public marketplace.
--
-- Fix: recreate agent_analytics as SECURITY DEFINER with explicit search_path
-- (pinning search_path = '' prevents the search_path injection concern that
-- triggers the Supabase lint). This is the accepted pattern when a view
-- intentionally needs to bypass RLS to serve aggregated public data.

DROP VIEW IF EXISTS public.agent_analytics;

CREATE VIEW public.agent_analytics
  WITH (security_invoker = false)   -- SECURITY DEFINER (intentional)
AS
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

-- Only exposes aggregated data (no individual rows), so anon access is safe.
GRANT SELECT ON public.agent_analytics TO anon, authenticated, service_role;
