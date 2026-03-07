# Work Item — 061: Free trial sin login

**Classification:** HU-MINOR
**Priority:** P1
**Sprint:** 17

---

## Problem

Agent detail page has "Free Trial" button that requires login. Same friction as sandbox — users leave without trying.

## Desired Outcome

Free trial calls work without login, rate limited by IP (same as sandbox). After limit, prompt to create account.

## Acceptance Criteria

1. **AC-1:** Unauthenticated user can click "Free Trial" on agent detail page
2. **AC-2:** Trial invocation works without login (up to 3 calls per agent per IP per day)
3. **AC-3:** After limit, show "Create a free account to keep using" message
4. **AC-4:** Authenticated users have normal trial behavior
5. **AC-5:** Build passes clean

## Notes

- Shares rate-limit infrastructure with 058 (sandbox). Implement 058 first, reuse in 061.
