-- supabase/migrations/021_agent_examples.sql
-- ⚠️ NÚMERO CRÍTICO: 021 (NO 017 — ese número ya está ocupado)
-- Historia: HU-4.3 — Ejemplos Input/Output Curados — Sprint 8

CREATE TABLE agent_examples (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  creator_id  UUID        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  label       TEXT        CHECK (char_length(label) <= 60),
  input       TEXT        NOT NULL CHECK (char_length(input) <= 500),
  output      TEXT        NOT NULL CHECK (char_length(output) <= 1000),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE agent_examples ENABLE ROW LEVEL SECURITY;

-- Lectura pública (para la ficha del agente en /models/[slug])
CREATE POLICY "agent_examples_public_read"
  ON agent_examples FOR SELECT
  USING (true);

-- Solo el creator dueño puede escribir (INSERT, UPDATE, DELETE)
-- WITH CHECK explícito para evitar ambigüedad en políticas FOR ALL
CREATE POLICY "Creator write"
  ON agent_examples FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- Índice primario: ordenar ejemplos de un agente
CREATE INDEX idx_agent_examples_agent_id
  ON agent_examples(agent_id, sort_order);

-- Índice secundario: ordenar por fecha de creación (usado en MVP)
CREATE INDEX idx_agent_examples_agent_created
  ON agent_examples(agent_id, created_at ASC);

-- NOTA: NO crear trigger moddatetime — puede no estar disponible en todos los planes.
-- updated_at se actualiza con NOW() explícito en el PATCH handler.
