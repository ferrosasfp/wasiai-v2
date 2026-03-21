# Logic Audit — Sprint 254: Transform Layer
**Auditor:** subagent logic-auditor  
**Date:** 2026-03-20  
**Verdict:** ⚠️ REQUIERE CORRECCIÓN (3 findings, ninguno bloquea el pipeline en producción, pero 2 son bugs reales)

---

## AC Traceability Table

| AC | Description | File:Line | Status |
|----|-------------|-----------|--------|
| AC1 | step N>0, pass_output=true, valid input_schema → transform BEFORE validateInput() | route.ts:643-660 | ✅ |
| AC2 | LLM returns invalid JSON → raw fallback, no pipeline break | step-transform.ts:37-47 (inner catch) | ✅ |
| AC3 | No input_schema or non-object schema → raw passthrough | route.ts:647-648 | ✅ |
| AC4 | Pipeline of 3 chained agents completes | route.ts:627-669 (sequential loop) | ✅ |
| AC5 | Provider fails (401/402/429/5xx) → fallback to next | llm.ts:115-122 (isRetryable) | ⚠️ PARCIAL |
| AC6 | ALL providers fail → raw output fallback (fail-open) | step-transform.ts:49-56 (outer catch) | ✅ |
| AC7 | 10s timeout per provider | llm.ts:74 (`AbortSignal.timeout(10_000)`) | ✅ |
| AC8 | Log transform results (provider, latency_ms, fallbackUsed) | step-transform.ts:38-46, 43-47, 49-55 | ⚠️ PARCIAL |

---

## Findings Table

| # | Severity | File | Line | Description |
|---|----------|------|------|-------------|
| F1 | 🔴 MEDIUM | llm.ts | 115 | **5xx coverage gap**: `isRetryable` only checks `500`, `502`, `503` via string inclusion. `504` (Gateway Timeout), `529` (Cloudflare), `507`, `520`-`530` CloudFlare codes are NOT retried — the provider loop throws immediately, bypassing remaining providers. |
| F2 | 🟡 MEDIUM | llm.ts | 115 | **`msg.includes('model')` en retryable**: Cualquier error que contenga la palabra "model" (ej: "Invalid model configuration", "model not found") se trata como retryable. Esto puede enmascarar bugs de configuración del cliente y causar 3 intentos innecesarios antes de fallar. |
| F3 | 🟡 LOW | step-transform.ts | 39 | **`fallbackUsed: false` hardcodeado en éxito**: En el path success, `fallbackUsed` siempre es `false` aunque Cerebras o Together hayan sido el proveedor real. El campo `provider` sí captura el nombre correcto, pero `fallbackUsed` es misleading cuando llm.ts sí logueó un fallback internamente. |
| F4 | 🟢 INFO | route.ts | 643 | **Empty-string lastOutput**: La condición `step.pass_output && lastOutput` es falsy si el step anterior retornó `''`. En ese caso cae al `else` y usa `step.input ?? ''`. Comportamiento probablemente aceptable pero puede ser sorpresivo. |

---

## Detailed Analysis

### F1 — 5xx Coverage Gap (MEDIUM)

```typescript
// llm.ts:115
const isRetryable = msg.includes('401') || msg.includes('402') || msg.includes('429') 
  || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('model')
```

El error que construye `callProvider` es:
```typescript
throw new Error(`${provider.name} API error ${res.status}: ...`)
```

Un 504 generaría: `"groq API error 504: ..."`. El string `'504'` no está en la lista → `isRetryable = false` → `throw` inmediato → Cerebras y Together nunca se intentan.

**Fix sugerido:**
```typescript
// Extraer status del mensaje o verificar rango
const statusMatch = msg.match(/API error (\d{3})/)
const status = statusMatch ? parseInt(statusMatch[1]) : 0
const isRetryable = status === 401 || status === 402 || status === 429 
  || (status >= 500 && status < 600) || msg.includes('model')
```

---

### F2 — `msg.includes('model')` catch-all (MEDIUM)

Errores como `"groq API error 400: model 'llama-99' does not exist"` son retryables por el check `msg.includes('model')`. Esto es semi-intencional (Groq puede no tener el modelo solicitado, Cerebras sí), pero también captura errores estructurales. Riesgo: 3 provider calls innecesarias en casos de config incorrecta.

**Recomendación:** Documentar explícitamente la intención en un comentario, o limitar a errores 4xx específicos de modelo.

---

### F3 — `fallbackUsed` accuracy (LOW)

```typescript
// step-transform.ts:39 — always false on success path
console.warn('[step-transform]', {
  targetSlug,
  provider: response.provider,   // correcto: 'groq'|'cerebras'|'together'
  latency_ms: Date.now() - start,
  fallbackUsed: false,            // ← SIEMPRE false aunque provider !== 'groq'
})
```

`callLLM` sí logea el fallback internamente (llm.ts:109), pero step-transform no puede saberlo a menos que `LLMResult` exponga esa info.

**Fix sugerido:** Agregar `fallbackUsed: boolean` a `LLMResult`:
```typescript
// llm.ts
return { ..., fallbackUsed: errors.length > 0 }

// step-transform.ts
fallbackUsed: response.fallbackUsed ?? false,
```

---

## Critical Checklist Verification

| Check | Result |
|-------|--------|
| 402 is in the retryable list | ✅ `msg.includes('402')` — línea 115 |
| Timeout is 10_000 (not 30_000) | ✅ `AbortSignal.timeout(10_000)` — llm.ts:74 |
| Transform happens BEFORE validateInput() | ✅ route.ts:643-660 (transform en 643-650, validate en 656-668) |
| Type guard on input_schema (typeof === 'object' && !== null) | ✅ route.ts:645 |
| Fail-open: try/catch returns previousOutput on any error | ✅ step-transform.ts:49-56 |
| console.warn logs on all paths (success, invalid JSON, all-fail) | ✅ step-transform.ts:38-55 (3 paths cubiertos) |

---

## Verdict

### ⚠️ REQUIERE CORRECCIÓN

El pipeline funciona correctamente en el happy path y el fail-open está bien implementado. Los ACs críticos (AC1, AC2, AC3, AC6, AC7) están correctamente implementados.

**Sin embargo:**
- **F1** es un bug real: proveedores que retornan 504 no activarán el fallback — el pipeline de transform fallará open (AC6 protege), pero nunca se intentarán Cerebras/Together para esos códigos.
- **F3** hace que los logs de AC8 reporten `fallbackUsed: false` cuando en realidad se usó un fallback — métricas de monitoreo incorrectas.

**Fixes requeridos antes de cerrar sprint:**
1. `llm.ts`: Usar regex para extraer status code y verificar rango `>= 500` en lugar de strings individuales.
2. `LLMResult`: Agregar campo `fallbackUsed: boolean` y propagarlo a step-transform logs.
