# NexusGuard FAST-FIX Report
**Date:** 2026-03-16  
**Builder:** NexusAgil v1.3  
**Commit:** `fix(security): NexusGuard FAST-FIX — admin auth + HSTS + SSRF async + CSP cleanup`

---

## Summary

All 6 NexusGuard FAST-FIX items applied successfully. Build passes: 0 errors, 0 ESLint warnings.

---

## Fixes Applied

### ✅ NG-C01 — Admin auth on GET /api/admin/treasury
**File:** `src/app/api/admin/treasury/route.ts`  
**Change:** Added EIP-712 signature verification at the top of `GET()`. Function signature changed from `GET()` to `GET(request: NextRequest)`. Added import of `NextRequest` and `verifyAdminSignature`. Action string: `'getTreasury'`.

### ✅ NG-C02 — Admin auth on GET /api/admin/status
**File:** `src/app/api/admin/status/route.ts`  
**Change:** Same pattern as NG-C01. Action string: `'getStatus'`. Both endpoints now return `401` if auth headers are missing or signature is invalid/expired.

### ✅ NG-M01 — HSTS header
**File:** `next.config.mjs`  
**Change:** Added to `securityHeaders` array:
```javascript
{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
```

### ✅ NG-H02 — SSRF: async DNS validation in invoke/compose/sandbox
**Files:**
- `src/app/api/v1/models/[slug]/invoke/route.ts`
- `src/app/api/v1/compose/route.ts`
- `src/app/api/v1/sandbox/invoke/[slug]/route.ts`

**Change:** Replaced `validateEndpointUrl(...)` (sync) with `await validateEndpointUrlAsync(...)` in all three files. Updated import to `validateEndpointUrlAsync`. This enables async DNS resolution checks, preventing DNS-rebinding SSRF attacks.

### ✅ NG-L02 — CSP cleanup: remove facilitator.ultravioletadao.xyz
**File:** `middleware.ts`  
**Change:** Removed `https://facilitator.ultravioletadao.xyz` from `connect-src` directive. This domain was deprecated in WAS-134; leaving it in CSP unnecessarily broadens the allowed connection surface.

### NG-L03 — npm audit + .env.example
**npm audit:** Ran `npm audit fix` (no `--force`). Result: 8 packages updated, **0 vulnerabilities** remaining.

**`.env.example`:** Added two missing sections:
- `INTERNAL_API_SECRET` (with generation hint)
- `WASIAI_OWNER_ADDRESS` and `NEXT_PUBLIC_WASIAI_OWNER` under new `# Admin / Owner` section

---

## Build Gate

```
npm run build → ✅ EXIT 0
ESLint --max-warnings 0 → ✅ PASS
```

Only warning observed: Next.js workspace root inference (pre-existing, unrelated to security changes).

---

## No regressions

- All 3 SSRF-affected routes still use try/catch around the validation call — async errors propagate correctly.
- Admin panel frontend will need to be updated to send `x-admin-signature`, `x-admin-nonce`, `x-admin-timestamp` headers on GET requests to `/api/admin/treasury` and `/api/admin/status`. (Out of scope for this FAST-FIX; tracked separately.)
