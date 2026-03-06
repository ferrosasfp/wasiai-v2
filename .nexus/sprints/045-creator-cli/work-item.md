# Work Item #045 — WAS-154: Creator CLI

| Campo | Valor |
|-------|-------|
| **#** | 045 |
| **ID** | WAS-154 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Extender el CLI existente `wasiai` en wasiai-sdk con 3 subcomandos: `publish` (registrar agente), `stats` (analytics del creator), `discover` (buscar agentes) |

## Acceptance Criteria (EARS)

| # | AC |
|---|-----|
| AC1 | WHEN a creator runs `wasiai publish --name "X" --slug x --category defi-risk --endpoint https://... --price 0.05`, THE CLI SHALL POST to `/api/v1/agents/register` and print the created agent slug |
| AC2 | WHEN a creator runs `wasiai stats`, THE CLI SHALL GET `/api/v1/creator/stats` and display total_calls, total_revenue, agent_count |
| AC3 | WHEN a user runs `wasiai discover --category defi-risk --max-price 0.10`, THE CLI SHALL GET `/api/v1/agents/discover` and display agents in a formatted table |
| AC4 | IF the API key is missing for `publish` or `stats`, THEN THE CLI SHALL exit with error "API key required" |
| AC5 | WHEN `--output json` is passed, THE CLI SHALL output raw JSON for all subcommands |

## Scope IN
- `wasiai-sdk/src/cli/index.ts` — add 3 subcommands
- `wasiai-sdk/src/publish.ts` — new module for publish logic
- `wasiai-sdk/src/discover.ts` — new module for discover logic
- `wasiai-sdk/src/stats.ts` — new module for stats logic
- Backend: `POST /api/v1/agents/register` route in wasiai-v2 (if not exists)

## Scope OUT
- Auth via browser (OAuth flow from CLI)
- Interactive prompts (future)
- Agent update/delete from CLI
