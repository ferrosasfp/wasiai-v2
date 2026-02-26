-- Migration 016: username en creator_profiles + agent_trials (HU-1.5 + HU-3.1)

-- HU-1.5: username en creator_profiles
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_profiles_username_lower
  ON creator_profiles (LOWER(username));

UPDATE creator_profiles cp
SET username = (
  SELECT REGEXP_REPLACE(
    LOWER(SPLIT_PART(u.email, '@', 1)),
    '[^a-z0-9_]', '', 'g'
  )
  FROM auth.users u WHERE u.id = cp.id
)
WHERE username IS NULL;

-- HU-3.1: is_trial en agent_calls
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE;

-- HU-3.1: tabla agent_trials
CREATE TABLE IF NOT EXISTS agent_trials (
  id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id)
);

ALTER TABLE agent_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_sees_own_trials" ON agent_trials
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_trials_user_agent
  ON agent_trials (user_id, agent_id);
