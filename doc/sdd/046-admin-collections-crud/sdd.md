# SDD #046 — Admin Collections CRUD

## Context Map (Codebase Grounding)

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/[locale]/admin/page.tsx` | Exemplar admin UI | `useReducer(() => true, false)` mount, `ADMIN_ALLOWED` wallet check, `useTranslations('admin')`, dark theme `bg-gray-950 text-white` |
| `src/app/api/admin/status/route.ts` | Exemplar admin API | `createServiceClient()`, sin auth server-side |
| `src/features/collections/components/CollectionCard.tsx` | Collection data shape | `{id, slug, name, description, cover_image, featured, agent_count}` |
| `supabase/migrations/038_collections.sql` | Tables schema | `collections` + `collection_agents(collection_id, agent_id, sort_order)` PK compuesta |

### Exemplars
| Para crear | Seguir patrón de |
|-----------|-----------------|
| Admin collections page | `admin/page.tsx` (wallet auth, dark theme, fetch pattern) |
| Admin API routes | `api/admin/status/route.ts` (createServiceClient, no server auth) |

## Architecture

### Admin UI (`/admin` — nueva sección en la misma página o sub-ruta)
Decisión: **Componente separado importado en admin/page.tsx** — mantiene una sola página admin con secciones colapsables (patrón existente con Treasury).

### API Routes
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/collections` | List all collections with agent count |
| POST | `/api/admin/collections` | Create collection |
| PUT | `/api/admin/collections` | Update collection (id in body) |
| DELETE | `/api/admin/collections` | Delete collection (id in body) |
| GET | `/api/admin/collections/[id]/agents` | List agents in collection |
| POST | `/api/admin/collections/[id]/agents` | Add agent to collection |
| DELETE | `/api/admin/collections/[id]/agents` | Remove agent from collection |
| PUT | `/api/admin/collections/[id]/agents` | Reorder agents (sort_order) |

## Files

| Action | Path | Exemplar |
|--------|------|----------|
| CREATE | `src/components/admin/AdminCollections.tsx` | `admin/page.tsx` pattern |
| CREATE | `src/app/api/admin/collections/route.ts` | `api/admin/status/route.ts` |
| CREATE | `src/app/api/admin/collections/[id]/agents/route.ts` | same |
| MODIFY | `src/app/[locale]/admin/page.tsx` | import + render AdminCollections |
| MODIFY | `messages/en.json` + `messages/es.json` | add `admin.collections.*` keys |

## Constraint Directives

### OBLIGATORIO
- `createServiceClient()` en API routes (service role para bypass RLS)
- `useReducer(() => true, false)` para mounted state (React compiler)
- Dark theme (`bg-gray-950 text-white`, `bg-gray-800` cards)
- `ADMIN_ALLOWED` wallet check en client
- Zod validation en POST/PUT bodies
- Slug auto-generated: `name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')`

### PROHIBIDO
- NO auth server-side en admin routes (patrón existente)
- NO drag-and-drop library (up/down buttons)
- NO file upload (URL input for cover_image)
- NO crear nuevas tablas (038 ya tiene todo)
- NO modificar RLS policies

## Waves

| Wave | Tasks | Verificación |
|------|-------|-------------|
| W0 | API: GET/POST/PUT/DELETE `/api/admin/collections` + `/[id]/agents` | typecheck |
| W1 | Component: `AdminCollections.tsx` (list + create/edit form + agent manager) | typecheck + build |
| W2 | Wire into admin/page.tsx + i18n keys | build clean |
