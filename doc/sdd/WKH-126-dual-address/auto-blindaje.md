# Auto-Blindaje — WKH-126 (dual-address / parallel-run)

### [2026-06-30] Wave 0 — Uncommitted edits wiped by concurrent branch switch
- **Error**: My first round of source edits (config.ts, env.ts, marketplaceClient.ts,
  balance/route.ts) was silently reverted mid-session. The shared checkout
  `/home/ferdev/.openclaw/workspace/wasiai-v2` was checked out to another branch
  (`feat/wkh-128-reconciler`) by a concurrent agent, which reset the working tree
  and discarded my uncommitted changes. The branch tip of `feat/wkh-126-dual-address`
  was also moving under me.
- **Causa raíz**: The workspace is shared by multiple concurrent agents operating on
  the SAME git checkout. `git checkout <other-branch>` in that checkout reverts any
  uncommitted working-tree changes regardless of which agent made them. Edit-then-
  verify-then-commit-later is unsafe there.
- **Fix**: Created a DEDICATED git worktree (`git worktree add
  /home/ferdev/.openclaw/workspace/wkh-126-wt feat/wkh-126-dual-address`) off `main`,
  so my working tree is isolated from concurrent checkouts. Re-applied all edits
  there and committed immediately. Symlinked `node_modules` from the main checkout
  so gates (tsc/eslint/vitest) run without a fresh install.
- **Aplicar en**: Any task on this repo where multiple agents may run in parallel —
  ALWAYS use an isolated `git worktree` and commit early, never leave load-bearing
  edits uncommitted in the shared checkout.

### [2026-06-30] Wave 1 — `server-only` throws in the jsdom unit test
- **Error**: The marketplaceClient unit test failed at import with "This module
  cannot be imported from a Client Component module" (from `server-only`).
- **Causa raíz**: vitest runs under the `jsdom` (client) environment; `marketplaceClient.ts`
  imports `server-only`, whose `index.js` throws outside a Server Component context.
- **Fix**: `vi.mock('server-only', () => ({}))` at the top of the test file so the
  server module can be exercised in unit tests.
- **Aplicar en**: Any future unit test that directly imports a `'server-only'` module
  (e.g. env.ts, other on-chain clients) under the default jsdom test env.
