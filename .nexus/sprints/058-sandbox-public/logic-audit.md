# Logic Audit — SDD 058: Sandbox público sin login

**Auditor:** Logic Auditor (subagent)  
**Date:** 2026-03-07  
**Commit:** `019f46a` — `feat(058,061): public sandbox + free trial without login`

---

## Check Results

### 1. Rate Limiter (`src/lib/rate-limit-ip.ts`) — **PASS**

- Uses `@upstash/ratelimit` with `slidingWindow(maxCalls, '1 d')` — TTL is handled by Upstash automatically.
- Lazy singleton pattern via `Map` avoids recreating limiters per request.
- Redis credentials sourced from env vars with `!` assertions — acceptable for server-only code.
- No logic bugs found.

### 2. IP Extraction & Spoofing Risk — **PASS ⚠️ (advisory)**

- IP extracted via `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'`.
- This is standard for Vercel/Next.js deployments where the platform sets `x-forwarded-for` reliably.
- **Advisory:** If deployed behind a misconfigured proxy, clients could spoof `x-forwarded-for`. On Vercel this is safe (platform overwrites the header). On self-hosted setups, consider using a trusted proxy header. **Not a blocker.**
- Fallback to `127.0.0.1` means if header is missing, all anonymous users share one bucket — conservative fail-safe.

### 3. Sandbox Invoke Route — Anonymous Data Access — **PASS**

- Auth block changed from hard 401 to `isAnonymous = !user`.
- Steps 4–6 (balance upsert, check, deduction) wrapped in `if (!isAnonymous)` — anonymous users skip all balance/credit logic.
- No authenticated-only data leaks: agent info returned (slug, name) is public. Response body is the agent's output — same as what an authenticated user would see.
- `caller_id: user?.id ?? null` — DB column is nullable (`UUID REFERENCES auth.users(id)` without `NOT NULL`). **Safe.**

### 4. Refund Logic for Anonymous — **PASS**

- SSRF validation refund (step 7) and agent failure refund (step 9b) both wrapped in `if (!isAnonymous)`. Correct — no balance to refund for anon.

### 5. Balance API (`/api/v1/sandbox/balance`) — **PASS**

- Returns `{ balance_usdc: null, total_calls: 0, anonymous: true }` for unauthenticated. No DB query executed. Safe.

### 6. UI — SandboxClient.tsx — **PASS**

- `isAnonymous = !userId` derived from server-provided prop.
- Balance fetch skipped when `!userId`. Balance card hidden via `{!isAnonymous && (...)}`.
- `anonLimitHit` state set on `code === 'anon_rate_limited'` → shows "Crear cuenta gratis" banner, disables invoke button.
- `<a>` replaced with `<Link>` for `/auth/login` (lint compliance).

### 7. Remaining Auth Guards — **PASS**

- `grep` for `401`, `Unauthorized`, `unauthorized` across all four files: **zero matches**. All auth guards removed or converted to optional.

---

## Blockers

None.

## Advisory Notes

| # | Severity | Note |
|---|----------|------|
| A1 | Low | `x-forwarded-for` spoofing possible on non-Vercel deployments. Mitigate by using platform-specific trusted headers if self-hosted. |

## Verdict

**✅ PASS** — All checks pass. Implementation matches SDD spec. No blockers.
