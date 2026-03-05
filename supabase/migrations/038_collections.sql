-- 038: Curated Collections — WAS-153 / SDD #044

-- Collections table
CREATE TABLE IF NOT EXISTS collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  cover_image text,
  featured    boolean DEFAULT false,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Join table (NOT an array — normalized design)
CREATE TABLE IF NOT EXISTS collection_agents (
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  agent_id      uuid REFERENCES agents(id) ON DELETE CASCADE,
  sort_order    integer DEFAULT 0,
  PRIMARY KEY (collection_id, agent_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_collections_sort_order
  ON collections(sort_order);

CREATE INDEX IF NOT EXISTS idx_collection_agents_order
  ON collection_agents(collection_id, sort_order);

-- RLS: public read only
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_public_read" ON collections
  FOR SELECT USING (true);

CREATE POLICY "collection_agents_public_read" ON collection_agents
  FOR SELECT USING (true);
