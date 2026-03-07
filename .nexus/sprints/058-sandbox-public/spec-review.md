# Spec Review — SDD 058: Sandbox público sin login

**Reviewer:** NexusAgil Spec Reviewer (automated)  
**Date:** 2026-03-06  
**Verdict:** ✅ APPROVED (with advisory notes)

---

## Codebase Verification

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | `@upstash/redis` in package.json | ✅ PASS | Lines 38-39: `@upstash/ratelimit` ^2.0.8, `@upstash/redis` ^1.36.2 |
| 2 | Sandbox invoke route exists | ✅ PASS | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` exists |
| 3 | Balance route exists | ✅ PASS | `src/app/api/v1/sandbox/balance/route.ts` exists |
| 4 | `SandboxClient.tsx` exists | ✅ PASS | Has `userId: string | null` prop — already nullable-aware |
| 5 | "Before" code blocks match actual code | ✅ PASS | Auth block, rate limit block, caller_id, updatedCredits all match verbatim |
| 6 | `caller_id` nullable in DB | ✅ PASS | Migration: `caller_id UUID REFERENCES auth.users(id)` — no NOT NULL constraint |

## AC ↔ Wave Mapping

| AC | Wave | Status |
|----|------|--------|
| AC-1: Sandbox page loads without auth | Pre-req (057) | ✅ PASS |
| AC-2: Anonymous invoke, 5 calls/IP/day | Wave 1 + Wave 2 | ✅ PASS |
| AC-3: Limit message shown | Wave 4 (Changes 3, 6) | ✅ PASS |
| AC-4: Authenticated users unaffected | Wave 2 (Change 3) | ✅ PASS |
| AC-5: Rate limit via Redis | Wave 1 | ✅ PASS |
| AC-6: No wallet required | Wave 2 (Change 4) | ✅ PASS |
| AC-7: Balance hidden for anon | Wave 4 (Changes 2, 5) | ✅ PASS |
| AC-8: Clean build | Wave 5 | ✅ PASS |

## Advisory Notes (non-blocking)

### 1. Line numbers are approximate
SDD references auth block at "lines 60–64" but actual code has it at ~78–81. Rate limit at "lines 66–75" is actually ~83–92. The "Before" text blocks are exact matches, so this is cosmetic — implementer should match on code patterns, not line numbers.

### 2. SandboxClient 429 handler needs careful merge
The existing 429 branch (line 110) already handles `sandbox_rate_limited`. SDD Change 3 shows an `else if` structure but the actual code already has a single `else if (res.status === 429)` block. The implementer needs to add an inner `if (errData.code === 'anon_rate_limited')` check **inside** the existing 429 branch, not alongside it. The SDD snippet is slightly ambiguous here.

### 3. IP spoofing via X-Forwarded-For
Both the existing rate limit and the new anonymous limit use `req.headers.get('x-forwarded-for')?.split(',')[0]`. In production behind Vercel/Cloudflare this is reliable. If deployed behind a different proxy, `X-Forwarded-For` can be spoofed. **Mitigation:** Vercel sets this header server-side; acceptable risk for current infra.

### 4. `updatedCredits` refactor in Change 6
SDD Change 6 moves the `updatedCredits` fetch into an else-branch. The original code at line 223 is **outside** any conditional. Implementer must ensure the variable is properly scoped and the response still works for both paths.

## Blockers

None.

## Verdict

**✅ APPROVED** — All ACs covered, all referenced files exist, code patterns match, DB schema compatible. Proceed to implementation.
