# Story File #046 — Admin Collections CRUD

## Goal
Admin UI to create, edit, delete collections and manage agents within them (add, remove, reorder).

## ACs
- AC1: `/admin` shows collections list with name, slug, agent_count, featured, edit/delete buttons
- AC2: "New Collection" form: name, slug (auto), description, cover_image URL, featured checkbox
- AC3: Submit creates via POST `/api/admin/collections`
- AC4: Edit shows pre-filled form + agent list with remove + up/down reorder
- AC5: "Add Agent" searchable dropdown of active agents not in collection
- AC6: Reorder updates sort_order via PUT
- AC7: Delete with confirmation dialog, cascade deletes agents
- AC8: Non-admin wallet → "Unauthorized"

## W0: API Routes

### `/api/admin/collections/route.ts`
All use `createServiceClient()`.

**GET**: `supabase.from('collections').select('*, collection_agents(agent_id)').order('sort_order')` → map agent_count

**POST**: Zod `{ name, slug?, description?, cover_image?, featured? }` → auto-generate slug from name if not provided → insert → return collection

**PUT**: Zod `{ id, name?, slug?, description?, cover_image?, featured?, sort_order? }` → update → return

**DELETE**: Zod `{ id }` → delete (cascade handles collection_agents)

### `/api/admin/collections/[id]/agents/route.ts`

**GET**: `supabase.from('collection_agents').select('sort_order, agent:agents(id, slug, name, category)').eq('collection_id', id).order('sort_order')` → return agents

**POST**: Zod `{ agent_id }` → get max sort_order → insert with sort_order = max + 1

**DELETE**: Zod `{ agent_id }` → delete from collection_agents

**PUT**: Zod `{ agents: [{agent_id, sort_order}...] }` → upsert all sort_orders in one batch

## W1: AdminCollections Component

`src/components/admin/AdminCollections.tsx` — 'use client'

### State
- `collections[]` — loaded from GET
- `editingId: string | null` — which collection is being edited
- `formData` — name, slug, description, cover_image, featured
- `collectionAgents[]` — agents in the currently editing collection
- `allAgents[]` — all active agents (for the "Add" dropdown)
- `searchQuery` — filter allAgents

### Sections
1. **Header**: "Collections" title + "New Collection" button
2. **List**: table/cards with name, slug, agent_count, featured badge, Edit/Delete buttons
3. **Form** (shown when creating/editing): inputs + Save/Cancel
4. **Agent Manager** (shown when editing): agent list with ↑↓ buttons + ✕ remove + "Add Agent" dropdown

### Patterns
- `useReducer(() => true, false)` for mounted
- Fetch with `await fetch('/api/admin/collections')` pattern
- Dark theme: `bg-gray-800 rounded-xl p-4`, `text-gray-300` labels
- Confirm delete: `window.confirm()` (simple, matches admin vibe)

## W2: Wire + i18n

### admin/page.tsx
- Import `AdminCollections`
- Render inside `{isOwner && mounted && (` block, after Treasury section

### i18n keys (admin namespace)
- `admin.collections` / `admin.collectionsDesc`
- `admin.newCollection` / `admin.editCollection`
- `admin.collectionName` / `admin.collectionSlug` / `admin.collectionDesc` / `admin.collectionCover` / `admin.collectionFeatured`
- `admin.addAgent` / `admin.removeAgent` / `admin.deleteCollection` / `admin.confirmDelete`
- `admin.saveCollection` / `admin.cancel`
- `admin.noCollections` / `admin.agentsInCollection`

## Constraints
- NO new dependencies
- NO server-side auth (client wallet check only)
- NO drag-and-drop (up/down buttons)
- Dark theme only
- Slug auto-gen: `name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')`
