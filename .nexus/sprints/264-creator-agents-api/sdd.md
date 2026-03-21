# SDD #264 — GET /api/v1/creator/agents

## Context
Creators have no API to list their own agents. The dashboard uses `getCreatorModels` (server-side only). External tools and the CLI need a public API.

## Acceptance Criteria (EARS)
- AC1: **When** an authenticated creator sends `GET /api/v1/creator/agents`, **the system shall** return only their agents (where `creator_id` = user.id or owner_id from agent key).
- AC2: **The response shall** include: slug, name, status, category, price_per_call, total_calls, total_revenue, created_at, endpoint_url, tags.
- AC3: **When** unauthenticated, **the system shall** return 401.
- AC4: **The system shall** support `?status=active|paused` filter.
- AC5: **The system shall** order by `created_at DESC` by default.

## Wave 0 — Pre-flight
- Verify `src/app/api/v1/creator/` directory exists or can be created
- Verify auth patterns from register/route.ts

## Wave 1 — GET handler
1. Create `src/app/api/v1/creator/agents/route.ts`
2. Auth: JWT or x-agent-key → resolve creator_id / owner_id
3. Query agents where creator_id = resolved id
4. Apply status filter if provided
5. Order by created_at DESC
6. Return `{ agents: [...], total: N }`
7. Build gate: `tsc --noEmit` clean

## Rollback
Delete `src/app/api/v1/creator/agents/route.ts`.

## Critical Constraints
- OBLIGATORIO: only return agents owned by the requester
- PROHIBIDO: expose webhook_secret in response
