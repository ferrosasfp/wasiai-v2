# Logic Audit — Sprint 255: Chat DeFi
**Auditor:** Logic Auditor subagent  
**Date:** 2026-03-20  
**Verdict:** ✅ PASS with 2 real bugs and 3 minor observations

---

## AC Traceability Table

| AC | Description | Implementation | Status |
|----|-------------|---------------|--------|
| AC1 | User question → LLM interprets → compose executes pipeline | `route.ts:54-108` (planner LLM) + `route.ts:111-130` (compose fetch) | ✅ |
| AC2 | Loading state, then show each step with agent name, cost USDC, status | `ChatPageClient.tsx:106-115` (loading spinner) + `ChatPageClient.tsx:143-169` (steps list) | ✅ (post-load only, see F2) |
| AC3 | Success → summary + total cost + receipts (EIP-712, no Snowtrace) | `ChatPageClient.tsx:120-135` (summary), `137-141` (cost), `143-169` (steps), `171-196` (receipts) | ✅ (no Snowtrace link confirmed) |
| AC4 | No API key → show message with link to /en/models | `ChatPageClient.tsx:82-90` (inline hint with Link to `/${locale}/models`) | ✅ |
| AC5 | Pipeline fails → show error + partial steps | `route.ts:118-128` (returns steps in error payload) + `ChatPageClient.tsx:68-73` (sets error) | ⚠️ BUG — see F1 |
| AC6 | Responsive mobile | `ChatPageClient.tsx:99` (`max-w-2xl px-4 py-10`), BottomTabBar hidden on `sm:` | ✅ |
| AC7 | Spanish + English via next-intl | `ChatPageClient.tsx:30` (`useTranslations('chat')`), `messages/en.json` + `messages/es.json` both have `chat` section | ✅ |
| AC8 | LLM can't map to agents → "can only answer DeFi" message | `route.ts:80-88` (parse fail) + `route.ts:91-96` (empty steps) both return `no_agents_matched` | ✅ |
| AC9 | Max 5 steps | `route.ts:101` (`steps.slice(0, 5)`) | ✅ |
| AC10 | Only 5 prod agents in LLM prompt (no liquidity-analyzer, no wallet-profiler) | `route.ts:7-20` (PLANNER_SYSTEM) — exactly 5 agents listed | ✅ |

---

## Critical Checklist

| Check | Result |
|-------|--------|
| LLM prompt lists exactly 5 agents (NOT 7) | ✅ PASS |
| `callLLM` uses `response.result` (NOT `response.content`) | ✅ PASS — `route.ts:71` + `route.ts:139` |
| compose self-fetch uses `NEXT_PUBLIC_SITE_URL` | ✅ PASS — `route.ts:104` |
| `x-api-key` forwarded correctly to compose | ✅ PASS — `route.ts:113` |
| `maxDuration = 60` | ✅ PASS — `route.ts:4` |
| temperature 0 for planner | ✅ PASS — `route.ts:60` |
| temperature 0.3 for summary | ✅ PASS — `route.ts:135` |
| fail-open: summary LLM failure → return raw result | ✅ PASS — `route.ts:141-144` |
| question validated (1–500 chars) | ✅ PASS — `route.ts:45-50` |
| No auth check on chat page | ✅ PASS — `page.tsx` has no auth/session guard |
| BottomTabBar has chat in BOTH logged-in AND logged-out arrays | ✅ PASS — `BottomTabBar.tsx:64` (logged-in) + `BottomTabBar.tsx:70` (logged-out) |

---

## Findings

| # | Severity | File | Line | Description |
|---|----------|------|------|-------------|
| F1 | 🔴 BUG | `ChatPageClient.tsx` | ~68-73 | **AC5 partial steps not displayed on error.** The backend correctly returns `steps` in the error payload (`route.ts:122`), but the client only calls `setError(data.error)` and never calls `setResult(data)`. Partial steps from a failed pipeline are silently discarded — user only sees the error message, not which agents ran successfully before the failure. |
| F2 | 🟡 MINOR | `ChatPageClient.tsx` | ~106-115 | **AC2 "each step during execution" not streaming.** The loading spinner shows but individual steps are only displayed after the full pipeline completes. AC2 says "show each step with agent name, cost USDC, status" — the current architecture is non-streaming (single POST → wait → display all). Acceptable if AC2 means "display steps in result", but ambiguous. No streaming capability exists in the API. |
| F3 | 🟡 MINOR | `route.ts` | 45 | **Whitespace-only question edge case.** `question.trim().length === 0` rejects whitespace-only strings, but `question.length > 500` does NOT trim before length check. A 501-char string with leading/trailing whitespace passes `trim()` length check but fails the raw `> 500` check. This is actually CORRECT behavior but could confuse clients — a 499-char string + 2 leading spaces would be rejected as > 500. Client-side `maxLength={500}` mitigates but API callers could be confused. |
| F4 | 🟢 OBS | `ChatPageClient.tsx` | ~171-196 | **Receipts not labeled as EIP-712.** SDD says "EIP-712 receipts." The UI shows `receipt_signature` truncated but has no label saying "EIP-712 signature." Cosmetic only — no Snowtrace links (good). |
| F5 | 🟢 OBS | `route.ts` | 104 | **Fallback URL hardcoded.** `NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'` — if the env var is missing in production the fallback prevents silent failure but masks a misconfiguration. A `console.warn` when using fallback would help ops. |

---

## Bug Detail: F1 (AC5) — Partial Steps Lost on Pipeline Failure

**Root cause:** In `ChatPageClient.tsx` `handleSubmit`:

```ts
if (!res.ok) {
  if (data.code === 'no_agents_matched') {
    setError(t('noAgents'))
  } else {
    setError(data.error ?? t('errorGeneric'))  // ← only sets error
  }
} else {
  setResult(data)
}
```

The backend sends `{ error, code, steps: [...], receipts: [...] }` on 502, but the client ignores `data.steps`. Fix:

```ts
} else {
  setError(data.error ?? t('errorGeneric'))
  if (data.steps?.length) setResult(data)  // show partial steps too
}
```

---

## Verdict

**PASS with required fix for F1.**

- All 10 ACs are implemented. 9/10 are fully correct.
- AC5 has a real bug: partial steps from a failed pipeline are returned by the backend but silently dropped by the frontend. The error message shows but the user can't see which steps ran.
- F2 is a design trade-off (non-streaming), not a bug — acceptable if stakeholders agreed.
- F3, F4, F5 are observations requiring no immediate action.

**Recommended action before merging:** Fix F1 in `ChatPageClient.tsx` to display partial steps when the pipeline returns an error response with steps data.
