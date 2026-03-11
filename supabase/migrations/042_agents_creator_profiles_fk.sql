-- 042: Add FK from agents.creator_id to creator_profiles.id
-- Required for PostgREST embedding (PGRST200 error fix)
-- creator_id already references auth.users(id) and creator_profiles.id = auth.users.id
-- This creates the explicit FK relationship PostgREST needs for embeds

-- Safe: both agents.creator_id and creator_profiles.id reference the same auth.users.id
ALTER TABLE agents
  ADD CONSTRAINT agents_creator_id_creator_profiles_fk
  FOREIGN KEY (creator_id)
  REFERENCES creator_profiles(id)
  ON DELETE SET NULL
  NOT VALID;  -- Skip validation for existing data (already consistent)

-- Validate constraint (runs check in background, doesn't lock)
ALTER TABLE agents
  VALIDATE CONSTRAINT agents_creator_id_creator_profiles_fk;
