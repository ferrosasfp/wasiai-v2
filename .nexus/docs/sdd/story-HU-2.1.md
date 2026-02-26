# Story 2.1: SDK Node.js/TypeScript @wasiai/sdk

Status: ready-for-dev

## Story

As a developer (consumer),
I want to install `@wasiai/sdk` and invoke agents with a single function,
so that I can integrate WasiAI without understanding x402 protocol or building headers manually.

## Acceptance Criteria

1. `npm install @wasiai/sdk` installs without errors on Node.js 18+
2. `sdk.invoke(slug, { input })` calls the agent and returns typed result
3. `sdk.list()` returns active agents catalog with TypeScript types
4. `sdk.get(slug)` returns agent detail with price, description and metadata
5. Errors have their own types (`AgentNotFoundError`, `InsufficientFundsError`, `RateLimitError`, `TimeoutError`) — not generic strings
6. README has a working "hello world" example in ≤ 10 lines
7. API key never appears in logs, error messages, or stack traces — verified by test

## Tasks / Subtasks

- [ ] Task 1: Audit and clean existing code (AC: 1, 7)
  - [ ] Move `src/agent.ts`, `src/publish.ts`, `src/x402.ts`, `src/x402/`, `src/handlers/` to `src/_future/` with comment `// OUT OF SCOPE — HU futura`
  - [ ] Verify `package.json` has `build`, `test`, `dev` scripts

- [ ] Task 2: Fix `client.ts` (AC: 2, 3, 4, 7)
  - [ ] Remove `X-API-Key` header from `list()` and `get()` — public endpoints, no key needed
  - [ ] Verify `invoke()` sends `X-API-Key` header correctly
  - [ ] Verify apiKey is never interpolated into error messages

- [ ] Task 3: Build config (AC: 1)
  - [ ] Create `tsup.config.ts` if missing: `{ entry: ['src/index.ts'], format: ['cjs','esm'], dts: true, clean: true }`
  - [ ] Create `tsconfig.json` if missing: strict mode, target ES2020
  - [ ] Create `vitest.config.ts`
  - [ ] Run `npm run build` → verify `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts` generated

- [ ] Task 4: Write tests (AC: 2, 3, 4, 5, 7)
  - [ ] `__tests__/client.test.ts`: mock `fetch`, test invoke/list/get happy paths
  - [ ] Test each error type is thrown correctly (429→RateLimitError, 402→InsufficientFundsError, 404→AgentNotFoundError, timeout→TimeoutError)
  - [ ] **Critical**: test that `error.message` does NOT contain the string `wasi_` for any error
  - [ ] `__tests__/errors.test.ts`: verify error names and inheritance from `WasiAIError`

- [ ] Task 5: README (AC: 6)
  - [ ] Create `packages/sdk/README.md` with hello world ≤ 10 lines
  - [ ] Show: import, instantiate with apiKey, invoke, log output
  - [ ] Do NOT show real API keys — use `wasi_YOUR_KEY` placeholder

- [ ] Task 6: Root build check (AC: 1)
  - [ ] `npm run build` at repo root passes with 0 TS errors, 0 ESLint warnings

## Dev Notes

### Context
- `packages/sdk/` already has `client.ts`, `errors.ts`, `types.ts`, `index.ts` from a previous sub-agent run — use as base, apply corrections from tasks above
- The extra files (`agent.ts`, `publish.ts`, `x402.ts`, handlers) are OUT OF SCOPE — move to `_future/`, do not delete (may be useful for future HUs)

### API Endpoints consumed
- `GET /api/v1/agents` — public, no auth required → `sdk.list()`
- `GET /api/v1/agents/[slug]` — public → `sdk.get(slug)`
- `POST /api/v1/agents/[slug]/invoke` — requires `X-API-Key` header → `sdk.invoke()`

### Golden Path rules
- TypeScript strict — no explicit `any`
- No hardcoded URLs (the `DEFAULT_BASE_URL` constant is OK as a fallback — it's not an env secret)
- API key must NOT appear in any log output or error message

### Testing pattern
```typescript
// Mock fetch in tests
import { vi } from 'vitest'
global.fetch = vi.fn()
// Reset between tests
beforeEach(() => vi.resetAllMocks())
```

### References
- SDD: `.nexus/docs/sdd/HU-2.1-sdk-nodejs.md`
- Existing client: `packages/sdk/src/client.ts`
- Existing errors: `packages/sdk/src/errors.ts`
- Existing types: `packages/sdk/src/types.ts`

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes List

### File List
- `packages/sdk/src/client.ts` (modify)
- `packages/sdk/src/_future/agent.ts` (move)
- `packages/sdk/src/_future/publish.ts` (move)
- `packages/sdk/src/_future/x402.ts` (move)
- `packages/sdk/src/_future/handlers/` (move)
- `packages/sdk/__tests__/client.test.ts` (create)
- `packages/sdk/__tests__/errors.test.ts` (create)
- `packages/sdk/README.md` (create)
- `packages/sdk/tsup.config.ts` (create if missing)
- `packages/sdk/tsconfig.json` (create if missing)
- `packages/sdk/vitest.config.ts` (create if missing)
