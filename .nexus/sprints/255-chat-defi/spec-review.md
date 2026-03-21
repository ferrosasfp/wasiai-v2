# Spec Review — WAS-255 Chat DeFi
**Reviewer:** Spec Reviewer subagent  
**Date:** 2026-03-20  
**SDD:** `.nexus/sprints/255-chat-defi/sdd.md`

---

## Wave 0 — Pre-flight Results

| Check | Item | Result | Notes |
|-------|------|--------|-------|
| 0.1 | `/api/v1/chat` route exists? | ✅ PASS (not found) | Clean slate, no collision |
| 0.1 | `/[locale]/chat` page exists? | ✅ PASS (not found) | Clean slate |
| 0.1 | `ChatPageClient` exists? | ✅ PASS (not found) | Clean slate |
| 0.2 | `src/lib/agents/llm.ts` exists? | ✅ PASS | Exports `callLLM` at line 98 |
| 0.2 | `src/app/api/v1/compose/route.ts` exists? | ✅ PASS | POST handler at line 156 |
| 0.2 | `src/components/WasiNavBar.tsx` exists? | ✅ PASS | lucide-react imports confirmed |
| 0.2 | `src/features/auth/components/NavBar.tsx` exists? | ✅ PASS | NAV_ITEMS at line 9 |
| 0.2 | `src/features/auth/components/BottomTabBar.tsx` exists? | ✅ PASS | createItems at line 65 |
| 0.2 | `messages/en.json` exists? | ✅ PASS | nav section exists |
| 0.2 | `messages/es.json` exists? | ✅ PASS | (presence confirmed via pattern) |
| 0.2 | `src/app/[locale]/pipelines/_components/PipelinePageClient.tsx` exists? | ✅ PASS | Confirmed |
| 0.2 | `src/components/pipelines/PipelineStatus.tsx` exists? | ✅ PASS | In `pipelines/_components/` |
| 0.3a | `callLLM` signature matches SDD usage? | ✅ PASS | `LLMOptions = { messages: LLMMessage[], model?, maxTokens?, temperature? }` → `LLMResult.result: string` — matches exactly |
| 0.3a | compose uses `x-api-key` (not `x-agent-key`)? | ✅ PASS | Line 160: `request.headers.get('x-api-key')` |
| 0.3a | NAV_ITEMS uses `{ href, key }` format? | ✅ PASS | Lines 10-15 confirmed |
| 0.3a | WasiNavBar uses lucide-react icons? | ✅ PASS | Line 6: Package, GitBranch, KeyRound, User, Globe |
| 0.3a | BottomTabBar uses lucide-react icons? | ✅ PASS | Package, GitBranch, KeyRound confirmed |
| 0.3a | i18n nav uses flat key structure? | ✅ PASS | nav keys: `marketplace`, `dashboard`, `pipelines`, etc. |
| 0.3a | `"chat"` key already in `messages/en.json` nav? | ✅ PASS (absent) | Correctly absent — Wave 4 adds it |
| 0.4 | WAS-254 Transform Layer done? | ✅ PASS | SDD marks it ✅ DONE, compose POST confirmed functional |
| 0.5 | `NEXT_PUBLIC_SITE_URL` in env? | ✅ PASS | Present in `.env.local` and `.env.prod.tmp` |
| 0.5 | SDD has no TODOs? | ✅ PASS | No TODO markers found |
| 0.5 | PROHIBIDO count ≥ 3? | ✅ PASS | 4 PROHIBIDO: streaming, conversation history, >500 chars, frontend→compose direct |

---

## Coherence Check

| Check | Result | Notes |
|-------|--------|-------|
| AC1 → Wave? | ✅ Wave 1 (LLM interprets question → compose) | |
| AC2 → Wave? | ✅ Wave 2 (loading state + step display) | |
| AC3 → Wave? | ✅ Wave 2 (summary, cost, receipts) | |
| AC4 → Wave? | ✅ Wave 2 (no-key state) | |
| AC5 → Wave? | ✅ Wave 1 + Wave 2 (partial steps on error) | |
| AC6 → Wave? | ✅ Wave 2 (responsive, max-w-2xl) | |
| AC7 → Wave? | ✅ Wave 3 + Wave 2 (useTranslations) | |
| AC8 → Wave? | ✅ Wave 1 (empty array → 422 no_agents_matched) | |
| AC9 → Wave? | ✅ Wave 1 (validates 1-5 steps) | |
| Build gate on every wave? | ✅ PASS | Every wave ends with `tsc --noEmit` |
| Rollback executable? | ✅ PASS | 4 concrete steps: delete route, delete page dir, remove i18n sections, remove nav link |

---

## Findings

### 🔴 FINDING #1 — BottomTabBar: Chat link invisible to logged-out users (public page inconsistency)

**Location:** Wave 4, step 3 — `src/features/auth/components/BottomTabBar.tsx`  
**Severity:** Medium (UX bug)

The SDD says to add chat to `createItems` in BottomTabBar at line ~68. However, `createItems` is inside an `isLoggedIn ? [...] : [...]` guard (line 65). This means **mobile users who are NOT logged in cannot see the Chat DeFi nav link** in the bottom tab bar.

This conflicts with the SDD's explicit constraint: *"chat page is PUBLIC — no auth required."*

NavBar.tsx (desktop) adds it to `NAV_ITEMS` which is unconditional — correct.  
WasiNavBar.tsx's `createItems` is outside the isLoggedIn check — correct.  
BottomTabBar.tsx's `createItems` is inside the isLoggedIn check — **inconsistent**.

**Recommendation:** Builder should add chat to both logged-in AND logged-out `createItems` arrays in BottomTabBar, OR add it as a standalone always-visible tab item. The SDD should clarify this.

---

### 🟡 FINDING #2 — LLMMessage array construction not shown explicitly

**Location:** Wave 1, steps 4 and 8  
**Severity:** Low (builder can infer)

The SDD describes the system prompt and user content but doesn't show the exact `LLMMessage[]` array construction. The actual type is:
```ts
interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string }
```

The SDD says "system prompt (EXACT): ..." and "User content: the question" — a competent builder will construct:
```ts
messages: [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: question }
]
```
Not a blocker, but explicit would be safer.

---

### 🟡 FINDING #3 — WasiNavBar placement puts Chat in "Create" dropdown

**Location:** Wave 4, step 2  
**Severity:** Low (design concern, not a bug)

The SDD adds chat to WasiNavBar's `createItems` array (the "Create" dropdown). This means Chat DeFi appears under the Create menu, not as a top-level navigation item. The SDD is explicit about this, so it's intentional — but it's worth flagging for product review: a conversational chat feature placed in a "Create" menu may confuse users.

NavBar.tsx correctly adds it as a top-level `NAV_ITEMS` entry for desktop.

---

### ✅ FINDING #4 — `PipelineStatus.tsx` location mismatch (minor doc issue)

**Location:** Wave 0 checklist in SDD  
**Severity:** Cosmetic

SDD references `src/components/pipelines/PipelineStatus.tsx` but the actual path is `src/app/[locale]/pipelines/_components/PipelineStatus.tsx`. File exists but path in SDD is wrong. Builder should look in the `_components/` folder.

---

## Verdict

**✅ SDD IS READY TO BUILD** — with one required clarification.

| Category | Status |
|----------|--------|
| Wave 0 pre-flight | ALL PASS |
| AC traceability | ALL 9 ACs covered |
| Build gates | ALL waves have `tsc --noEmit` |
| Rollback | Executable |
| Constraints | 5 PROHIBIDO + 6 NOTA |
| Blocking issues | 0 |
| Non-blocking findings | 3 |

**Required action before Builder starts:**  
→ Clarify Wave 4 step 3 (BottomTabBar): should chat appear for logged-out users on mobile? Recommend YES since page is public. Builder should add `MessageCircle` chat link to **both** branches of the `isLoggedIn` ternary, or define a separate always-visible item.

**Everything else is green.** The callLLM signature matches, compose header is correct, env vars exist, no existing code conflicts.
