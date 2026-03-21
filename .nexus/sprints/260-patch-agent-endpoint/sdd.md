# SDD #260 — PATCH /api/v1/agents/{slug}

## Context
Creators cannot edit their agents after registration. The only way is direct DB access. This endpoint enables self-service editing.

## Acceptance Criteria (EARS)
- AC1: **When** an authenticated creator sends `PATCH /api/v1/agents/{slug}` with valid fields, **the system shall** update only the provided fields and return the updated agent.
- AC2: **When** the requester is not the agent's `creator_id`, **the system shall** return 403.
- AC3: **When** unauthenticated, **the system shall** return 401.
- AC4: **When** `endpoint_url` is provided, **the system shall** validate it with `validateEndpointUrlAsync` (SSRF protection).
- AC5: **When** `input_schema` is provided, **the system shall** validate it with `metaValidateSchema`.
- AC6: **When** `price_per_call` is provided, **the system shall** validate 0.001 ≤ price ≤ 100.
- AC7: **The system shall** NOT allow editing: `slug`, `creator_id`, `id`, `status`, `total_calls`, `total_revenue`, `webhook_secret`.
- AC8: **When** `input_schema` is updated, **the system shall** auto-update `metadata.input_example` via `buildExampleFromSchema`.

## Editable fields
`name`, `description`, `category`, `price_per_call`, `endpoint_url`, `tags`, `input_schema`, `output_schema`, `max_rpm`, `max_rpd`, `mcp_description`, `sandbox_enabled`, `free_trial_enabled`, `free_trial_limit`

## Wave 0 — Pre-flight
- Verify `src/app/api/v1/agents/[slug]/route.ts` exists (GET handler already there)
- Verify `validateEndpointUrlAsync` importable from `@/lib/security/validateEndpointUrl`
- Verify `metaValidateSchema` importable from `@/lib/schema-validator`
- Verify `buildExampleFromSchema` importable from `@/features/agents/utils/buildExampleFromSchema`

## Wave 1 — PATCH handler
1. Add `PATCH` export to `src/app/api/v1/agents/[slug]/route.ts`
2. Auth: JWT (supabase.auth.getUser) or x-agent-key (lookup agent_keys → owner_id)
3. Load agent by slug using service client
4. Verify requester === agent.creator_id (or owner_id from key)
5. Parse body with Zod schema (all fields optional)
6. Validate endpoint_url, input_schema, price_per_call if present
7. If input_schema changed → compute new metadata.input_example
8. Update via service client, return updated agent
9. Build gate: `tsc --noEmit` clean

## Rollback
Revert the single file change to `src/app/api/v1/agents/[slug]/route.ts`.

## Critical Constraints
- OBLIGATORIO: SSRF validation on endpoint_url
- OBLIGATORIO: metaValidateSchema on input_schema
- PROHIBIDO: allow editing slug, creator_id, id, status, webhook_secret
- PROHIBIDO: allow non-owner to edit
