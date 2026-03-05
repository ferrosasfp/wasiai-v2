-- 037: RPC function for trending agents (most calls in last N days)
-- Used by landing page "Trending This Week" section

CREATE OR REPLACE FUNCTION get_trending_agents(days integer DEFAULT 7, limit_count integer DEFAULT 6)
RETURNS SETOF agents
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT a.*
  FROM agents a
  INNER JOIN (
    SELECT agent_id, COUNT(*) as recent_calls
    FROM agent_calls
    WHERE called_at >= now() - (days || ' days')::interval
      AND status = 'success'
    GROUP BY agent_id
    ORDER BY recent_calls DESC
    LIMIT limit_count
  ) trending ON trending.agent_id = a.id
  WHERE a.status = 'active'
  ORDER BY trending.recent_calls DESC;
$$;

-- Index to speed up the trending query (if not already present)
CREATE INDEX IF NOT EXISTS idx_agent_calls_called_at_status
  ON agent_calls(called_at DESC, status)
  WHERE status = 'success';
