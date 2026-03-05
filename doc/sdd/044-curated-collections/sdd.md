# SDD #044 — Curated Collections

## Context Map

| Archivo | Patrón |
|---------|--------|
| `src/app/[locale]/models/[slug]/page.tsx` | ISR detail page: `revalidate=300`, `notFound()`, `setRequestLocale`, `getTranslations` |
| `src/app/[locale]/page.tsx` | Landing con secciones curadas, Supabase queries, ModelCard grid |
| `src/components/WasiNavBar.tsx` | `primaryLinks[]` array para links top-level |
| `src/features/models/components/ModelCard.tsx` | Memoized card component |
| `supabase/migrations/037_trending_agents_rpc.sql` | Migration exemplar |

## Database Design

### Table: `collections`
```sql
CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  cover_image text,
  featured    boolean DEFAULT false,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
```

### Table: `collection_agents` (join table)
```sql
CREATE TABLE collection_agents (
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  agent_id      uuid REFERENCES agents(id) ON DELETE CASCADE,
  sort_order    integer DEFAULT 0,
  PRIMARY KEY (collection_id, agent_id)
);
```

### RLS
- `collections`: public SELECT, no INSERT/UPDATE/DELETE via API (admin via service role)
- `collection_agents`: public SELECT, no INSERT/UPDATE/DELETE via API

### Indexes
- `collections(sort_order)` — para ORDER BY
- `collection_agents(collection_id, sort_order)` — para query detalle

## Files to Create/Modify

| Action | Path | Exemplar |
|--------|------|----------|
| CREATE | `supabase/migrations/038_collections.sql` | `037_trending_agents_rpc.sql` |
| CREATE | `src/app/[locale]/collections/page.tsx` | `src/app/[locale]/page.tsx` (ISR pattern) |
| CREATE | `src/app/[locale]/collections/[slug]/page.tsx` | `src/app/[locale]/models/[slug]/page.tsx` |
| CREATE | `src/features/collections/components/CollectionCard.tsx` | `ModelCard.tsx` (memo, Link) |
| MODIFY | `src/app/[locale]/page.tsx` | — (add featured collections section) |
| MODIFY | `src/components/WasiNavBar.tsx` | — (add collections to primaryLinks) |
| MODIFY | `messages/en.json` + `messages/es.json` | — (add `collections` namespace) |

## Constraint Directives

### OBLIGATORIO
- ISR `revalidate = 300` en ambas páginas collections
- Join table `collection_agents(collection_id, agent_id)` con PK compuesta — NO array `agent_ids uuid[]`
- RLS habilitado en ambas tablas
- `React.memo` en `CollectionCard`
- Usar `setRequestLocale` + `getTranslations` pattern de pages existentes

### PROHIBIDO
- NO crear API routes REST para collections (admin usa Supabase dashboard)
- NO agregar dependencias nuevas
- NO crear patrones de componentes diferentes a los existentes
- NO modificar archivos fuera de Scope IN
- NO usar `Date.now()` en render (React compiler)

## Waves

| Wave | Tareas | Verificación |
|------|--------|-------------|
| W0 | Migration 038 + i18n keys | typecheck |
| W1 | CollectionCard + collections index page + detail page | typecheck + build |
| W2 | Landing featured section + navbar link | build clean |

## Readiness Check

- [x] Cada AC tiene archivo asociado
- [x] Exemplars verificados con Read
- [x] No hay [NEEDS CLARIFICATION]
- [x] 3+ PROHIBIDO en Constraint Directives
- [x] Context Map con 5 archivos leídos
- [x] Scope IN/OUT explícitos
- [x] BD: tablas diseñadas con PK, FK, RLS
