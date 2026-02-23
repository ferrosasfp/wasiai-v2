-- ERC-8004 Reputation Registry
-- Stores per-user votes on agents, prevents double-voting,
-- and auto-updates reputation_score + reputation_count on agents table.

CREATE TABLE agent_ratings (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id      UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  voter_id      TEXT        NOT NULL, -- wallet address OR hashed IP for anon users
  rating        SMALLINT    NOT NULL CHECK (rating IN (1, -1)), -- 1=up, -1=down
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (agent_id, voter_id)
);

ALTER TABLE agent_ratings ENABLE ROW LEVEL SECURITY;

-- Anyone can read ratings (public discovery)
CREATE POLICY "ratings_public_read"
  ON agent_ratings FOR SELECT USING (true);

-- Insert: service role only (API handles auth logic)
CREATE POLICY "ratings_service_insert"
  ON agent_ratings FOR INSERT WITH CHECK (true);

-- Update: service role only
CREATE POLICY "ratings_service_update"
  ON agent_ratings FOR UPDATE USING (true);

-- Index for fast lookups
CREATE INDEX idx_agent_ratings_agent_id ON agent_ratings(agent_id);
CREATE INDEX idx_agent_ratings_voter    ON agent_ratings(agent_id, voter_id);

-- ── Trigger: keep agents.reputation_score + agents.reputation_count in sync ──

CREATE OR REPLACE FUNCTION update_agent_reputation()
RETURNS TRIGGER AS $$
DECLARE
  v_agent_id UUID;
  v_total    INT;
  v_ups      INT;
  v_score    NUMERIC;
BEGIN
  -- Determine which agent changed
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);

  SELECT
    COUNT(*)                                              AS total,
    COUNT(*) FILTER (WHERE rating = 1)                   AS ups
  INTO v_total, v_ups
  FROM agent_ratings
  WHERE agent_id = v_agent_id;

  -- Score: percentage of upvotes (0-100), NULL if no votes yet
  IF v_total > 0 THEN
    v_score := ROUND((v_ups::NUMERIC / v_total) * 100, 1);
  ELSE
    v_score := NULL;
  END IF;

  UPDATE agents
  SET
    reputation_score = v_score,
    reputation_count = v_total,
    updated_at       = now()
  WHERE id = v_agent_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_agent_reputation
  AFTER INSERT OR UPDATE OR DELETE ON agent_ratings
  FOR EACH ROW EXECUTE FUNCTION update_agent_reputation();
