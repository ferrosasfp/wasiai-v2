CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     UUID REFERENCES auth.users ON DELETE CASCADE,
  agent_slug  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','completed','failed')),
  input       JSONB,
  result      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_jobs" ON jobs
  FOR ALL USING (auth.uid() = user_id);

-- Index para queries por user + status
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_created_at  ON jobs(created_at DESC);

-- Auto-cleanup despues de 7 dias
-- (implementado via cron de Supabase o TTL policy)
