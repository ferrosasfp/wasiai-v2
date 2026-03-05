# Story File #044 — Curated Collections

## Goal
Create a curated collections system: two DB tables, two new pages (index + detail), a card component, featured section on landing, and navbar link. Admin manages collections via Supabase dashboard.

## Acceptance Criteria
- AC1: `collections` + `collection_agents` tables with RLS public read
- AC2: `/collections` shows all collections as cards ordered by sort_order
- AC3: `/collections/:slug` shows collection header + agent grid ordered by sort_order
- AC4: Landing page shows "Featured Collections" section when featured=true exist
- AC5: Navbar includes "Collections" link
- AC6: Both pages use ISR revalidate=300

## Files

| Action | Path | Exemplar |
|--------|------|----------|
| CREATE | `supabase/migrations/038_collections.sql` | `037_trending_agents_rpc.sql` |
| CREATE | `src/features/collections/components/CollectionCard.tsx` | `ModelCard.tsx` |
| CREATE | `src/app/[locale]/collections/page.tsx` | `src/app/[locale]/page.tsx` |
| CREATE | `src/app/[locale]/collections/[slug]/page.tsx` | `src/app/[locale]/models/[slug]/page.tsx` |
| MODIFY | `src/app/[locale]/page.tsx` | add featured collections query + section |
| MODIFY | `src/components/WasiNavBar.tsx` | add `/collections` to primaryLinks |
| MODIFY | `messages/en.json` + `messages/es.json` | add `collections` namespace |

## Constraint Directives
- ISR `revalidate = 300`
- Join table PK `(collection_id, agent_id)` — NO array
- RLS enabled, public SELECT only
- `React.memo` on CollectionCard
- NO new dependencies
- NO API routes for collections
- NO `Date.now()` in render

## Waves

### W0: Migration + i18n
1. Create `038_collections.sql`: tables, RLS, indexes
2. Add i18n keys: `collections.title`, `collections.viewAll`, `collections.agents`, `collections.featured`, `collections.empty`, `collections.backToCollections`; `nav.collections`; `home.featuredCollections`

### W1: Components + Pages
1. `CollectionCard.tsx` — memo'd card with cover_image, name, description, agent_count, Link to `/collections/:slug`
2. `/collections/page.tsx` — ISR index, query all collections with agent count
3. `/collections/[slug]/page.tsx` — ISR detail, query collection + agents via join, notFound if missing

### W2: Landing + Navbar
1. Add featured collections query to landing page (isFirstPage, supabase, featured=true, limit 4)
2. Add section before Agent API with CollectionCard grid
3. Add `{ path: '/collections', label: tNav('collections') }` to primaryLinks in WasiNavBar

## Out of Scope
- Admin CRUD UI
- REST API endpoints
- Search/filter within collections
