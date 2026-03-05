# SDD #045 — Creator CLI

## Context Map

| Archivo | Patrón |
|---------|--------|
| `wasiai-sdk/src/cli/index.ts` | Commander program, subcommands with opts, error handling pattern |
| `wasiai-sdk/src/invoke.ts` | Shared module: fetch + error classes, `DEFAULT_BASE_URL` |
| `wasiai-v2/src/app/api/v1/agents/register/route.ts` | POST with Zod, Bearer/x-agent-key auth |
| `wasiai-v2/src/app/api/v1/agents/discover/route.ts` | GET with Zod query params, public |
| `wasiai-v2/src/app/api/creator/analytics/route.ts` | GET, auth via supabase jwt |

## Architecture

### CLI subcommands (wasiai-sdk)
1. `wasiai discover` — calls `GET /api/v1/agents/discover` (public, no key needed)
2. `wasiai publish` — calls `POST /api/v1/agents/register` (requires API key as x-agent-key)
3. `wasiai stats` — calls `GET /api/v1/creator/stats` (new endpoint, requires API key)

### New backend endpoint (wasiai-v2)
- `GET /api/v1/creator/stats` — returns creator summary; auth via x-agent-key (lookup key → creator)

## Files

| Action | Repo | Path | Exemplar |
|--------|------|------|----------|
| CREATE | wasiai-sdk | `src/discover.ts` | `src/invoke.ts` |
| CREATE | wasiai-sdk | `src/publish.ts` | `src/invoke.ts` |
| CREATE | wasiai-sdk | `src/stats.ts` | `src/invoke.ts` |
| MODIFY | wasiai-sdk | `src/cli/index.ts` | existing `invoke` subcommand |
| CREATE | wasiai-v2 | `src/app/api/v1/creator/stats/route.ts` | `discover/route.ts` |

## Constraint Directives

### OBLIGATORIO
- Follow existing CLI pattern: commander options, error handling with WasiAI*Error classes
- Shared `DEFAULT_BASE_URL` from invoke.ts
- `--output json` flag on all 3 subcommands
- `--api-key` or `WASIAI_API_KEY` env var for publish/stats
- Zod validation on new backend endpoint

### PROHIBIDO
- NO add new npm dependencies to wasiai-sdk (commander already exists)
- NO interactive prompts (future scope)
- NO modify existing `invoke` subcommand
- NO touch auth flow (no OAuth from CLI)

## Waves

| Wave | Tasks |
|------|-------|
| W0 | Backend: `GET /api/v1/creator/stats` route in wasiai-v2 |
| W1 | SDK modules: `discover.ts`, `publish.ts`, `stats.ts` |
| W2 | CLI: add 3 subcommands to `cli/index.ts` + test build |
