-- 071_agent_categories.sql
CREATE TABLE IF NOT EXISTS agent_categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed inicial (todas las categorías existentes + hardcodeadas)
INSERT INTO agent_categories (slug, label) VALUES
  ('nlp',        'Natural Language Processing'),
  ('vision',     'Computer Vision'),
  ('audio',      'Audio Processing'),
  ('code',       'Code & Development'),
  ('multimodal', 'Multimodal'),
  ('data',       'Data & Analytics'),
  ('defi',       'DeFi'),
  ('defi-risk',  'DeFi Risk Analysis'),
  ('security',   'Security & Audit')
ON CONFLICT (slug) DO NOTHING;

-- RLS: lectura pública, escritura solo service_role
ALTER TABLE agent_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_categories_read" ON agent_categories FOR SELECT USING (true);
