-- WAS-189: Dispute resolution table
-- Migration: 062_disputes.sql

CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID NOT NULL REFERENCES agent_calls(id),
  agent_id        UUID NOT NULL REFERENCES agents(id),
  caller_key_id   UUID NOT NULL REFERENCES agent_keys(id),
  reason          TEXT NOT NULL,            -- 'bad_output' | 'timeout' | 'no_response' | 'other'
  description     TEXT,                     -- Libre, max 500 chars
  status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'approved' | 'rejected'
  resolution_note TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_disputes_agent_id ON disputes(agent_id);
CREATE INDEX idx_disputes_caller_key_id ON disputes(caller_key_id);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE UNIQUE INDEX idx_disputes_call_id_unique ON disputes(call_id); -- 1 dispute por call

-- RLS: solo service_role
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON disputes USING (false);
GRANT ALL ON disputes TO service_role;
