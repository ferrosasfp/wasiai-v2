# Spec Review — Sprint Marketplace Health
**Reviewer:** Spec Reviewer (NexusAgil pipeline)
**Date:** 2026-03-23
**Sprint:** sprint-marketplace-health (Sprint A)

---

## Spec Review — SDD #281 (Mutex 429 más claro)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | No existe `retry_after_seconds` ni `hint` en los bloques 429/503 actuales |
| 0.2 Archivos existen | ✅ PASS | `src/app/api/v1/models/[slug]/invoke/route.ts` existe |
| 0.3a Tipos correctos | ✅ PASS | Añadir campos a un `NextResponse.json(...)` object es válido TypeScript, no hay tipos que romper |
| 0.3b Encoding correcto | ✅ PASS | `retry_after_seconds: 5` es `number` — consistente con `Retry-After: '5'` (string) en header |
| 0.4 Dependencias | ✅ PASS | No hay dependencias entre SDDs |
| 0.5 Completitud | ✅ PASS | Sin TODOs ni ambigüedades |

**Código verificado en invoke/route.ts líneas 272-288:**
- Bloque 429 mutex (línea ~273): coincide exactamente con el bloque que el SDD pide reemplazar ✅
- Bloque 503 Redis-unavailable (línea ~281): coincide exactamente ✅
- `grep concurrent_invocation` en `__tests__`: sin resultados — ningún test verifica este string ✅

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ | AC1→Wave1, AC2→Wave1 (Retry-After no cambia), AC3→Wave2 |
| Build gates | ✅ | Ambas waves tienen `npx tsc --noEmit` |
| Rollback | ✅ | `git revert HEAD` es ejecutable, un solo archivo, sin migraciones |
| Constraints | ✅ | 2 PROHIBIDO específicos y suficientes para el scope |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| — | — | Sin hallazgos | — |

### Veredicto
**✅ LISTO — SDD correcto, listo para SPEC_APPROVED**

---

## Spec Review — SDD #276 (Block tunnel domains)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `BLOCKED_TUNNEL_SUFFIXES` no existe en `validateEndpointUrl.ts` |
| 0.2 Archivos existen | ✅ PASS | `src/lib/security/validateEndpointUrl.ts` existe con la estructura asumida |
| 0.3a Tipos correctos | ✅ PASS | `isBlockedHost(hostname: string): boolean` — firma y posición correctas |
| 0.3b Encoding correcto | ✅ PASS | `.toLowerCase()` ya está en `isBlockedHost` — AC2 automático |
| 0.4 Dependencias | ✅ PASS | Sin dependencias |
| 0.5 Completitud | ✅ PASS | Wave 2 tiene rama condicional para el caso no existe |

**Verificaciones adicionales:**
- `grep -r validateEndpoint src/` → 14 call sites identificados. La lista en el SDD (register, invoke, status) es **incompleta** — también lo llaman: `test-endpoint`, `trial`, `introspect`, `health`, `webhooks`, `models/route`, `compose`, `onboard/step`, `jobs/process`, `mcp`, `sandbox/invoke`. El fix se propaga automáticamente a todos sin cambio adicional ✅
- `creator/agents/[slug]/route.ts` línea 79: actualiza `endpoint_url` directo a DB ANTES de llamar `probeEndpoint` (fire-and-forget). NO llama `validateEndpointUrl` antes del UPDATE. El SDD instrucciona al Builder a añadirlo — instrucción clara y necesaria ✅
- Mensaje de error actual: `'Private or internal endpoint URLs are not allowed'`. El SDD cambia a `'Private, internal, or tunnel/development endpoint URLs are not allowed'`. Los tests en `test-endpoint.test.ts` (líneas 152, 168) y `trial.test.ts` (línea 279) usan este string en `mockImplementationOnce()`  — **pero solo para simular el throw**, no como assertion del valor. No se rompen ✅

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ | AC1-AC3 → Wave1 (isBlockedHost), AC4→implícito (no change), AC5→Wave1 (validateEndpointUrlAsync ya llama validateEndpointUrl) |
| Build gates | ✅ | Ambas waves tienen build gate |
| Rollback | ✅ | `git revert HEAD` ejecutable |
| Constraints | ✅ | 3 PROHIBIDO específicos y correctos |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | INFO | SDD lista solo 3 call sites pero hay 14+. El fix propaga automáticamente, no es un bloqueante pero el Builder debe saber que el cambio de mensaje de error afecta el string visible en todos los call sites | Documentar en SDD como "el cambio de mensaje afecta todos los call sites vía propagación automática" |

### Veredicto
**✅ LISTO — SDD correcto, listo para SPEC_APPROVED**

---

## Spec Review — SDD #284 (Upstream HTTP codes)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `buildResponse` siempre pasa sin `status` (hardcoded 200 por default de NextResponse) — fix no existe |
| 0.2 Archivos existen | ✅ PASS | `invoke/route.ts` existe. `callUpstream` está en líneas ~613-665, `buildResponse` en líneas ~718-760 |
| 0.3a Tipos correctos | ⚠️ INCOMPLETO | Ver Finding #1 — Wave 1 pseudocode es solo comentarios |
| 0.4 Dependencias | ✅ PASS | Sin dependencias entre SDDs |
| 0.5 Completitud | ❌ FAIL | Wave 1 contiene pseudocódigo no implementable — ver Findings |

**Verificaciones:**
- `callUpstream` retorno actual: `{ data, status, latencyMs }` — sin `httpStatusHint` ✅ (cambio requerido es correcto)
- `buildResponse` firma actual: 6 params, sin `options` — añadir 7mo param `options?` es correcto ✅
- Route A call site (~línea 412): `buildResponse(model, result, undefined, receiptSignature ?? undefined, {...}, callId ?? undefined)` — añadir 7mo arg no es necesario (default undefined basta) ✅
- Route B call site (~línea 559): `buildResponse(model, result, settlement.transactionHash, undefined, {...}, callId ?? undefined)` — necesita 7mo arg `{ upstreamFailed: result.status === 'error' }` ✅
- `buildResponse` no pasa `status` en `NextResponse.json()` actualmente — siempre retorna 200 implícito ✅

**Problema crítico en Wave 1 — lógica de error type discrimination:**

El catch block actual de `callUpstream`:
```typescript
} catch (err) {
  data = { error: 'Upstream unreachable', detail: String(err) }
  status = 'error'
}
```

El SDD dice (solo como comentarios, sin código):
```
// - AbortError / TimeoutError → httpStatusHint = 504
// - Connection error (TypeError) → httpStatusHint = 502
```

Pero NO provee el código para distinguir los tipos. El Builder necesita saber:
1. `AbortSignal.timeout(10_000)` lanza `DOMException` con `name === 'TimeoutError'` (no 'AbortError') en Node.js 18+ — el SDD dice "AbortError / TimeoutError" sin especificar cuál aplica
2. El error sintético para 5xx es `Error('Upstream HTTP ${res.status}')` — lanzado DENTRO de `wrapWithCircuitBreaker`, llega al catch. El SDD no muestra cómo parsear el status code de este error string para decidir 502 vs 503
3. Para 4xx: NO lanza — llega al bloque POST-`wrapWithCircuitBreaker` con `upstream.ok === false && upstream.status < 500`. El `httpStatusHint = 502` debe setearse AQUÍ, no en el catch. El SDD no muestra este path

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ | AC1-AC4→Wave1+2, AC5→Wave2 (no change path), AC6→Wave2 Route B, AC7→implícito, AC8→excluido explícitamente |
| Build gates | ✅ | Ambas waves tienen build gate |
| Rollback | ✅ | `git revert HEAD`, sin migraciones |
| Constraints | ✅ | 4 PROHIBIDO suficientemente específicos |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | **BLOQUEANTE** | Wave 1 pseudocódigo es solo comentarios sin código implementable. La discriminación de tipos de error en el catch block requiere: (a) detectar `TimeoutError` por `err instanceof DOMException && err.name === 'TimeoutError'`; (b) parsear el status del error sintético `'Upstream HTTP 5xx'`; (c) setear `httpStatusHint = 502` para 4xx FUERA del catch (en el bloque `if (!upstream.ok)`) | Reescribir Wave 1 con código concreto para los 3 paths: 4xx post-wrapper, 5xx-error-string parse, DOMException TimeoutError |
| 2 | MENOR | Wave 2 usa `.../* campos existentes sin cambio */` en `buildResponse` — Builder tiene que copiar manualmente todos los fields existentes. No es un bloqueante (código disponible en el repo) pero genera riesgo de omitir un campo | Copiar los campos existentes completos en el pseudocódigo |

### Veredicto
**❌ NECESITA CORRECCIÓN**
- Finding #1 (BLOQUEANTE): Wave 1 debe proveer código concreto para discriminar tipos de error antes de pasar a Builder

---

## Spec Review — SDD #277 (Health check pre-activation)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `probeEndpointSync` no existe en `health-probe.ts`. `status/route.ts` no llama ningún probe en activación |
| 0.2 Archivos existen | ✅ PASS | `src/lib/agents/health-probe.ts` y `src/app/api/creator/agents/[slug]/status/route.ts` existen |
| 0.3a Tipos correctos | ❌ FAIL | Ver Finding #1 — `start` no declarado en pseudocódigo de `probeEndpointSync` |
| 0.4 Dependencias | ✅ PASS | Sin dependencias de otros SDDs |
| 0.5 Completitud | ❌ FAIL | Pseudocódigo de Wave 1 tiene múltiples placeholders no implementables |

**Verificaciones:**

- `probeEndpoint` en `health-probe.ts`: usa `'draft'` en 2 lugares exactamente como dice el SDD:
  - Línea ~88: bloque 5xx → `updateAgentHealth(..., 'draft', ...)` ✅
  - Línea ~103: error handler (timeout + connection) → `updateAgentHealth(..., 'draft', ...)` ✅
- `status/route.ts` selección inicial: `.select('id, creator_id, status, registration_type')` — NO incluye `endpoint_url`. El SDD hace un segundo select para `endpoint_url` — esto es correcto pero implica 2 queries. Alternativa: añadir `endpoint_url` al select inicial. No es bloqueante pero es una optimización obvia ✅
- `status/route.ts` estructura PATCH: el `serviceClient.from('agents').update(updatePayload).eq('id', existing.id)` está en línea ~81. El SDD instruye insertar el probe check ANTES de este update — posición correcta identificada ✅
- `HealthCheckResult` no está exportada — `probeEndpointSync` en el mismo archivo la puede usar sin export. OK ✅
- `ProbeStatus` type actual: `'active' | 'reviewing' | 'draft'` — mantenerlo para compatibilidad es correcto ✅

**Problema crítico en Wave 1b pseudocódigo de `probeEndpointSync`:**

```typescript
// PROBLEMA 1: `start` no declarado — TypeScript strict falla
const latency_ms = Date.now() - start  // ← start no definido en ningún lugar del scope visible

// PROBLEMA 2: options object sin implementar
const options = { /* mismas opciones que probeEndpoint */ }  // ← no implementable

// PROBLEMA 3: resolve() duplicado al final del callback
    if (res.statusCode && res.statusCode >= 200 ...) {
      resolve({ passed: true, ... })
    } else {
      resolve({ passed: false, ... })
    }
  resolve(/* ... */)  // ← segunda llamada a resolve con placeholder vacío — ¿error o intención?
```

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ | AC1→Wave2, AC2→Wave2, AC3→Wave2+Wave1, AC4→Wave2, AC5→Wave2 (if-guard), AC6→Wave1 (draft→reviewing) |
| Build gates | ✅ | Las 3 waves tienen build gate |
| Rollback | ✅ | `git revert HEAD`, sin migraciones (`health_check`, `last_checked_at` ya existen según SDD) |
| Constraints | ✅ | 5 PROHIBIDO/OBLIGATORIO específicos |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | **BLOQUEANTE** | `probeEndpointSync` pseudocódigo usa `start` sin declarar. En `probeEndpoint` el `const start = Date.now()` está declarado ANTES del `new Promise(...)`. El SDD omite esta línea en `probeEndpointSync`. Con TypeScript strict, `Date.now() - start` es `ReferenceError` en compilación | Añadir `const start = Date.now()` antes de `new Promise(...)` en el pseudocódigo de Wave 1b |
| 2 | **BLOQUEANTE** | `options` en Wave 1b está como `{ /* mismas opciones que probeEndpoint */ }` — el Builder debe copiar manualmente el objeto options de `probeEndpoint` (host, port, path, method, headers, servername). Sin esto el pseudocódigo no compila | Copiar el bloque `options` completo de `probeEndpoint` en el pseudocódigo |
| 3 | MENOR | `resolve(/* ... */)` al final del callback `res` es un placeholder vacío después de ya haber llamado `resolve()` en todos los branches. Si el Builder lo copia, TypeScript no falla (llamar resolve 2 veces es inofensivo en JS) pero es código muerto confuso | Eliminar la línea `resolve(/* ... */)` del pseudocódigo |
| 4 | INFO | El segundo SELECT para `endpoint_url` en Wave 2 puede evitarse añadiendo `endpoint_url` al select inicial de `status/route.ts` línea 55. No es bloqueante | Optimización opcional — no cambia la correctitud |

### Veredicto
**❌ NECESITA CORRECCIÓN**
- Finding #1 (BLOQUEANTE): Añadir `const start = Date.now()` en pseudocódigo de `probeEndpointSync`
- Finding #2 (BLOQUEANTE): Copiar bloque `options` completo en pseudocódigo de Wave 1b

---

## Resumen Ejecutivo

| SDD | Veredicto | Bloqueantes |
|-----|-----------|-------------|
| #281 — Mutex 429 más claro | ✅ LISTO | — |
| #276 — Block tunnel domains | ✅ LISTO | — |
| #284 — Upstream HTTP codes | ❌ NECESITA CORRECCIÓN | Wave 1: lógica de error-type discrimination es pseudocódigo sin código real |
| #277 — Health check pre-activation | ❌ NECESITA CORRECCIÓN | Wave 1b: `start` no declarado; `options` object vacío |

**SDDs listos para Builder: #281, #276**
**SDDs que requieren revisión del SM antes de Builder: #284, #277**
