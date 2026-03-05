# Work Item #044 — WAS-153: Curated Collections

| Campo | Valor |
|-------|-------|
| **#** | 044 |
| **ID** | WAS-153 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Crear sistema de colecciones curadas donde un admin agrupa agentes por tema, con página índice, página detalle, featured en landing, y link en navbar |

## Acceptance Criteria (EARS)

| # | AC |
|---|-----|
| AC1 | WHEN an admin inserts a row into `collections` table, THE system SHALL store id, slug, name, description, cover_image, featured, sort_order with RLS public read / admin write |
| AC2 | WHEN a user visits `/collections`, THE page SHALL display all active collections as cards with cover_image, name, agent_count, ordered by sort_order |
| AC3 | WHEN a user visits `/collections/:slug`, THE page SHALL display the collection header + grid of agents ordered by `collection_agents.sort_order` |
| AC4 | WHILE collections with `featured=true` exist, THE landing page SHALL display a "Featured Collections" section before the Agent API section |
| AC5 | WHEN a user views the navbar, THE navigation SHALL include a "Collections" link |
| AC6 | WHEN collections page loads, THE page SHALL use ISR with revalidate=300 |

## Scope IN
- Migration 038: `collections` + `collection_agents` tables + RLS + indexes
- Page `/[locale]/collections/page.tsx` (index)
- Page `/[locale]/collections/[slug]/page.tsx` (detail)
- Component `CollectionCard.tsx`
- Landing page: featured collections section
- Navbar: collections link
- i18n keys EN/ES

## Scope OUT
- Admin UI for CRUD collections (managed in Supabase dashboard)
- REST API endpoints for collections
- Search/filter within collections
