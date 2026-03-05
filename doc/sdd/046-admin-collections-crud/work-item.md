# Work Item #046 — WAS-157: Admin Collections CRUD

| Campo | Valor |
|-------|-------|
| **#** | 046 |
| **ID** | WAS-157 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | UI de mantenimiento en el panel admin para crear, editar, eliminar colecciones y gestionar los agentes dentro de cada colección (agregar, quitar, reordenar) |

## Acceptance Criteria (EARS)

| # | AC |
|---|-----|
| AC1 | WHEN an admin navigates to `/admin/collections`, THE page SHALL display a list of all collections with name, slug, agent count, featured status, and action buttons (edit, delete) |
| AC2 | WHEN an admin clicks "New Collection", THE page SHALL show a form with fields: name, slug (auto-generated from name), description, cover_image URL, featured checkbox |
| AC3 | WHEN an admin submits the new collection form, THE system SHALL insert into `collections` table via service role API and show success feedback |
| AC4 | WHEN an admin clicks "Edit" on a collection, THE page SHALL show the edit form pre-filled + a list of agents in the collection with drag-to-reorder and a remove button |
| AC5 | WHEN an admin clicks "Add Agent" in the edit view, THE page SHALL show a searchable dropdown of all active agents not already in the collection |
| AC6 | WHEN an admin reorders agents (up/down buttons), THE system SHALL update `sort_order` in `collection_agents` |
| AC7 | WHEN an admin clicks "Delete" on a collection, THE system SHALL show a confirmation dialog and delete the collection (cascade deletes collection_agents) |
| AC8 | IF the connected wallet is not in ADMIN_ALLOWED, THEN THE page SHALL show "Unauthorized" |

## Scope IN
- New page: `/[locale]/admin/collections/page.tsx` (client component)
- API routes: `POST/PUT/DELETE /api/admin/collections` with service role
- API route: `POST/DELETE /api/admin/collections/[id]/agents` for managing agents in collection
- Reuse existing admin layout + wallet auth pattern
- i18n keys EN/ES

## Scope OUT
- Drag-and-drop reorder (use up/down buttons instead — simpler)
- Cover image upload (URL input only — upload is future)
- User-created collections (admin only)
- Public API for collection management
