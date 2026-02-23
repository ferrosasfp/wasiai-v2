-- T-07: Create pending_recordings table for on-chain recording retry logic
-- When recordInvocationOnChain() fails, we store the attempt here and retry
-- with exponential backoff via a background process.

CREATE TABLE IF NOT EXISTS public.pending_recordings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_call_id UUID REFERENCES public.agent_calls(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  payer_address TEXT NOT NULL,
  amount_usdc   NUMERIC(18, 6) NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,  -- NULL = pending, set when successfully recorded
  tx_hash       TEXT          -- on-chain tx hash if/when it succeeds
);

-- Index for the retry worker: find all pending items whose retry time has passed
CREATE INDEX IF NOT EXISTS idx_pending_recordings_retry
  ON public.pending_recordings (next_retry_at)
  WHERE resolved_at IS NULL;

-- Enable RLS — only service role can access this table
ALTER TABLE public.pending_recordings ENABLE ROW LEVEL SECURITY;

-- No end-user policies: this table is service-role only
-- The retry worker uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS
