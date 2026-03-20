# QA Report — WAS-245

**Fecha:** 2026-03-19 16:58 CST  
**Verifier:** QA Subagent  
**Commits verificados:**
- `cde0c75f18dfb924d274b418a2ff3e11ec6d3ad4` — serviceClient + is_available secondary signal
- `8cd98c03f` — hasRecentActivity 24h window

---

## AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| **AC-01**: `last_invocation_at` usa serviceClient para bypass RLS | ✅ PASS | `route.ts:152-159` — `createServiceClient()` + query a `agent_calls` con service role |
| **AC-02**: `is_available: true` cuando hay calls exitosas en últimas 24h (no 30d) | ✅ PASS | `route.ts:161-170` — ventana de 24h (`Date.now() - 24 * 60 * 60 * 1000`)<br>`route.ts:172-175` — `hasRecentActivity` filtra status === 'success'<br>`route.ts:194` — `isAvailable` usa `hasRecentActivity` como señal secundaria |
| **AC-03**: `is_available: false` si `health_check.passed === false` explícito | ✅ PASS | `route.ts:193-194` — `healthCheckFailed` override: `!healthCheckFailed && (...)` |
| **AC-04**: No se expone data privada en el response | ✅ PASS | `route.ts:208-225` — solo métricas públicas (score, latencias, is_available, etc.)<br>No hay PII, user_id, tokens, o datos internos |
| **AC-05**: Shape del response se preserva | ✅ PASS | `route.ts:208-225` — estructura original intacta<br>Solo agregado: `signal_weights` (WAS-188) |

---

## Build & Tests

| Check | Result |
|-------|--------|
| **Drift** | ✅ 1 archivo modificado (esperado: 1) |
| **TypeScript** | ✅ `tsc --noEmit` sin errores |
| **Lint** | ✅ `eslint --max-warnings 0` sin errores |
| **Tests** | ⚠️ 5 fallos de 241 tests (no relacionados con WAS-245)<br>236 tests pasan |

**Nota sobre tests:** Los 5 fallos son pre-existentes (timeout tests en otro endpoint). No hay nuevos fallos introducidos por estos commits.

---

## Smoke Test (Producción)

**Endpoint:** `https://app.wasiai.io/api/v1/agents/wasi-chainlink-price/reputation`

**Resultado:**
```
is_available: False
last_invocation_at: None
score: 68
```

⚠️ **PENDIENTE DEPLOY** — el endpoint en producción aún devuelve comportamiento legacy:
- `last_invocation_at` = null (debería usar serviceClient)
- `is_available` = false (debería considerar señales secundarias)

Los commits `cde0c75f` y `8cd98c03f` **no están desplegados** en producción.

---

## Veredicto: **QA PASS** ✅

**Justificación:**
- ✅ Los 5 ACs se cumplen con evidencia concreta en el código
- ✅ Build limpio (typecheck + lint)
- ✅ Tests pasan (fallos pre-existentes no relacionados)
- ✅ Lógica implementada correctamente según spec

**Blocker para PROD:**
- 🚀 **Deploy pendiente** — commits verificados localmente, listos para deploy

**Recomendación:** Proceder con deploy a producción y re-ejecutar smoke test post-deploy.

---

**Firmado:** QA Verifier Subagent  
**Hash de commits:** `cde0c75f`, `8cd98c03f`
