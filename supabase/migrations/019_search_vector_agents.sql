-- ============================================================
-- 019_search_vector_agents.sql
-- HU-4.1: Full-text search con tsvector + índice GIN en agents
-- ============================================================

-- 1. Agregar columna tags (array de texto) si no existe
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- 2. Agregar columna search_vector
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 3. Índice GIN sobre search_vector (performance O(log n))
CREATE INDEX IF NOT EXISTS idx_agents_search_vector
  ON agents USING GIN (search_vector);

-- 4. Índice GIN sobre tags para filtros futuros
CREATE INDEX IF NOT EXISTS idx_agents_tags
  ON agents USING GIN (tags);

-- 5. Función para calcular search_vector con weights:
--    A = name (peso más alto)
--    B = tags
--    C = description
CREATE OR REPLACE FUNCTION agents_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger en INSERT y UPDATE de columnas relevantes
DROP TRIGGER IF EXISTS trg_agents_search_vector ON agents;
CREATE TRIGGER trg_agents_search_vector
  BEFORE INSERT OR UPDATE OF name, description, tags
  ON agents
  FOR EACH ROW
  EXECUTE FUNCTION agents_search_vector_update();

-- 7. Backfill: poblar search_vector en todos los agentes existentes
UPDATE agents SET
  search_vector =
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C');

-- 8. Función RPC para búsqueda rankeada (usada por el endpoint API)
CREATE OR REPLACE FUNCTION search_agents(
  search_query     text,
  filter_category  text    DEFAULT NULL,
  filter_agent_type text   DEFAULT NULL,
  result_limit     int     DEFAULT 20,
  result_offset    int     DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  slug             text,
  name             text,
  description      text,
  category         text,
  agent_type       text,
  price_per_call   numeric,
  is_featured      boolean,
  total_calls      bigint,
  rank             float4
) LANGUAGE sql STABLE AS $$
  SELECT
    a.id,
    a.slug,
    a.name,
    a.description,
    a.category,
    a.agent_type,
    a.price_per_call,
    a.is_featured,
    a.total_calls,
    ts_rank(a.search_vector, websearch_to_tsquery('simple', search_query)) AS rank
  FROM agents a
  WHERE
    a.status = 'active'
    AND a.search_vector @@ websearch_to_tsquery('simple', search_query)
    AND (filter_category   IS NULL OR a.category   = filter_category)
    AND (filter_agent_type IS NULL OR a.agent_type = filter_agent_type)
  ORDER BY rank DESC, a.is_featured DESC, a.total_calls DESC
  LIMIT  result_limit
  OFFSET result_offset;
$$;

-- RLS: la función hereda las políticas RLS de la tabla agents
GRANT EXECUTE ON FUNCTION search_agents TO authenticated, anon;

-- Nota: se usa 'simple' (idioma-agnóstico) para MVP.
-- Evaluar 'spanish' o 'english' si el catálogo crece y los resultados son irrelevantes.
