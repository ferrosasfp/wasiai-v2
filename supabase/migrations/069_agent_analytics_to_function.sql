-- Migration 069: Replace agent_analytics view with SECURITY DEFINER function
--
-- Problem: Supabase linter flags SECURITY DEFINER views (lint 0010).
-- The view is not used in app code — only exists for ad-hoc queries.
-- Solution: drop the view, replace with a SECURITY DEFINER function
-- that has an explicit search_path (prevents search_path injection).
-- Functions with SECURITY DEFINER + fixed search_path are the Supabase-approved
-- pattern for bypassing RLS when serving aggregated public data.

DROP VIEW IF EXISTS public.agent_analytics;

CREATE OR REPLACE FUNCTION public.get_agent_analytics()
RETURNS TABLE (
  id                  UUID,
  slug                TEXT,
  name                TEXT,
  category            TEXT,
  agent_type          TEXT,
  creator_id          UUID,
  price_per_call      NUMERIC,
  total_calls         BIGINT,
  total_revenue       NUMERIC,
  on_chain_registered BOOLEAN,
  erc8004_id          TEXT,
  reputation_score    NUMERIC,
  calls_24h           BIGINT,
  calls_7d            BIGINT,
  agent_calls_count   BIGINT,
  human_calls_count   BIGINT,
  revenue_24h         NUMERIC,
  avg_latency_ms      NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    COUNT(ac.id) FILTER (WHERE ac.caller_type = 'agent')                     AS agent_calls_count,
    COUNT(ac.id) FILTER (WHERE ac.caller_type = 'human')                     AS human_calls_count,

    SUM(ac.amount_paid) FILTER (WHERE ac.called_at > NOW() - INTERVAL '24 hours') AS revenue_24h,
    AVG(ac.latency_ms)                                                              AS avg_latency_ms

  FROM public.agents a
  LEFT JOIN public.agent_calls ac ON ac.agent_id = a.id
  GROUP BY a.id;
$$;

-- Grant execute to all roles (same access as the old view)
GRANT EXECUTE ON FUNCTION public.get_agent_analytics() TO anon, authenticated, service_role;
