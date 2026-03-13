-- Migration 053: Agent Key Scoping
-- WAS-186 | Sprint 2

ALTER TABLE agent_keys
  ADD COLUMN IF NOT EXISTS allowed_slugs      TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS allowed_categories TEXT[] DEFAULT NULL;

COMMENT ON COLUMN agent_keys.allowed_slugs IS
  'NULL = acceso total. Array de slugs permitidos para esta key.';
COMMENT ON COLUMN agent_keys.allowed_categories IS
  'NULL = sin filtro por categoría. Array de categorías permitidas para esta key.';

CREATE INDEX IF NOT EXISTS idx_agent_keys_allowed_slugs
  ON agent_keys USING GIN (allowed_slugs)
  WHERE allowed_slugs IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_keys_allowed_categories
  ON agent_keys USING GIN (allowed_categories)
  WHERE allowed_categories IS NOT NULL;
