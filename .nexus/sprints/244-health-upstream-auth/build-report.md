# Build Report — WAS-244

**Task:** Fix health probe to send webhook_secret auth and treat 4xx as unhealthy

**Date:** 2026-03-19  
**Builder:** Subagent (depth 1)

---

## Wave Execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | N/A | Pre-flight validation complete. File exists, webhook_secret column confirmed (TEXT NOT NULL), bug confirmed (not yet implemented). |
| Wave 1 | ✅ PASS | ✅ PASS | All 4 changes applied to `health/route.ts`. TypeScript compilation clean, ESLint 0 warnings. |

---

## Commit

- **Hash:** `9d724c6bd94e88bb16320d33893789f19d0ecff8`
- **Message:** `fix(WAS-244): health probe sends webhook_secret auth — treat 4xx as unhealthy`
- **Files changed:** 1
- **Stats:** +6 insertions, -3 deletions

---

## Changes Applied

### 1. Select webhook_secret from DB ✅
```diff
- .select('slug, name, status, endpoint_url')
+ .select('slug, name, status, endpoint_url, webhook_secret')
```

### 2. Send Authorization header in probe ✅
```typescript
headers: {
  'Content-Type': 'application/json',
  ...(model.webhook_secret ? { 'Authorization': `Bearer ${model.webhook_secret}` } : {}),
},
```

### 3. Only probe.ok (2xx) = healthy ✅
```diff
- status: probe.ok || probe.status < 500 ? 'healthy' : 'unhealthy',
+ status: probe.ok ? 'healthy' : 'unhealthy',
```

### 4. webhook_secret NOT in response ✅
Verified all response objects (success, error, 404, 503) — none include `webhook_secret`.

---

## Acceptance Criteria Verification

- ✅ **AC-01:** Probe includes `Authorization: Bearer {webhook_secret}` (if not null)
- ✅ **AC-02:** HTTP 200 upstream → status: "healthy"
- ✅ **AC-03:** HTTP 4xx/5xx upstream (including 401) → status: "unhealthy"
- ✅ **AC-04:** webhook_secret null/empty → probe without auth header (graceful spread operator)
- ✅ **AC-05:** webhook_secret does NOT appear in API response
- ✅ **AC-06:** Response shape preserved (slug, name, status, latency_ms, upstream_status)

---

## Build Gate Results

```
✅ npm run typecheck — PASS (no type errors)
✅ npm run lint — PASS (0 warnings)
```

---

## Rollback Procedure

Single commit, single file, no database migration required:

```bash
git revert 9d724c6bd94e88bb16320d33893789f19d0ecff8
```

---

## Notas

- Fix implementado exactamente según SDD WAS-244
- No se tocaron archivos adyacentes
- No se agregaron features adicionales
- Build completamente limpio
- Commit local creado (NO pushed — per protocol)
- Upstream 401 ahora correctamente reportado como "unhealthy"
- Auth header enviado solo cuando webhook_secret existe (graceful degradation)

**Status:** ✅ COMPLETE — Ready for review/merge
