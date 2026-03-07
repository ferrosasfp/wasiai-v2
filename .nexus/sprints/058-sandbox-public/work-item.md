# Work Item — 058: Sandbox público sin login

**Classification:** HU-MAJOR
**Priority:** P0
**Sprint:** 17

---

## Problem

Sandbox requires login to invoke agents. Potential users who arrive curious leave without trying the product because they won't create an account for something they haven't tested.

## Desired Outcome

Anyone can use the sandbox without logging in. Rate limited by IP to prevent abuse. After hitting the limit, prompt to create an account.

## Acceptance Criteria

1. **AC-1:** Unauthenticated user can load sandbox page and see agent list
2. **AC-2:** Unauthenticated user can invoke an agent (up to 5 calls per IP per day)
3. **AC-3:** After 5 calls, user sees message: "Create a free account to keep testing" with login/signup link
4. **AC-4:** Authenticated users have their normal balance-based limits (no IP limit)
5. **AC-5:** Rate limit by IP stored server-side (Redis or in-memory with TTL)
6. **AC-6:** No wallet connection required for sandbox invocations
7. **AC-7:** Balance display hidden for unauthenticated users
8. **AC-8:** Build passes clean

## Files Likely Affected

- `src/app/[locale]/sandbox/page.tsx` — already made public (057)
- `src/app/[locale]/sandbox/SandboxClient.tsx` — hide balance, show limit message
- `src/app/api/v1/sandbox/invoke/[slug]/route.ts` — accept unauthenticated, rate limit by IP
- `src/app/api/v1/sandbox/balance/route.ts` — return default for unauthenticated
