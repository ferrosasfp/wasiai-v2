# Story File — WAS-V2-2: wasiai-facilitator as primary x402 settler, Ultravioleta DAO as fallback

> **Phase:** F2.5 — Dev contract (self-contained)
> **Derived from:** `work-item.md` + `sdd.md` in this same folder
> **Branch:** `feat/was-v2-2-wasiai-facilitator-primary`
> **SDD_MODE:** full (QUALITY)
> **Pipeline:** F3 (Dev) → AR → CR → F4 (QA) → DONE
> **Status:** READY FOR DEV (SPEC_APPROVED ✅)
>
> **Dev contract:** read ONLY this file to implement. work-item.md and sdd.md exist for traceability — they are NOT required reading for F3. If anything is ambiguous here, STOP and escalate.

---

## 0. Executive Summary (1 paragraph)

Introduce a **dual facilitator router** between `usdcSettler.settlePaymentX402()` and the existing HTTP clients (`verifyExternal`/`settleExternal`). When the flag `WASIAI_FACILITATOR_AS_PRIMARY=true` is active AND the payment chain is in a hardcoded allowlist (`eip155:2366`, `eip155:2368`, `eip155:43113`, `eip155:43114`), the router tries **wasiai-facilitator first**; on 5xx, timeout, `CHAIN_UNAVAILABLE`, or `INVALID_PAYLOAD` it transparently **falls back to Ultravioleta DAO** (current production facilitator) via the SAME HTTP client (only the URL changes). If wasiai responds with `NONCE_ALREADY_USED` (body code OR HTTP 409 mapped), the router **never falls back** — it returns `verified:true settled:false` to prevent on-chain double-charge (idempotency guard, CD-5). With the flag OFF (default), behavior is byte-identical to current main (zero regression — AC-14). Existing 410-test baseline must remain green. New `facilitator-router.ts` module owns all routing/telemetry; `usdcSettler.settlePaymentX402` becomes a thin delegator with its public signature intact (CD-3).

---

## 1. Pre-flight Checklist (do these BEFORE touching code)

```
[ ] cwd is /home/ferdev/.openclaw/workspace/wasiai-v2/
[ ] git status is clean OR only untracked doc/sdd/073-* artifacts
[ ] git branch feat/was-v2-2-wasiai-facilitator-primary exists (or create from main):
       git checkout -b feat/was-v2-2-wasiai-facilitator-primary
[ ] Baseline test count snapshot: 410 passed | 1 skipped (411 total) across 41 test files
       Re-run NOW to confirm: npm test --silent --run | tail -5
[ ] npm run typecheck passes on a clean main (sanity)
[ ] .env.local has X402_FACILITATOR_URL set to UVD for local dev (NOT modified by this HU)
[ ] NO need to install new deps — confirmed by SDD §6 MI-3. Zero npm install in this HU.
[ ] Do NOT touch wasiai-facilitator repo, uvd-x402-sdk node_modules, contracts, or packages/sdk.
```

If any pre-flight item fails → STOP and report to the orchestrator before W0.

---

## 2. Scope IN — exact files

| # | Absolute Path | Action | Lines (approx) |
|---|--------------|--------|---------------|
| 1 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/x402-facilitator-config.ts` | MODIFY (EXTEND — append helpers, leave existing exports intact) | +60 |
| 2 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/x402-facilitator-client.ts` | MODIFY (1 line — add `'NONCE_ALREADY_USED'` to `KNOWN_FACILITATOR_CODES`) | +1 |
| 3 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/facilitator-router.ts` | **NEW FILE** | ~220 |
| 4 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/usdcSettler.ts` | MODIFY (replace BODY of `settlePaymentX402` lines 363–430 ONLY — lines 1–338 are INVIOLABLE per CD-14) | -65/+15 |
| 5 | `/home/ferdev/.openclaw/workspace/wasiai-v2/.env.example` | MODIFY (extend `# ─── Pagos x402 ───` section lines 29–35) | +18 |
| 6 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/__tests__/x402-facilitator-config.test.ts` | EXTEND (~+6 tests) | +~80 |
| 7 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/__tests__/x402-facilitator-client.test.ts` | EXTEND (~+2 tests for CD-12) | +~25 |
| 8 | `/home/ferdev/.openclaw/workspace/wasiai-v2/src/lib/contracts/__tests__/facilitator-router.test.ts` | **NEW FILE** (≥15 tests) | ~600 |

## 2.1 Scope OUT — DO NOT TOUCH

- `wasiai-facilitator` repo (Railway service is upstream — pre-existing)
- `uvd-x402-sdk` node_modules
- `packages/sdk/` (including `packages/sdk/src/_future/` dead code — see SDD §6 MI-1)
- `src/lib/contracts/usdcSettler.ts` lines 1–338 (the `settlePaymentDirectly` block — **CD-14 append-only**)
- Solidity contracts / `contracts/` directory
- Any RLS migration / Supabase table
- The PUBLIC SIGNATURE of `settlePaymentX402(payload, required, ctx)` — body changes only (CD-3)

---

## 3. Acceptance Criteria (15 ACs — EARS — literal from work-item)

> Every AC must trace to ≥1 named test in §10 (AC-15). NO AC can be marked done without a passing test.

### Toggle OFF (safe default — backward compat)

- **AC-1:** WHILE `WASIAI_FACILITATOR_AS_PRIMARY` is unset or set to any value other than `'true'`, the system SHALL route ALL x402 settlements through Ultravioleta DAO exclusively, producing behavior identical to the main branch prior to this HU (zero regression).

- **AC-2:** IF `WASIAI_FACILITATOR_AS_PRIMARY` env var is present but malformed (not parseable as boolean), THEN the system SHALL default to Ultravioleta-only mode, log a WARN once at first-call time (not at module init), and SHALL NOT throw or crash the settlement path.

### Toggle ON — chain routing

- **AC-3:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true` and the payment chain identifier is in the hardcoded allowlist `['eip155:2366', 'eip155:2368', 'eip155:43113', 'eip155:43114']`, the system SHALL attempt settlement via wasiai-facilitator FIRST before considering Ultravioleta.

- **AC-4:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true` and the payment chain identifier is NOT in the allowlist, the system SHALL route the settlement DIRECTLY to Ultravioleta DAO without attempting wasiai-facilitator, logging a debug event with `reason: 'chain_not_in_allowlist'`.

### Toggle ON — wasiai success path

- **AC-5:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator responds HTTP 2xx on both `/verify` and `/settle`, the system SHALL return a successful `SettlementResult` (`verified: true, settled: true`) and SHALL NOT call Ultravioleta DAO at all.

### Toggle ON — wasiai failure paths (fallback triggers)

- **AC-6:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator responds HTTP 5xx on `/verify` or `/settle`, the system SHALL immediately fall back to Ultravioleta DAO WITHOUT retrying wasiai-facilitator, and SHALL log a structured event including `fallback_reason: 'wasiai_5xx'`, `wasiai_status: <status_code>`.

- **AC-7:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator times out (AbortSignal fires after 30 s) or is unreachable (DNS/ECONNREFUSED), the system SHALL immediately fall back to Ultravioleta DAO and SHALL log `fallback_reason: 'wasiai_unreachable'`.

- **AC-8:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator returns error code `CHAIN_UNAVAILABLE` or `INVALID_PAYLOAD` in a non-2xx response body, the system SHALL immediately fall back to Ultravioleta DAO and SHALL log `fallback_reason: 'wasiai_<error_code_lowercase>'`.

### Both facilitators fail

- **AC-9:** IF both wasiai-facilitator AND Ultravioleta DAO fail to settle a payment, THEN the system SHALL return `{ verified: false, settled: false, error: '<LAST_ERROR>' }` and SHALL emit a structured log entry including `wasiai_outcome`, `uvd_outcome`, and `both_failed: true`.

### Idempotency — CRITICAL

- **AC-10:** IF wasiai-facilitator fails AFTER the `/verify` phase with an error that indicates the on-chain nonce was consumed (code `NONCE_ALREADY_USED` or HTTP 409), THEN the system SHALL NOT fall back to Ultravioleta DAO and SHALL return `{ verified: true, settled: false, error: 'NONCE_ALREADY_USED: ...' }` immediately.

### Telemetry

- **AC-11:** WHEN any x402 settlement completes (success or failure), the system SHALL emit a structured log entry via `logger.info('[settler]', {...})` including the fields: `facilitatorUsed: 'wasiai' | 'ultravioleta' | 'internal'`, `fallbackTriggered: boolean`, `fallbackReason?: string`, `durationMs: number`, `ok: boolean`, `errorCode?: string`.

### Env var documentation

- **AC-12:** WHEN the project's `.env.example` is read, the system SHALL document both `WASIAI_FACILITATOR_AS_PRIMARY` (with allowed values and default) and `WASIAI_FACILITATOR_URL` (existing) in the `# Pagos x402` section with comments explaining the routing logic for operators.

### Tests

- **AC-13:** WHEN the test suite runs (`npm test`), the system SHALL include unit tests covering all 8 routing branches of the decision matrix: `(toggle off) × (chain in/not in allowlist) × (wasiai ok/fail) × (uvd ok/fail)`, with ≥ 15 new unit + integration test cases, none using real HTTP calls (all mocked).

- **AC-14:** WHEN the test suite runs, ALL existing x402 baseline tests from WAS-V2-1 SHALL pass without modification (zero regression on pre-existing test coverage). Baseline: 410 passed | 1 skipped.

- **AC-15:** WHEN the test suite runs, each AC from AC-1 through AC-11 SHALL be traceable to at least one named test case in the test file(s) covering `facilitator-router`.

---

## 4. Constraint Directives (16 CDs)

### Inherited from work-item (CD-1..8)

- **CD-1:** TypeScript strict — **cero `any` explícito** en archivos nuevos o modificados.
- **CD-2:** Backward compat total — `WASIAI_FACILITATOR_AS_PRIMARY` unset or `false` produces behavior **identical** to main before this HU. AC-14 is the regression safety net.
- **CD-3:** The public signature `settlePaymentX402(payload, required, ctx) → Promise<SettlementResult>` **does NOT change**. Body refactor only.
- **CD-4:** Logs **never** contain signatures, private keys, or full authorization payloads. Use the existing redaction pattern in `usdcSettler.ts`.
- **CD-5:** **Idempotency on-chain** — if wasiai responds `NONCE_ALREADY_USED` (body code OR HTTP 409 mapped), the router **MUST NOT** call Ultravioleta. Retrying with another facilitator guarantees double-spend.
- **CD-6:** Chains NOT in allowlist → Ultravioleta is PRIMARY+ONLY. Zero breaking change for those chains.
- **CD-7:** Each AC-1..AC-11 has ≥1 explicitly named test in §10.
- **CD-8:** `WASIAI_FACILITATOR_URL` (UVD path, WAS-V2-1) keeps being read through `getFacilitatorUrl()`. Do NOT duplicate that read outside `x402-facilitator-config.ts`.

### New from SDD (CD-9..14)

- **CD-9 (from DT-G) — Error classification single-source:** The router invokes `extractCode(error)` ONCE and switches on the result. **PROHIBITED:** inspecting HTTP status codes directly in the router. That info is already mapped into `SettlementResult.error` by `x402-facilitator-client.ts`.

- **CD-10 (from DT-I) — Single log emission per settlement:** The structured log `[settler]` is emitted **EXACTLY ONCE** per settlement, at the end of `trySettle()`. PROHIBITED: intermediate info-level logs from `tryWasiai` or `tryUltravioleta`. Debug logs (e.g. `'chain_not_in_allowlist'`) MAY use `logger.debug` but NOT `logger.info`.
  **Reason:** Grafana counts `logger.info('[settler]', ...)` for p50/p95 histograms. Double-log inflates the metric.

- **CD-11 (from AB-WAS-V2-1-5) — No spread in envelope builder:** The router **does NOT build envelopes**; it delegates to `buildX402V2Envelope`. PROHIBITED: `...ctx`, `...payload`, `...envelope` inside `facilitator-router.ts`.

- **CD-12 — `NONCE_ALREADY_USED` must be in the canonical set:** Add `'NONCE_ALREADY_USED'` to `KNOWN_FACILITATOR_CODES` in `x402-facilitator-client.ts:111-122`. Without this, `mapFacilitatorErrorToSettlementResult` maps any unknown code to `'INVALID_PAYLOAD'`, breaking the router's ability to distinguish idempotency guard → CRITICAL BUG (potential double-charge).

- **CD-13 — `WASIAI_FACILITATOR_AS_PRIMARY` read SOLO en `x402-facilitator-config.ts`:** Inheriting WAS-V2-1 CD-NEW-SDD-2 pattern. PROHIBITED: `process.env.WASIAI_FACILITATOR_AS_PRIMARY` outside `x402-facilitator-config.ts`. Tests must mock the module helper, NOT the env var directly (cache would prevent reliable reset).

- **CD-14 — Append-only for `usdcSettler.ts`:** The `settlePaymentX402` body refactor REDUCES lines (delegation to router) but does **NOT touch** `settlePaymentDirectly()` lines 1-338 and the imports + helpers above line 339. F4 QA validates with `git diff src/lib/contracts/usdcSettler.ts` and confirms lines 1-338 have **empty diff**. Only lines 340+ change.

### Process CDs (from historical Auto-Blindajes)

- **CD-PROC-1 (from AB-WAS-V2-1-2 — Multi-state guards):** Tests combinatoriales — the matrix `toggle × allowlist × wasiai-ok/fail × uvd-ok/fail` produces 2⁴=16 states; ≥8 tests cover each relevant quadrant. PROHIBITED: `if (verified && settled) return success` without explicit guards for the other 3 quadrants.

- **CD-PROC-2 (from AB-WAS-V2-1-5 — No spread in Zod-strict envelope):** Zod `.strict()` upstream → the router does NOT inject new keys into the envelope. Reuse `buildX402V2Envelope` unmodified.

### General PROHIBIDOS (summary)

- ❌ NO modify `wasiai-facilitator` Railway repo
- ❌ NO modify `uvd-x402-sdk` or `packages/sdk/`
- ❌ NO `npm install` of new deps
- ❌ NO refactor `x402-facilitator-client.ts` beyond CD-12 (one-line addition)
- ❌ NO refactor `settlePaymentDirectly()` (lines 185-338)
- ❌ NO read `process.env.WASIAI_FACILITATOR_AS_PRIMARY` outside config module
- ❌ NO hardcode the toggle to `true` or the wasiaiUrl in any import — all comes from config helpers
- ❌ NO duplicate `[settler]` logs (only one per settlement)
- ❌ NO `any` (CD-1)
- ❌ NO modify existing tests unless the refactor truly breaks them (CD-2)

---

## 5. Anti-Hallucination Checklist (per this HU)

Before writing any code, verify:

```
[ ] You read THIS file fully.
[ ] You did NOT open work-item.md or sdd.md to copy structure (already merged here).
[ ] You will use ONLY these dependencies (already in package.json):
       - viem (existing in usdcSettler.ts)
       - @/lib/logger (existing)
       - vitest + @vitest/expect (existing test runner)
[ ] You will NOT invent functions. ALL function references in code snippets below
    are verified exemplars from the actual files in src/lib/contracts/.
[ ] You will NOT introduce a new HTTP client. verifyExternal/settleExternal
    accept a URL param — that is HOW we dispatch wasiai vs UVD.
[ ] You will NOT change the public signature of settlePaymentX402.
[ ] You will NOT touch packages/sdk/src/_future/ — dead code, out of scope (MI-1).
[ ] You will NOT install uvd-x402-sdk client code — UVD is consumed via the
    EXACT SAME HTTP client as wasiai, just with a different URL (MI-3 resolved).
[ ] You will NOT extend CHAIN_TO_EIP155 — current 2 entries are sufficient
    (ctx.network is typed 'avalanche' | 'avalanche-testnet') (MI-2 resolved).
```

---

## 6. Waves of Implementation (W0 → W1 → W2 — STRICTLY SEQUENTIAL)

### Wave 0 — Config + client preparation (Serial Gate)

**Goal:** Add helpers and the canonical `NONCE_ALREADY_USED` code BEFORE the router can use them.

**ACs touched:** AC-2 (warn-once parsing), AC-12 (constant immutability), CD-12 (NONCE in set).

#### W0.1 — `src/lib/contracts/x402-facilitator-config.ts` (MODIFY)

Append to the existing file (after `__resetFacilitatorUrlCacheForTesting`):

```ts
// ─── WAS-V2-2: Wasiai-as-primary toggle + chain allowlist ────────────────────

/**
 * Hardcoded list of chain identifiers (canonical x402 v2 form `eip155:<chainId>`)
 * that the wasiai-facilitator is authorized to settle on. Forward-compat with
 * Kite chains (2366/2368); current ctx.network only matches 43113/43114.
 *
 * DT-A (humano): immutable list.
 */
export const WASIAI_CHAIN_ALLOWLIST: ReadonlySet<string> = new Set([
  'eip155:2366',
  'eip155:2368',
  'eip155:43113',
  'eip155:43114',
])

/**
 * Default URL of the wasiai-facilitator Railway deployment.
 * Override via WASIAI_FACILITATOR_URL only for staging/testing.
 * DT-H: never null — fallback default keeps operator surface minimal.
 */
const WASIAI_FACILITATOR_DEFAULT_URL =
  'https://wasiai-facilitator-production.up.railway.app'

// Tri-state caches (same pattern as getFacilitatorUrl).
let wasiaiPrimaryCached: boolean | undefined = undefined
let wasiaiPrimaryWarnedOnce = false
let wasiaiUrlCached: string | undefined = undefined
let wasiaiUrlWarnedOnce = false

/**
 * Reads WASIAI_FACILITATOR_AS_PRIMARY env var. Returns true ONLY when
 * the raw value (trimmed, lowercased) === 'true'. Any other value → false.
 *
 * AC-2: malformed value (e.g. 'mAyBe') → returns false + warns ONCE at
 * first call time. Never throws.
 *
 * CD-13: this is the only place the env var is read.
 */
export function isWasiaiFacilitatorPrimary(): boolean {
  if (wasiaiPrimaryCached !== undefined) return wasiaiPrimaryCached
  const raw = process.env.WASIAI_FACILITATOR_AS_PRIMARY?.trim()
  if (raw === undefined || raw === '') {
    wasiaiPrimaryCached = false
    return false
  }
  const lower = raw.toLowerCase()
  if (lower === 'true') {
    wasiaiPrimaryCached = true
    return true
  }
  if (lower === 'false') {
    wasiaiPrimaryCached = false
    return false
  }
  // Malformed.
  if (!wasiaiPrimaryWarnedOnce) {
    logger.warn(
      '[x402-facilitator-config] WASIAI_FACILITATOR_AS_PRIMARY malformed; defaulting to false',
      { raw_redacted: raw.slice(0, 16) + '...' },
    )
    wasiaiPrimaryWarnedOnce = true
  }
  wasiaiPrimaryCached = false
  return false
}

/**
 * Returns the wasiai-facilitator URL.
 * - If WASIAI_FACILITATOR_URL env var is set and a valid URL → returns it (sanitized).
 * - Else → returns WASIAI_FACILITATOR_DEFAULT_URL.
 *
 * DT-H: never returns null — operator surface minimal.
 */
export function getWasiaiFacilitatorUrl(): string {
  if (wasiaiUrlCached !== undefined) return wasiaiUrlCached
  const raw = process.env.WASIAI_FACILITATOR_URL?.trim()
  if (!raw) {
    wasiaiUrlCached = WASIAI_FACILITATOR_DEFAULT_URL
    return wasiaiUrlCached
  }
  try {
    const url = new URL(raw)
    wasiaiUrlCached = url.toString().replace(/\/$/, '')
    return wasiaiUrlCached
  } catch {
    if (!wasiaiUrlWarnedOnce) {
      logger.warn(
        '[x402-facilitator-config] WASIAI_FACILITATOR_URL malformed; using default',
        { raw_redacted: raw.slice(0, 16) + '...' },
      )
      wasiaiUrlWarnedOnce = true
    }
    wasiaiUrlCached = WASIAI_FACILITATOR_DEFAULT_URL
    return wasiaiUrlCached
  }
}
```

**ALSO** — EXTEND the test-reset helper so ALL caches in this module reset:

```ts
/** Test-only — reset cache between tests. NOT exported in barrel/index. */
export function __resetFacilitatorUrlCacheForTesting(): void {
  cached = undefined
  warnedOnce = false
  // WAS-V2-2: also reset the new caches added in this HU.
  wasiaiPrimaryCached = undefined
  wasiaiPrimaryWarnedOnce = false
  wasiaiUrlCached = undefined
  wasiaiUrlWarnedOnce = false
}
```

#### W0.2 — `src/lib/contracts/x402-facilitator-client.ts` (MODIFY — 1 line, CD-12)

In `KNOWN_FACILITATOR_CODES` (currently lines 111-122), append `'NONCE_ALREADY_USED'`:

```ts
const KNOWN_FACILITATOR_CODES = new Set([
  'INVALID_PAYLOAD',
  'INVALID_SIGNATURE',
  'EXPIRED_AUTHORIZATION',
  'INVALID_AMOUNT',
  'INSUFFICIENT_BALANCE',
  'NETWORK_MISMATCH',
  'SIMULATION_FAILED',
  'RATE_LIMITED',
  'CHAIN_UNAVAILABLE',
  'TRANSACTION_FAILED',
  'NONCE_ALREADY_USED', // ← WAS-V2-2 CD-12: required for idempotency guard
])
```

**No other changes** in this file.

#### W0.3 — Tests for W0.1 + W0.2 (EXTEND existing test files)

Add tests in `__tests__/x402-facilitator-config.test.ts` (see §10 for exact names):

- AC-1 supporting: `WASIAI_FACILITATOR_AS_PRIMARY` unset → `isWasiaiFacilitatorPrimary() === false`
- AC-1 supporting: `WASIAI_FACILITATOR_AS_PRIMARY='false'` → `false`
- AC-1 supporting: `WASIAI_FACILITATOR_AS_PRIMARY='FALSE'` (case-insensitive) → `false`
- AC-2 supporting: `WASIAI_FACILITATOR_AS_PRIMARY='maybe'` → `false`, `logger.warn` called once
- AC-2 supporting: second malformed call does NOT log again (warn-once)
- AC-3 supporting: `WASIAI_CHAIN_ALLOWLIST` exported, contains the 4 chains, is `ReadonlySet`
- DT-H supporting: `getWasiaiFacilitatorUrl()` returns default when env var unset
- DT-H supporting: `getWasiaiFacilitatorUrl()` strips trailing slash on valid env override

Add tests in `__tests__/x402-facilitator-client.test.ts`:

- CD-12: `mapFacilitatorErrorToSettlementResult(409, { code: 'NONCE_ALREADY_USED', message: 'consumed' }, 'settle')` returns `{ verified: true, settled: false, error: 'NONCE_ALREADY_USED: consumed' }`
- CD-12: same input at `'verify'` phase returns `{ verified: false, settled: false, error: 'NONCE_ALREADY_USED: ...' }` (verify failed → verified=false per existing line 133)

#### W0.4 — Verification gate (must pass BEFORE W1)

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit
npm test --silent --run -- src/lib/contracts/__tests__/x402-facilitator-config.test.ts
npm test --silent --run -- src/lib/contracts/__tests__/x402-facilitator-client.test.ts
```

All green → proceed to W1. Any failure → fix W0 before continuing.

---

### Wave 1 — Router module (Serial — depends on W0)

**Goal:** Create the pure routing module that orchestrates wasiai → fallback → uvd → idempotency guard → single telemetry log.

**ACs touched:** AC-1..AC-11 (full matrix).

#### W1.1 — `src/lib/contracts/facilitator-router.ts` (NEW FILE)

**Reference patterns:**
- Imports + structure → `usdcSettler.ts:14-33`
- Tri-state external-result discrimination → `x402-facilitator-client.ts:67-69`
- Single telemetry log → `usdcSettler.ts:373-380` (the `[settler]` log emitted ONCE per call)

Conceptual outline (Dev decides exact organization, but MUST respect CD-9..14):

```ts
/**
 * WAS-V2-2: Dual facilitator router.
 *
 * Routes x402 settlements between wasiai-facilitator (primary, when toggle on)
 * and Ultravioleta DAO (fallback). Internal settlePaymentDirectly is used only
 * when toggle off AND no UVD URL configured (preserves WAS-V2-1 baseline).
 *
 * Pure module — no module-level caches (delegates to x402-facilitator-config).
 * Emits exactly ONE logger.info('[settler]', ...) per settlement (CD-10).
 *
 * CD-3: caller signature is preserved by usdcSettler.settlePaymentX402.
 * CD-5: NONCE_ALREADY_USED → no fallback (idempotency).
 * CD-9: error classification via extractCode (single source).
 * CD-11: never builds envelopes (delegates to buildX402V2Envelope).
 */
import { logger } from '@/lib/logger'
import {
  getFacilitatorUrl,
  isWasiaiFacilitatorPrimary,
  getWasiaiFacilitatorUrl,
  WASIAI_CHAIN_ALLOWLIST,
} from './x402-facilitator-config'
import {
  buildX402V2Envelope,
  verifyExternal,
  settleExternal,
  type SettlePaymentX402Ctx,
} from './x402-facilitator-client'
import {
  settlePaymentDirectly,
  type X402EVMPayload,
  type SettlementResult,
} from './usdcSettler'

// ─── Types ────────────────────────────────────────────────────────────────────

type FallbackReason =
  | 'wasiai_5xx'
  | 'wasiai_unreachable'
  | 'wasiai_invalid_payload'
  | 'wasiai_chain_unavailable'
  | 'chain_not_in_allowlist'
  | 'toggle_off'

type FacilitatorUsed = 'wasiai' | 'ultravioleta' | 'internal'

type SettleAttempt =
  | { outcome: 'ok'; result: SettlementResult }
  | { outcome: 'guard'; result: SettlementResult; code: 'NONCE_ALREADY_USED' }
  | { outcome: 'fail'; result: SettlementResult; reason: FallbackReason; code: string }

// ─── Helpers (pure) ───────────────────────────────────────────────────────────

/** Same convention as usdcSettler.ts extractCode: code is the prefix before ':'. */
function extractCode(err: string | undefined): string | undefined {
  return err?.split(':')[0]
}

/**
 * Network literal → canonical x402 v2 form. Defensive: returns null when
 * the literal is not recognized (DT-J — chain_not_in_allowlist).
 */
function networkToEip155(network: SettlePaymentX402Ctx['network']): string | null {
  if (network === 'avalanche') return 'eip155:43114'
  if (network === 'avalanche-testnet') return 'eip155:43113'
  return null
}

/**
 * Classify a wasiai facilitator attempt outcome into one of: ok | guard | fail.
 * AC-6/7/8/10 routing decisions live here.
 *
 * Note: HTTP 5xx vs 4xx is NOT inspected here — verifyExternal/settleExternal
 * already mapped status to SettlementResult.error via mapFacilitatorErrorToSettlementResult.
 * We classify by the canonical CODE prefix only (CD-9).
 *
 * - CHAIN_UNAVAILABLE → 'wasiai_unreachable' (timeout/DNS) OR 'wasiai_chain_unavailable'
 *   (facilitator returned body code). The HTTP client emits the exact same string
 *   `'CHAIN_UNAVAILABLE: facilitator unreachable'` for the unreachable case
 *   (see x402-facilitator-client.ts:180). We disambiguate by checking the msg tail
 *   (`'facilitator unreachable'`) — if matches → 'wasiai_unreachable'; else
 *   → 'wasiai_chain_unavailable'.
 */
function classifyWasiaiOutcome(attempt: 'ok' | { error: SettlementResult; isHttp5xx?: boolean }): ...
```

> **Dev note:** The exact internal structure of `tryWasiai`/`tryUltravioleta` is up to the Dev. The contract is:

**Public surface (this file exports ONLY):**

```ts
export async function trySettle(
  payload: X402EVMPayload,
  required: string,
  ctx: SettlePaymentX402Ctx,
): Promise<SettlementResult>
```

**Decision tree the Dev MUST implement:**

```
trySettle(payload, required, ctx):
  start = Date.now()
  primary = isWasiaiFacilitatorPrimary()
  uvdUrl = getFacilitatorUrl()                  // may be null

  // CASE A — toggle off → exactly like main pre-HU
  if (!primary):
     return _internalOrUvd(payload, required, ctx, uvdUrl, start,
                           fallbackReason='toggle_off',
                           facilitatorUsed = uvdUrl ? 'ultravioleta' : 'internal')

  // CASE B — chain NOT in allowlist
  chainEip = networkToEip155(ctx.network)
  if (chainEip === null || !WASIAI_CHAIN_ALLOWLIST.has(chainEip)):
     logger.debug('[facilitator-router] chain bypass', { reason: 'chain_not_in_allowlist',
                                                          network: ctx.network })
     return _internalOrUvd(payload, required, ctx, uvdUrl, start,
                           fallbackReason='chain_not_in_allowlist',
                           facilitatorUsed = uvdUrl ? 'ultravioleta' : 'internal')

  // CASE C — try wasiai first
  wasiaiUrl = getWasiaiFacilitatorUrl()
  wasiaiAttempt = await _tryFacilitator(payload, ctx, wasiaiUrl)

  if (wasiaiAttempt.outcome === 'ok'):
     _log({ facilitatorUsed: 'wasiai', fallbackTriggered: false, ok: true,
            durationMs: now-start, wasiai_outcome: 'ok' })
     return wasiaiAttempt.result

  if (wasiaiAttempt.outcome === 'guard'):     // CD-5 / AC-10
     _log({ facilitatorUsed: 'wasiai', fallbackTriggered: false,
            idempotencyGuardTriggered: true, ok: false,
            errorCode: 'NONCE_ALREADY_USED', wasiai_outcome: 'guard',
            uvd_outcome: 'skipped', durationMs: now-start })
     return wasiaiAttempt.result

  // CASE C-fail — fall back to UVD
  uvdAttempt = await _tryFacilitator(payload, ctx, uvdUrl)
  // uvdUrl may be null → use settlePaymentDirectly path

  ok = (uvdAttempt.outcome === 'ok')
  _log({ facilitatorUsed: uvdUrl ? 'ultravioleta' : 'internal',
         fallbackTriggered: true,
         fallbackReason: wasiaiAttempt.reason,
         wasiai_outcome: 'fail',
         uvd_outcome: ok ? 'ok' : 'fail',
         both_failed: !ok,    // AC-9
         durationMs: now-start,
         ok,
         errorCode: extractCode(uvdAttempt.result.error) })
  return uvdAttempt.result
```

**Inner helper `_tryFacilitator(payload, ctx, url | null)`:**
- If `url === null` → call `settlePaymentDirectly(payload, required)` and wrap result as `SettleAttempt` (outcome ok if `verified && settled`, else fail).
- Else → call `verifyExternal` then `settleExternal` against the URL.
- Detect `NONCE_ALREADY_USED` in either phase → return `{ outcome: 'guard', code: 'NONCE_ALREADY_USED', result }`.
- Map other errors to `{ outcome: 'fail', reason, code }` per the table in §6.1 below.

#### W1.1.1 — Error classification table (CD-9)

| Wasiai error condition | Detection | FallbackReason emitted |
|------------------------|-----------|------------------------|
| `verifyExternal` or `settleExternal` returns `ok: true` | — | (no fallback — outcome='ok') |
| Error code = `'NONCE_ALREADY_USED'` (in verify OR settle phase) | `extractCode(result.error) === 'NONCE_ALREADY_USED'` | (no fallback — outcome='guard', CD-5/AC-10) |
| Error is `'CHAIN_UNAVAILABLE: facilitator unreachable'` (literal — from `x402-facilitator-client.ts:180`) | `result.error === 'CHAIN_UNAVAILABLE: facilitator unreachable'` | `'wasiai_unreachable'` (AC-7) |
| Error code = `'CHAIN_UNAVAILABLE'` (any other message — facilitator returned 503 with that body code) | `extractCode === 'CHAIN_UNAVAILABLE'` and NOT the literal above | `'wasiai_chain_unavailable'` (AC-8) |
| Error code = `'INVALID_PAYLOAD'` | `extractCode === 'INVALID_PAYLOAD'` | `'wasiai_invalid_payload'` (AC-8) |
| HTTP 5xx body mapped to other code OR unknown | other codes (SIMULATION_FAILED, TRANSACTION_FAILED, INVALID_PAYLOAD, etc. — anything that came from `mapFacilitatorErrorToSettlementResult(5xx, ...)`) | `'wasiai_5xx'` (AC-6) |

> **Tricky bit:** the HTTP client currently does NOT preserve the HTTP status code in the SettlementResult. The Dev cannot reliably distinguish "HTTP 503 with INVALID_PAYLOAD body" from "HTTP 400 with INVALID_PAYLOAD body" from the SettlementResult alone.
>
> **Pragmatic resolution (decided in F2 SDD §4.5):**
> - The literal string `'CHAIN_UNAVAILABLE: facilitator unreachable'` (from `x402-facilitator-client.ts:180` — fetch-reject path = network/timeout/abort) → `'wasiai_unreachable'`.
> - Any other `'CHAIN_UNAVAILABLE: <other msg>'` → `'wasiai_chain_unavailable'` (server-side 4xx/5xx body code).
> - `'INVALID_PAYLOAD: <msg>'` → `'wasiai_invalid_payload'`.
> - Any other known code (e.g. `TRANSACTION_FAILED`, `SIMULATION_FAILED`, `INSUFFICIENT_BALANCE`) → `'wasiai_5xx'` (acts as the catchall "remote failure that we will fall back over").
>
> This keeps the router decision tree pure-string-based (no HTTP plumbing leak) and aligns with CD-9.

#### W1.2 — `src/lib/contracts/__tests__/facilitator-router.test.ts` (NEW FILE — ≥15 tests)

See §10 for the EXACT test names and the AC traceability matrix.

**Mock strategy (mirror `usdcSettler.x402.test.ts:21-39`):**

```ts
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/contracts/x402-facilitator-config', () => ({
  getFacilitatorUrl:             vi.fn(),       // UVD URL
  isWasiaiFacilitatorPrimary:    vi.fn(),       // toggle
  getWasiaiFacilitatorUrl:       vi.fn(() => 'https://wasiai.test'),
  WASIAI_CHAIN_ALLOWLIST:        new Set(['eip155:43113', 'eip155:43114',
                                          'eip155:2366', 'eip155:2368']),
  __resetFacilitatorUrlCacheForTesting: vi.fn(),
}))

vi.mock('@/lib/contracts/x402-facilitator-client', async () => {
  const actual = await vi.importActual<typeof import(
    '@/lib/contracts/x402-facilitator-client')>('@/lib/contracts/x402-facilitator-client')
  return { ...actual, verifyExternal: vi.fn(), settleExternal: vi.fn() }
})

// Also mock settlePaymentDirectly (router imports it from usdcSettler):
vi.mock('@/lib/contracts/usdcSettler', async () => {
  const actual = await vi.importActual<typeof import(
    '@/lib/contracts/usdcSettler')>('@/lib/contracts/usdcSettler')
  return { ...actual, settlePaymentDirectly: vi.fn() }
})
```

**Fixtures:** reuse `ctx` and `livePayload` shapes from `usdcSettler.x402.test.ts:41-76` (Dev should copy verbatim).

#### W1.3 — Verification gate

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit
npm test --silent --run -- src/lib/contracts/__tests__/facilitator-router.test.ts
```

All ≥15 tests green → proceed to W2.

---

### Wave 2 — Settler delegation + .env.example + regression sweep

**Goal:** Make `settlePaymentX402` a thin delegator; document toggle for ops; verify zero regression.

**ACs touched:** AC-12 (.env doc), AC-14 (regression), CD-3 (signature), CD-14 (append-only).

#### W2.1 — `src/lib/contracts/usdcSettler.ts` (MODIFY — body of `settlePaymentX402` ONLY)

**CD-14 (CRITICAL):** the diff for `usdcSettler.ts` MUST show:
- **Lines 1-338:** ZERO changes (intact `settlePaymentDirectly` + helpers).
- **Lines 339+:** only the body of `settlePaymentX402` is rewritten. The function signature (line 363-367) is **identical**. The header JSDoc may be updated to reflect the router delegation (mention WAS-V2-2 + delegation to facilitator-router).
- **No new imports above line 339.** Add an import for `facilitatorRouter` at the TOP of the file alongside the existing imports (lines 24-33) — that 1-line addition is allowed and is the ONLY change in the 1-338 range. **EXCEPTION**: the import block at lines 14-33 may extend by 1-2 lines for the new router import.

**Acceptable diff for the import block (lines 24-34):**

```ts
// WAS-V2-1: External facilitator opt-in wrapper deps (section below).
// Imports moved to top per TS convention; functions remain in the
// `WAS-V2-1: External facilitator opt-in wrapper` section below.
import { getFacilitatorUrl } from './x402-facilitator-config'
import {
  buildX402V2Envelope,
  verifyExternal,
  settleExternal,
  type SettlePaymentX402Ctx,
} from './x402-facilitator-client'
import { trySettle } from './facilitator-router'   // ← WAS-V2-2

export type { SettlePaymentX402Ctx }
```

> Note: after the refactor, `getFacilitatorUrl`, `buildX402V2Envelope`, `verifyExternal`, `settleExternal` may become **unused imports inside usdcSettler.ts** (they all moved to the router). TS strict will flag those as unused. **Action:** remove those imports from `usdcSettler.ts` (lines 27-33) ONLY IF the linter/typecheck complains. Removing unused imports is NOT a violation of CD-14 (CD-14 is about LOGIC behavior in lines 1-338; unused-import cleanup of 1-2 lines in the import block is part of the legitimate refactor).

**New body of `settlePaymentX402` (replaces lines 368-429):**

```ts
export async function settlePaymentX402(
  payload:  X402EVMPayload,
  required: string,
  ctx:      SettlePaymentX402Ctx,
): Promise<SettlementResult> {
  // WAS-V2-2: routing/telemetry delegated to facilitator-router.
  // The router emits the single structured [settler] log (CD-10).
  return await trySettle(payload, required, ctx)
}
```

**Important:** the existing `start = Date.now()`, the `logger.info('[settler]', ...)` calls, and the AbortSignal management ALL move into the router. The wrapper becomes a single delegating line.

#### W2.2 — `.env.example` (MODIFY — extend lines 29-35)

Replace the current `# ─── Pagos x402 ───` section (lines 29-35) with:

```bash
# ─── Pagos x402 ───────────────────────────────────────────────────────────────
# WAS-V2-1: URL del facilitator x402 EXTERNO (default: Ultravioleta DAO en prod).
# Si NO está set → settlement interno via usdcSettler.settlePaymentDirectly (zero-regression).
# Si está set    → settlement delegado al facilitator externo via HTTP /verify + /settle.
# Producción típica (UVD): https://facilitator.ultravioletadao.xyz
# Rollback ops: borrar la var en Vercel y redeploy. Cero código nuevo necesario.
X402_FACILITATOR_URL=

# WAS-V2-2: Toggle para promover wasiai-facilitator como PRIMARY (con UVD como fallback).
# Valores permitidos: 'true' | 'false' (case-insensitive) | unset.
# Default (unset o cualquier otro valor): false → comportamiento idéntico a WAS-V2-1
# (ruteo exclusivo a Ultravioleta DAO via X402_FACILITATOR_URL).
# Cuando 'true' y la chain del payment está en el allowlist hardcoded
# (eip155:2366, eip155:2368, eip155:43113, eip155:43114), wasiai-facilitator se intenta
# PRIMERO; si falla (5xx, timeout, CHAIN_UNAVAILABLE, INVALID_PAYLOAD) → fallback auto a UVD.
# NONCE_ALREADY_USED / HTTP 409 → NO fallback (idempotency on-chain).
# Para chains NO en el allowlist → UVD directo (sin intento contra wasiai).
WASIAI_FACILITATOR_AS_PRIMARY=

# WAS-V2-2: Override opcional del wasiai-facilitator URL (staging/testing).
# Si NO está set → default hardcoded: https://wasiai-facilitator-production.up.railway.app
# Solo usar para staging/dev. En prod debe quedar UNSET.
WASIAI_FACILITATOR_URL=
```

**Do NOT touch** the lines before 29 or after the section.

#### W2.3 — Regression sweep (AC-14)

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit                                                             # MUST pass
npx eslint src/lib/contracts/                                                # MUST pass
npm test --silent --run                                                      # MUST: 410+15 ≥ 425 tests pass
```

Targeted regression checks:

```bash
npm test --silent --run -- src/lib/contracts/__tests__/usdcSettler.x402.test.ts        # 8 tests — ALL PASS
npm test --silent --run -- src/lib/contracts/__tests__/x402-facilitator-config.test.ts # 4 → 12 tests — ALL PASS
npm test --silent --run -- src/lib/contracts/__tests__/x402-facilitator-client.test.ts # 23 → 25 tests — ALL PASS
npm test --silent --run -- src/lib/contracts/__tests__/facilitator-router.test.ts      # ≥15 NEW tests
```

**If `usdcSettler.x402.test.ts` test fails:**
1. First, check whether the failure is structural (asserting on now-removed log fields) vs behavioral (different result shape).
2. **Structural** (e.g. test asserts `settlerType: 'external'` but router now emits `facilitatorUsed: 'wasiai'`): this is **acceptable** test maintenance — update the assertion to match the new schema (CD-2 protects behavior, not log keys). Document the rationale in the PR description.
3. **Behavioral** (different SettlementResult shape returned to caller): this is a **regression — STOP**. Fix the router or surface it to AR.

#### W2.4 — Final verification gate

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
git diff src/lib/contracts/usdcSettler.ts | head -100   # confirm CD-14 (only 339+ changed)
git diff --stat                                          # 5-8 files modified, no surprise files
npm test --silent --run | tail -5                        # baseline preserved + new tests
npx tsc --noEmit                                         # zero TS errors
```

Total tests post-HU: **≥425 passing** (410 baseline + ≥15 new). Zero failures. Zero TS errors.

---

## 7. Wave Dependencies Summary

```
W0 (config + client) — serial gate
  ├─ W0.1 x402-facilitator-config.ts (add helpers)
  ├─ W0.2 x402-facilitator-client.ts (add NONCE_ALREADY_USED)
  ├─ W0.3 tests for W0.1/W0.2
  └─ W0.4 typecheck + run two test files → GREEN

W1 (router) — depends on W0
  ├─ W1.1 facilitator-router.ts (NEW)
  ├─ W1.2 facilitator-router.test.ts (NEW — ≥15 tests)
  └─ W1.3 typecheck + run router tests → GREEN

W2 (settler + docs + regression) — depends on W1
  ├─ W2.1 usdcSettler.ts (body refactor of settlePaymentX402 only)
  ├─ W2.2 .env.example (extend Pagos x402 section)
  ├─ W2.3 regression sweep (full npm test)
  └─ W2.4 final gate (typecheck + eslint + diff verification)
```

**Parallelization:** NONE. Strictly W0 → W1 → W2.

---

## 8. Files Modified Summary

| File | Lines pre | Lines post (est) | Net Δ |
|------|-----------|-----------------|-------|
| `x402-facilitator-config.ts` | 53 | ~115 | +62 |
| `x402-facilitator-client.ts` | 245 | 246 | +1 |
| `facilitator-router.ts` | 0 (NEW) | ~220 | +220 |
| `usdcSettler.ts` | 431 | ~370 | -61 |
| `.env.example` | 96 | ~114 | +18 |
| `__tests__/x402-facilitator-config.test.ts` | 43 | ~125 | +82 |
| `__tests__/x402-facilitator-client.test.ts` | 212 | ~237 | +25 |
| `__tests__/facilitator-router.test.ts` | 0 (NEW) | ~600 | +600 |
| **TOTAL** | **1080** | **~2027** | **+947** |

---

## 9. Auto-Blindaje Lessons Applied (proactive prevention)

> Source: `doc/sdd/WAS-V2-1-auto-blindaje.md`, `doc/sdd/072-wkh-66-v2-thin-proxy/auto-blindaje.md`. Read once — applied below.

### Lesson #1 — Multi-state guards (AB-WAS-V2-1-2)

**Past error:** previous HU shipped a router with `if (verified && settled) return ok` and forgot to handle `verified:false, settled:false` and `verified:true, settled:false` cases distinctly.

**Application here:** the router has FIVE outcomes (ok, guard, fallback_5xx, fallback_unreachable, fallback_known_error). Each MUST be a separate `case` / `if` branch. CD-PROC-1 in §4 enforces this. Tests in §10 cover each.

### Lesson #2 — Append-only for legacy modules (AB-WAS-V2-1-3)

**Past error:** modifying lines in `settlePaymentDirectly` while "tidying up" caused a behavioral regression in chain detection.

**Application here:** CD-14 — lines 1-338 of `usdcSettler.ts` have **empty diff** post-HU. Only the import block and the body of `settlePaymentX402` (lines 363-429) change. F4 QA validates with `git diff`.

### Lesson #3 — No spread with Zod-strict envelope (AB-WAS-V2-1-5)

**Past error:** previous facilitator-client rewrite used `{ ...envelope, x402Version: 2 }` and broke the schema-order invariant. wasiai-facilitator's Zod `.strict()` rejected with HTTP 400 on every settle.

**Application here:** CD-11 + CD-PROC-2 — the router NEVER constructs envelopes. It calls `buildX402V2Envelope(payload, ctx)` exactly once (line ~100 in router) and passes the resulting envelope by reference to both `verifyExternal` and `settleExternal`. Test: assert the envelope keys order remains `['x402Version', 'resource', 'accepted', 'payload']` (already in `x402-facilitator-client.test.ts:39`).

### Lesson #4 — Branch hygiene during cleanup (072 AB)

**Past error:** moving imports during a "cleanup" caused a chain of unused-import warnings that masked a real type error.

**Application here:** Dev removes unused imports in `usdcSettler.ts` ONLY if TS/eslint flags them after the refactor (W2.3). NOT pre-emptively. Keep the diff small.

---

## 10. Test Plan — Full Traceability Matrix (AC → Test Name)

> CD-7: every AC has ≥1 named test. AC-15 traceability lives HERE.

| AC | Test File | Test Name (Dev: use these EXACT strings) |
|----|-----------|------------------------------------------|
| AC-1 | `facilitator-router.test.ts` | `AC-1: toggle unset routes to ultravioleta and never invokes wasiai` |
| AC-1 | `facilitator-router.test.ts` | `AC-1: toggle false routes to ultravioleta` |
| AC-1 | `facilitator-router.test.ts` | `AC-1: toggle FALSE (case-insensitive) routes to ultravioleta` |
| AC-1 | `facilitator-router.test.ts` | `AC-1 backward-compat: toggle off + UVD URL unset falls back to internal settlePaymentDirectly` |
| AC-2 | `facilitator-router.test.ts` | `AC-2: toggle malformed (maybe) routes to ultravioleta and warns once` |
| AC-2 | `facilitator-router.test.ts` | `AC-2: malformed toggle does NOT throw at module init or call time` |
| AC-3 | `facilitator-router.test.ts` | `AC-3: toggle on + chain avalanche-testnet (eip155:43113) calls wasiai first` |
| AC-3 | `facilitator-router.test.ts` | `AC-3: toggle on + chain avalanche (eip155:43114) calls wasiai first` |
| AC-4 | `facilitator-router.test.ts` | `AC-4: toggle on + unknown chain bypasses wasiai and logs chain_not_in_allowlist` |
| AC-5 | `facilitator-router.test.ts` | `AC-5: wasiai verify+settle ok returns wasiai txHash and never calls ultravioleta` |
| AC-6 | `facilitator-router.test.ts` | `AC-6: wasiai 500 on verify falls back to ultravioleta with fallback_reason wasiai_5xx` |
| AC-6 | `facilitator-router.test.ts` | `AC-6: wasiai 503 on settle falls back to ultravioleta with fallback_reason wasiai_5xx` |
| AC-7 | `facilitator-router.test.ts` | `AC-7: wasiai unreachable (CHAIN_UNAVAILABLE literal) falls back with fallback_reason wasiai_unreachable` |
| AC-8 | `facilitator-router.test.ts` | `AC-8: wasiai INVALID_PAYLOAD body falls back with fallback_reason wasiai_invalid_payload` |
| AC-8 | `facilitator-router.test.ts` | `AC-8: wasiai CHAIN_UNAVAILABLE body falls back with fallback_reason wasiai_chain_unavailable` |
| AC-9 | `facilitator-router.test.ts` | `AC-9: both wasiai and ultravioleta fail returns last error and logs both_failed=true` |
| AC-10 | `facilitator-router.test.ts` | `AC-10 CRITICAL: wasiai NONCE_ALREADY_USED body does NOT fall back, returns verified=true settled=false` |
| AC-10 | `facilitator-router.test.ts` | `AC-10 CRITICAL: wasiai HTTP 409 mapped to NONCE_ALREADY_USED does NOT call settleExternal on UVD` |
| AC-11 | `facilitator-router.test.ts` | `AC-11: log structure includes facilitatorUsed, fallbackTriggered, durationMs, ok, errorCode` |
| AC-11 | `facilitator-router.test.ts` | `AC-11 + CD-10: log emitted exactly once per settlement` |
| AC-12 | `x402-facilitator-config.test.ts` | `AC-12: WASIAI_CHAIN_ALLOWLIST is exported and contains the 4 expected chains` |
| AC-12 | `x402-facilitator-config.test.ts` | `AC-12: WASIAI_CHAIN_ALLOWLIST is a ReadonlySet` |
| AC-12 | (manual review F4) | `.env.example contains WASIAI_FACILITATOR_AS_PRIMARY in # Pagos x402 section` |
| AC-13 | (aggregate) | ≥15 tests in facilitator-router.test.ts cover 8 routing branches |
| AC-14 | (regression) | All 410 baseline tests still pass (8 in usdcSettler.x402.test.ts unchanged) |
| AC-15 | (this table) | Every AC has ≥1 named test above |
| CD-12 | `x402-facilitator-client.test.ts` | `CD-12: NONCE_ALREADY_USED is in KNOWN_FACILITATOR_CODES for settle phase` |
| CD-12 | `x402-facilitator-client.test.ts` | `CD-12: NONCE_ALREADY_USED at verify phase returns verified=false (verify failed)` |

### Test fixtures — copy verbatim

```ts
const ctx: SettlePaymentX402Ctx = {
  requestId:    'req-1',
  agentSlug:    'echo',
  resourceUrl:  'https://x.test/api/v1/models/echo/invoke',
  atomicAmount: '1000',
  asset:        '0x5425890298aed601595a70AB815c96711a31Bc65',
  payTo:        '0x0000000000000000000000000000000000000001',
  network:      'avalanche-testnet',
}

const livePayload: X402EVMPayload = {
  signature: '0x' + 'a'.repeat(130),
  authorization: {
    from:        '0x' + '1'.repeat(40),
    to:          '0x' + '2'.repeat(40),
    value:       '1000',
    validAfter:  '0',
    validBefore: '9999999999',
    nonce:       '0x' + '0'.repeat(64),
  },
}
```

### Test pattern — toggle-off (AC-1)

```ts
it('AC-1: toggle unset routes to ultravioleta and never invokes wasiai', async () => {
  const config = await import('@/lib/contracts/x402-facilitator-config')
  ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
  ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

  const client = await import('@/lib/contracts/x402-facilitator-client')
  ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true, body: { verified: true } as VerifyResponseOk,
  })
  ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true, body: { settled: true, transactionHash: '0xUVD' } as SettleResponseOk,
  })

  const { trySettle } = await import('@/lib/contracts/facilitator-router')
  const r = await trySettle(livePayload, '1000', ctx)

  expect(r).toEqual({ verified: true, settled: true, transactionHash: '0xUVD' })
  // wasiai NEVER called → verifyExternal called exactly once (with UVD URL)
  expect(client.verifyExternal).toHaveBeenCalledTimes(1)
  expect(client.verifyExternal).toHaveBeenCalledWith(
    expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
  )
})
```

### Test pattern — idempotency guard (AC-10 — CRITICAL)

```ts
it('AC-10 CRITICAL: wasiai NONCE_ALREADY_USED body does NOT fall back', async () => {
  const config = await import('@/lib/contracts/x402-facilitator-config')
  ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
  ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

  const client = await import('@/lib/contracts/x402-facilitator-client')
  ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true, body: { verified: true } as VerifyResponseOk,
  })
  ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: false,
    error: {
      verified: true,
      settled: false,
      error: 'NONCE_ALREADY_USED: nonce 0xabc...def already consumed on-chain',
    } as SettlementResult,
  })

  const { trySettle } = await import('@/lib/contracts/facilitator-router')
  const r = await trySettle(livePayload, '1000', ctx)

  expect(r).toEqual({
    verified: true, settled: false,
    error: expect.stringMatching(/^NONCE_ALREADY_USED:/),
  })
  // CRITICAL ASSERTIONS — wasiai called twice (verify+settle), UVD ZERO times.
  expect(client.verifyExternal).toHaveBeenCalledTimes(1)
  expect(client.settleExternal).toHaveBeenCalledTimes(1)
  // UVD must NEVER be invoked → both client mocks called ONCE each (the wasiai call).
  expect(client.verifyExternal).not.toHaveBeenCalledWith(
    expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
  )
})
```

### Test pattern — fallback (AC-6)

```ts
it('AC-6: wasiai 500 on verify falls back to ultravioleta with fallback_reason wasiai_5xx', async () => {
  const config = await import('@/lib/contracts/x402-facilitator-config')
  ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
  ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

  const client = await import('@/lib/contracts/x402-facilitator-client')
  // wasiai fails with a SIMULATION_FAILED 5xx-style mapping
  ;(client.verifyExternal as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({  // call #1 = wasiai
      ok: false,
      error: { verified: false, settled: false, error: 'SIMULATION_FAILED: rpc overload' },
    })
    .mockResolvedValueOnce({  // call #2 = uvd
      ok: true, body: { verified: true },
    })
  ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true, body: { settled: true, transactionHash: '0xUVD_RECOVERED' },
  })

  const { logger } = await import('@/lib/logger')
  const { trySettle } = await import('@/lib/contracts/facilitator-router')
  const r = await trySettle(livePayload, '1000', ctx)

  expect(r.transactionHash).toBe('0xUVD_RECOVERED')
  expect(client.verifyExternal).toHaveBeenCalledTimes(2)
  // 1st: wasiai URL
  expect(client.verifyExternal).toHaveBeenNthCalledWith(
    1, expect.anything(), 'https://wasiai.test', expect.any(AbortSignal),
  )
  // 2nd: UVD URL
  expect(client.verifyExternal).toHaveBeenNthCalledWith(
    2, expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
  )
  expect(logger.info).toHaveBeenCalledWith(
    '[settler]',
    expect.objectContaining({
      facilitatorUsed:    'ultravioleta',
      fallbackTriggered:  true,
      fallbackReason:     'wasiai_5xx',
      wasiai_outcome:     'fail',
      uvd_outcome:        'ok',
      ok:                 true,
      durationMs:         expect.any(Number),
    }),
  )
})
```

### Error message strings the Dev MUST use VERBATIM (no inventing)

- Unreachable (timeout/DNS): `'CHAIN_UNAVAILABLE: facilitator unreachable'` (already emitted by `x402-facilitator-client.ts:180`)
- Idempotency: `'NONCE_ALREADY_USED: <facilitator message>'` (built by `mapFacilitatorErrorToSettlementResult` AFTER CD-12 added the code)
- Shape unexpected: `'INVALID_PAYLOAD: facilitator response shape unexpected'` (already at `x402-facilitator-client.ts:212`)

### Test conventions (reuse WAS-V2-1 patterns)

- Use `vi.resetModules()` in `beforeEach` to force fresh dynamic imports.
- Use `vi.clearAllMocks()` in `beforeEach` to clear mock call counts.
- Use `await import('@/lib/...')` (dynamic) AFTER setting up mocks.
- Assert `toHaveBeenCalledTimes(N)` explicitly — count-based assertions catch CD-10 single-log violations.
- Assert `toHaveBeenCalledWith(expect.anything(), URL, ...)` to verify routing.

---

## 11. Risk Inventory (8 risks — Dev MUST respect mitigations)

| # | Risk | Probability | Impact | Mitigation (Dev action) |
|---|------|-------------|--------|--------------------------|
| R-1 | Double-charge on-chain if `NONCE_ALREADY_USED` guard fails and fallback to UVD fires | Low (with CD-12) | **CRITICAL** (real USDC mainnet) | CD-12 mandatory; AC-10 test asserts `settleExternal` is NEVER called on UVD post-409. |
| R-2 | Regression in current payment path during refactor | Medium | High | CD-14 (lines 1-338 intact); CD-2 (toggle off = identity); AC-14 full suite pass; configure existing 8 tests as guard. |
| R-3 | Cache stale toggle between tests | Medium | Medium | `__resetFacilitatorUrlCacheForTesting()` extended to reset ALL caches; tests use `vi.resetModules()`. |
| R-4 | `mapFacilitatorErrorToSettlementResult` maps `NONCE_ALREADY_USED` to `INVALID_PAYLOAD` (CD-12 forgotten) | High if CD-12 skipped | **CRITICAL** | F4 QA verification: `grep "NONCE_ALREADY_USED" src/lib/contracts/x402-facilitator-client.ts` → ≥1 match. |
| R-5 | Duplicate telemetry inflates Grafana histograms | Medium | Low | CD-10 (single log); test `AC-11 + CD-10` asserts `logger.info` called once per settlement. |
| R-6 | UVD timing change (extra latency when wasiai fails → fallback chain) | Medium | Low | Both calls use `AbortSignal.timeout(30_000)`; worst case 60s. Document in `.env.example` if ops wants to lower. |
| R-7 | Operator forgets `OPERATOR_PRIVATE_KEY` in wasiai-facilitator Railway before flipping toggle | Medium | High | Out of code scope (runbook for ops). Dev: NOTHING to add — the router gracefully falls back to UVD on wasiai 500. |
| R-8 | Facilitator returns a new error code the router does not handle | Low | Low | Catchall: unknown codes → `'wasiai_5xx'` fallback reason (defensive fallback to UVD). Log includes `errorCode` for prod detection. |

---

## 12. Post-Wave Verification Commands (run after EACH wave)

```bash
# After W0:
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit
npm test --silent --run -- src/lib/contracts/__tests__/x402-facilitator-config.test.ts
npm test --silent --run -- src/lib/contracts/__tests__/x402-facilitator-client.test.ts

# After W1:
npx tsc --noEmit
npm test --silent --run -- src/lib/contracts/__tests__/facilitator-router.test.ts

# After W2 (full sweep — MANDATORY before declaring DONE):
npx tsc --noEmit
npx eslint src/lib/contracts/
npm test --silent --run
git diff --stat                                       # Expect 7-8 files
git diff src/lib/contracts/usdcSettler.ts | head -50  # CD-14 visual check
```

**Expected final counts:**
- TypeScript errors: **0**
- ESLint errors: **0**
- Tests: **≥425 passing** (410 baseline + ≥15 new). 1 skipped (pre-existing — do not touch).
- `git diff --stat` shows: 5 source files + 3 test files = 8 files. **No surprise files.**

---

## 13. DONE Criteria — what is "complete" for F3 → AR handoff

A wave is complete when:

```
[ ] W0
   [ ] x402-facilitator-config.ts has isWasiaiFacilitatorPrimary(), getWasiaiFacilitatorUrl(),
        WASIAI_CHAIN_ALLOWLIST exports
   [ ] __resetFacilitatorUrlCacheForTesting() resets ALL caches (5 vars)
   [ ] x402-facilitator-client.ts KNOWN_FACILITATOR_CODES contains 'NONCE_ALREADY_USED'
   [ ] x402-facilitator-config.test.ts has ≥6 new tests, all green
   [ ] x402-facilitator-client.test.ts has ≥2 new tests for NONCE_ALREADY_USED, all green
   [ ] tsc --noEmit passes

[ ] W1
   [ ] facilitator-router.ts exists and exports exactly: trySettle
   [ ] No 'any' (CD-1), no spread on envelope (CD-11), no direct env var read (CD-13)
   [ ] Emits exactly one logger.info('[settler]', ...) per call (CD-10) — verified by test
   [ ] facilitator-router.test.ts has ≥15 tests, ALL traceable to ACs per §10 matrix
   [ ] All AC-10 (CRITICAL) tests assert that UVD verifyExternal/settleExternal
        are NEVER called when wasiai returns NONCE_ALREADY_USED
   [ ] tsc --noEmit passes

[ ] W2
   [ ] usdcSettler.ts settlePaymentX402 body is a single delegation line to trySettle
   [ ] git diff src/lib/contracts/usdcSettler.ts shows ZERO changes in lines 50-338
        (the imports block at 14-33 may grow by 1 line for the router import)
   [ ] .env.example has BOTH X402_FACILITATOR_URL and WASIAI_FACILITATOR_AS_PRIMARY
        and WASIAI_FACILITATOR_URL documented in '# Pagos x402' section
   [ ] All 8 pre-existing usdcSettler.x402.test.ts tests pass (or have documented
        rationale for structural test maintenance — see §6 W2.3 note)
   [ ] Full npm test run: ≥425 tests pass | 1 skipped | 0 failed
   [ ] tsc --noEmit + eslint pass on src/lib/contracts/
```

**When all 3 wave checklists are green:**
1. Stage changes (`git add` the 8 files explicitly — do NOT use `git add -A`).
2. Commit with a message referencing WAS-V2-2 and the wave breakdown.
3. **Do NOT push** — that is the orchestrator's decision after AR/CR/QA.
4. Report completion to the orchestrator with the final test counts.

---

## 14. Open Ambiguities / Notes for Orchestrator

> Dev: if you hit an unresolvable ambiguity, STOP and add it here. AR/CR will read this section.

| # | Section | Note | Severity |
|---|---------|------|---------|
| (none) | — | All SDD MIs resolved in SDD §6. All DTs decided. Story File is self-contained. | — |

### Minor design clarifications (Dev may decide pragmatically)

1. **Disambiguating `'CHAIN_UNAVAILABLE: facilitator unreachable'` from a server-side `CHAIN_UNAVAILABLE` body:** the SDD §4.5 + this Story §6.1.1 specify string-match on `'facilitator unreachable'` literal suffix. If the Dev finds a cleaner signal during W1 (e.g. adding an `isNetworkError` flag to `ExternalResult` in W0.2), that is **acceptable** — but it would extend W0.2 beyond "1 line" and should be flagged in the PR. Pragmatic recommendation: stick to string match for blast-radius minimum.

2. **Whether `trySettle` accepts `required` as `string`:** YES, mirror `settlePaymentX402(payload, required, ctx)`. The router passes `required` to `settlePaymentDirectly` when falling back to internal.

3. **Logging `wasiai_status` numeric HTTP code (mentioned in AC-6):** the SDD §4.5 acknowledges the HTTP status is not preserved in `SettlementResult`. The Dev MAY omit numeric `wasiai_status` and log `wasiai_error_code: extractCode(result.error)` instead. Document this in the PR. AC-6 is satisfied by `fallback_reason: 'wasiai_5xx'`.

---

## 15. References (for AR/CR/QA traceability)

- Work item: `doc/sdd/073-was-v2-2-wasiai-facilitator-primary/work-item.md`
- SDD: `doc/sdd/073-was-v2-2-wasiai-facilitator-primary/sdd.md`
- Pre-requisite HU: `doc/sdd/WAS-V2-1-external-facilitator-optin.md` (DONE)
- Auto-Blindajes applied:
  - `doc/sdd/WAS-V2-1-auto-blindaje.md` (AB-WAS-V2-1-2, -3, -5)
  - `doc/sdd/072-wkh-66-v2-thin-proxy/auto-blindaje.md`
- Project context: `.nexus/project-context.md`
- Tx evidence (humano decision 2026-05-11): `0x5fbf570bbc64d477586bb7aeaa71d5e6a1b4f6c540419172ec5b43f2e77733f2`
- Facilitator endpoints:
  - wasiai-facilitator: `https://wasiai-facilitator-production.up.railway.app`
  - Ultravioleta DAO: `https://facilitator.ultravioletadao.xyz`

---

*Story File generated by nexus-architect F2.5 — 2026-05-11 — WAS-V2-2 — SPEC_APPROVED ✅*
