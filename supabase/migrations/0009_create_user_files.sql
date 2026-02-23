-- T-01: Create user_files table to track CID ownership per user
-- Closes the security gap where any authenticated user could delete any CID.

CREATE TABLE IF NOT EXISTS public.user_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cid         TEXT NOT NULL,
  filename    TEXT,
  mime_type   TEXT,
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate CID entries per user
  UNIQUE (user_id, cid)
);

-- Index for fast lookup by user + CID
CREATE INDEX IF NOT EXISTS idx_user_files_user_id ON public.user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_cid     ON public.user_files(cid);

-- Enable Row Level Security
ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own files
CREATE POLICY "user_files_select_own"
  ON public.user_files
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: users can only insert their own files
CREATE POLICY "user_files_insert_own"
  ON public.user_files
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: users can only delete their own files
CREATE POLICY "user_files_delete_own"
  ON public.user_files
  FOR DELETE
  USING (auth.uid() = user_id);
