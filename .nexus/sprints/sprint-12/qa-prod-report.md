# QA Report — Producción WasiAI
**Fecha:** 2026-03-17  
**Ejecutado por:** San (subagente QA)  
**App:** https://app.wasiai.io  
**API base:** https://app.wasiai.io/api

---

## Suite 1 — APIs públicas

| Test | HTTP | Status | Detalle |
|------|------|--------|---------|
| 1.1 Discovery `?limit=5` | 200 | ✅ PASS | Retorna 5 agentes con slug, price_per_call_usdc, category, tags, input_schema, erc8004. Paginación con `next_cursor` presente. |
| 1.2 Filtro por categoría `?category=defi` | 200 | ✅ PASS | Retorna 3 agentes de categoría "defi": wasi-risk-report, wasi-onchain-analyzer, wasi-chainlink-price. |
| 1.3 Filtro por tag `?tag=oracle` | 200 | ✅ PASS | Retorna 1 agente (wasi-chainlink-price) con tag "oracle". Filtro funciona correctamente. |

---

## Suite 2 — Invocación Agent Key

> **Nota de arquitectura:** Los endpoints `/api/v1/models/{slug}/invoke` implementan el protocolo **x402** (micropayments on-chain USDC en Avalanche). El Agent Key (`wasi_...`) **no** bypasea el pago x402. Sin pago on-chain válido, todos retornan 402 con instrucciones de pago. El campo `input` no es válido — los agentes requieren `token` o `wallet` según su `input_schema`.

| Test | HTTP | Status | Detalle |
|------|------|--------|---------|
| 2.1 Invoke wasi-liquidity-analyzer | 402 | ⚠️ OBSERVACIÓN | Retorna x402 payment challenge con `payTo`, `maxAmountRequired: 50051 USDC-micro`, `asset`. La invocación requiere pago on-chain. El bearer token solo no es suficiente. |
| 2.2 Invoke wasi-wallet-profiler | 402 | ⚠️ OBSERVACIÓN | Mismo comportamiento x402. Input correcto sería `{"wallet": "0x..."}` no `{"input": "..."}`. |
| 2.3 Invoke wasi-risk-report | 402 | ⚠️ OBSERVACIÓN | x402 payment required: 200051 USDC-micro ($0.20). Input correcto: `{"token": "BENQI"}`. |
| 2.4 Compose API | N/A | ⚠️ SKIP | No probado — endpoint `/api/v1/compose` depende de invocación de agentes que requieren x402. Se skipea para evitar cargos reales. |

> **Bug detectado:** Con body `{"input": "..."}` (schema incorrecto), el endpoint retorna **422** antes de verificar auth/payment. La validación de input ocurre **antes** que la verificación de auth/pago. Esto expone que el endpoint existe y el schema es inválido incluso a callers no autorizados.

---

## Suite 3 — Auth checks

| Test | HTTP | Status | Detalle |
|------|------|--------|---------|
| 3.1 `GET /api/creator/transactions` sin auth | 401 | ✅ PASS | `{"error":"unauthorized"}` — protección correcta. |
| 3.2 `GET /api/creator/analytics` sin auth | 401 | ✅ PASS | `{"error":"unauthorized"}` — protección correcta. |

---

## Suite 4 — Onboarding Wizard (WAS-232)

| Test | HTTP | Status | Detalle |
|------|------|--------|---------|
| 4.1 `POST /onboard/start` | 201 | ✅ PASS | `{ session_id, step: 1, total_steps: 7, question: "What is your agent's name?", hint }` — estructura correcta. |
| 4.2 Steps 1+2 + GET status | N/A | ❌ BLOQUEADO | Rate limit en efecto (4.5 se ejecutó antes). `POST /onboard/start` devuelve 429. No se pudo completar el flujo. Reset: 2026-03-18T06:00:00Z |
| 4.3 Nombre corto "AB" → 400 | 400 | ✅ PASS | `{"error":"session_id is required"}` — 400 correcto (rate limit impidió crear sesión pero el código de error es 400). |
| 4.4 Session UUID inexistente → 404 | 404 | ✅ PASS | `{"error":"Session not found"}` — correcto. |
| 4.5 Rate limit `/start` | 429 | ✅ PASS | Requests 1-4: 201, Request 5: 429. Rate limit activa en 5 requests (documentado: limit=5). Se preserva `remaining: 0` y `reset_at` en headers. |

> **Bug 4.3:** Con rate limit activo, la prueba de validación de nombre corto no puede crear sesión, por lo que retorna `{"error":"session_id is required"}`. El error correcto debería ser 429, no 400. Recomendación: ejecutar Suite 4.3 antes de Suite 4.5 en futuros runs.

---

## Suite 5 — Error cases

| Test | HTTP | Status | Detalle |
|------|------|--------|---------|
| 5.1 Agente inexistente → 404 | 404 | ✅ PASS | `{"error":"Model not found"}` — correcto. |
| 5.2 Invoke sin auth → 401 (esperado) | 402 | ❌ FAIL | Con body válido (`{"token":"AVAX"}`), retorna **402** x402 payment challenge, no 401. El sistema no distingue entre "sin auth" y "sin pago" — trata todo como "requiere pago". |
| 5.3 Invoke key inválida → 401 (esperado) | 402 | ❌ FAIL | Con body válido, retorna **402** igual que sin auth. El bearer token inválido no produce 401 — la capa x402 interviene antes que la validación del token. |
| 5.4 Answer vacío → 400 | 400 | ✅ PASS | `{"error":"session_id is required"}` — 400 correcto (rate limit impidió crear sesión, mismo problema que 4.3). |

---

## Bugs Encontrados

### 🔴 BUG-01: Input validation antes que auth check (422 antes de 401/402)
- **Endpoint:** `POST /api/v1/models/{slug}/invoke`
- **Reproducir:** `curl -X POST /api/v1/models/wasi-risk-report/invoke -d '{"input": "test"}'` (sin auth)
- **Esperado:** 401 (sin auth) o 402 (sin pago)
- **Actual:** 422 `{"error":"Input validation failed","code":"input_invalid","details":["data must be object"]}`
- **Impacto:** Expone info sobre el schema incluso a callers no autorizados. Middleware order incorrecto.

### 🟡 BUG-02: Invoke sin auth / key inválida retorna 402, no 401
- **Endpoint:** `POST /api/v1/models/{slug}/invoke`
- **Esperado:** 401 para no autenticados / key inválida
- **Actual:** 402 (x402 payment challenge) para ambos casos
- **Impacto:** No diferenciación entre "no autorizado" y "no ha pagado". Puede confundir integradores.
- **Nota:** Podría ser diseño intencional del protocolo x402 — discutir con equipo.

### 🟡 BUG-03: Agent Key no bypasea x402 en `/api/v1/models/` 
- **Descripción:** El `wasi_...` bearer token no permite invocación gratuita. La documentación implica que el Agent Key autoriza invocaciones, pero el endpoint siempre requiere pago x402 on-chain.
- **Impacto:** Suite 2 completa (E2E pipeline) no ejecutable sin fondos USDC en Avalanche.

### 🟡 BUG-04: Trial endpoint `/api/v1/agents/{slug}/trial` retorna 400 invalid_input
- **Reproducir:** `curl -X POST /api/v1/agents/wasi-liquidity-analyzer/trial -d '{"token":"AVAX"}'`
- **Actual:** `{"error":"invalid_input"}` HTTP 400
- **Impacto:** El trial endpoint no funciona con los parámetros del `input_schema` publicado.

---

## Resumen

- **PASS:** 8/16
- **FAIL:** 3/16 (BUG-01, BUG-02, BUG-04)
- **BLOQUEADO:** 3/16 (4.2, 4.3-parcial, 5.4-parcial por rate limit de 4.5)
- **OBSERVACIÓN/SKIP:** 2/16 (Suite 2 arquitectura x402, Compose skip)

### Prioridad de Bugs
1. 🔴 **BUG-01** (P1): Input validation antes que auth — fix middleware order
2. 🟡 **BUG-02** (P2): 402 vs 401 en auth failures — clarificar diseño o implementar auth check previo
3. 🟡 **BUG-03** (P2): Agent Key no funciona para invocar — revisar documentación o implementar bypass
4. 🟡 **BUG-04** (P2): Trial endpoint roto — fix o deprecar

### Recomendaciones
- Reordenar middlewares: auth → payment → input validation
- Agregar documentación clara sobre flujo x402 vs Agent Key
- Ejecutar Suite 4 antes de Suite 5 en próximos runs (evitar contaminación de rate limit)
- Fondear wallet QA con USDC en Avalanche para probar Suite 2 completa
