-- Migration 007: Atomic agent stats increment
-- Prevents race conditions when multiple calls arrive simultaneously
-- Run in Supabase Dashboard → SQL Editor

-- PERF-01: Atomic increment of total_calls and total_revenue
CREATE OR REPLACE FUNCTION increment_agent_stats(
  p_agent_id  UUID,
  p_amount    NUMERIC(18,6)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE agents
  SET
    total_calls   = total_calls + 1,
    total_revenue = total_revenue + p_amount
  WHERE id = p_agent_id;
END;
$$;

-- Grant execute to service role (used by backend)
GRANT EXECUTE ON FUNCTION increment_agent_stats(UUID, NUMERIC) TO service_role;
