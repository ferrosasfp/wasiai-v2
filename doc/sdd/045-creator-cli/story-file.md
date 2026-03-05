# Story File #045 — Creator CLI

## Goal
Add `wasiai publish`, `wasiai stats`, `wasiai discover` subcommands to the existing CLI in wasiai-sdk, plus a backend stats endpoint.

## ACs
- AC1: `wasiai publish --name X --slug x --category defi-risk --endpoint https://... --price 0.05` → POST register → print slug
- AC2: `wasiai stats` → GET creator/stats → print total_calls, total_revenue, agent_count
- AC3: `wasiai discover --category defi-risk --max-price 0.10` → GET discover → formatted table
- AC4: Missing API key for publish/stats → exit with error
- AC5: `--output json` → raw JSON for all

## W0: Backend stats endpoint

Create `wasiai-v2/src/app/api/v1/creator/stats/route.ts`:
- Auth: read `x-agent-key` header → lookup in agent_keys table → get creator_id
- Query: count agents, sum total_calls, sum total_revenue for that creator
- Response: `{ agent_count, total_calls, total_revenue }`
- Zod on response shape

## W1: SDK modules (wasiai-sdk)

### `src/discover.ts`
- `discoverAgents(opts: { category?, maxPrice?, capability?, limit?, baseUrl? })` → fetch GET discover → return agents array
- Follow `invoke.ts` pattern (DEFAULT_BASE_URL, error handling)

### `src/publish.ts`
- `publishAgent(opts: { name, slug, category, endpoint, price, description?, apiKey, baseUrl? })` → fetch POST register with x-agent-key header → return created agent
- Error handling: 409 slug taken, 400 validation, 401 unauthorized

### `src/stats.ts`
- `getCreatorStats(opts: { apiKey, baseUrl? })` → fetch GET /api/v1/creator/stats → return stats object

## W2: CLI subcommands (wasiai-sdk)

Add to `src/cli/index.ts` following the existing `invoke` pattern:

### `wasiai discover`
- Options: `--category`, `--max-price`, `--capability`, `--limit`, `--output`
- No API key required
- Default output: formatted table (slug, name, price, calls, score)

### `wasiai publish`
- Options: `--name` (req), `--slug` (req), `--category` (req), `--endpoint` (req), `--price` (req), `--description`, `--api-key`, `--output`
- Requires API key

### `wasiai stats`
- Options: `--api-key`, `--output`
- Requires API key
- Default output: summary with labels

## Constraints
- NO new dependencies
- NO interactive prompts
- Follow existing error handling (WasiAI*Error classes)
- Reuse DEFAULT_BASE_URL from invoke.ts
