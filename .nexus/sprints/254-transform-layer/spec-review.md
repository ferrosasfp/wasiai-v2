# Spec Review — SDD #254 Transform Layer LLM
**Reviewer:** Spec Reviewer subagent  
**Date:** 2026-03-20  
**SDD:** `.nexus/sprints/254-transform-layer/sdd.md`  
**Verdict:** ⚠️ NECESITA CORRECCIÓN (1 crítico, 2 menores)

---

## Wave 0 — Pre-flight Results

| Check | Result | Evidence |
|-------|--------|----------|
| 0.1 — Fix ya implementado? | ✅ NO implementado | `grep` de `transformStepOutput`, `callLLM`, `step-transform` en `src/` → 0 resultados. El trabajo está pendiente. |
| 0.2 — Archivos referenciados existen? | ✅ TODOS existen | `src/lib/agents/groq.ts` ✅, `src/app/api/v1/compose/route.ts` ✅, `src/lib/env.ts` ✅, `wasiai-agents/src/shared/lib/agents/llm.ts` ✅ |
| 0.3a — Tipos compilan? | ✅ OK con nota | `callLLM` returns `LLMResult { result, model, provider, usage }`. Wave 3 usa `response.result` y `response.provider` — ambos existen en `LLMResult`. Cast `as Record<string, unknown>` en Wave 4 es correcto dado `input_schema: unknown \| null`. |
| 0.3b — API types match? | ✅ OK — sin colisión | `groq.ts` (`GroqResponse`) no es modificado. `llm.ts` exporta `LLMResult` y alias `callGroq = callLLM`. No hay conflicto porque `step-transform.ts` importa de `@/lib/agents/llm`, no de `groq.ts`. Código existente que importa `groq.ts` no se rompe. |
| 0.4 — Dependencias entre SDDs? | ✅ Ninguna | SDD #254 no depende de otros SDDs abiertos. |
| 0.5 — SDD completo, sin TODOs? | ⚠️ 1 ambigüedad | AC2 dice "no rompe el pipeline" pero raw fallback puede fallar el `validateInput()` existente → 422. El SDD no resuelve esta tensión. Ver F3. |

---

## Coherence Checks

| Check | Result | Notes |
|-------|--------|-------|
| AC → Wave traceability | ✅ | AC1→W4, AC2→W3, AC3→W4, AC4→W4, AC5→W1, AC6→W3, AC7→W1, AC8→W3 |
| Build gates en cada wave | ✅ | Waves 1,2,3,4 tienen `tsc --noEmit` |
| Rollback ejecutable | ✅ | 3 pasos concretos: delete 2 files, revert 2 files, remove env vars |
| PROHIBIDO específicos (≥3) | ✅ | 5 PROHIBIDO listados: no charge user, no tocar pipelineCtx, no modificar groq.ts, no modificar validateInput, no cambiar other compose behavior |

---

## Findings

### 🔴 F1 — CRÍTICO: 402 no está en `isRetryable` del reference implementation

**Severidad:** Crítico  
**Impacto:** AC5 y constraint OBLIGATORIO "401 AND 402 must be retryable" no se cumplirán

**Evidencia:**  
En `wasiai-agents/src/shared/lib/agents/llm.ts` línea 115:
```ts
const isRetryable = msg.includes('429') || msg.includes('401') || msg.includes('500') || 
                    msg.includes('502') || msg.includes('503') || msg.includes('model')
```
El código de error **402** (Together AI: billing) **NO está incluido**. El SDD instruye al Builder a "port from `wasiai-agents/src/shared/lib/agents/llm.ts`" — si el Builder porta literalmente, heredará este bug y Together AI nunca hará fallback cuando devuelva 402.

**Fix requerido en SDD:**  
Agregar instrucción explícita en Wave 1 (paso 4):
> `Retryable errors: 401, 402, 429, 500, 502, 503. NOTA: el reference implementation omite 402 — agregarlo explícitamente. isRetryable debe incluir msg.includes('402').`

---

### 🟡 F2 — MENOR: AC8 logging incompleto en fallback paths

**Severidad:** Menor  
**Impacto:** AC8 ("loguear por cada transform: provider usado, latency_ms, si hubo fallback") no se cumple en los paths de error

**Evidencia:**  
Wave 3 tiene dos paths de fallback:
- Item 8 (all-providers-fail): `console.warn('[step-transform] all providers failed, using raw output', error.message)` — no incluye `latency_ms`
- Item 7 (JSON parse fail): `log warning` sin datos estructurados — falta `{ targetSlug, provider, latency_ms, fallbackUsed: true }`

Solo el path de éxito (item 9) tiene logging estructurado completo.

**Fix requerido en SDD:**  
Especificar formato de log para ambos fallback paths en Wave 3:
```ts
// JSON parse fallback (item 7):
console.warn('[step-transform] invalid JSON from LLM, using raw output', { targetSlug, provider: response.provider, latency_ms: Date.now() - start, fallbackUsed: true })

// All-providers-fail fallback (item 8):
console.warn('[step-transform] all providers failed, using raw output', { targetSlug, latency_ms: Date.now() - start, fallbackUsed: true, error: error.message })
```

---

### 🟡 F3 — MENOR: AC2 ambiguo — "no rompe pipeline" vs validateInput 422

**Severidad:** Menor (aclaración, no bug)  
**Impacto:** El Builder puede interpretar que debe bypassear validateInput si hubo raw fallback — lo cual violaría el PROHIBIDO

**Evidencia:**  
AC2: "the system shall usar el output raw como fallback (no rompe el pipeline)"  
Pero si el raw output no conforma al `input_schema`, el `validateInput()` existente retorna 422, que sí "rompe" el pipeline desde la perspectiva del usuario.

El PROHIBIDO dice "no modificar el validateInput() block" — por lo tanto 422 sigue siendo posible.

**Fix requerido en SDD:**  
Clarificar AC2 con nota:
> "No rompe el pipeline" significa que el transform layer en sí no lanza excepción. Si el raw output falla validateInput, el comportamiento 422 pre-existente aplica normalmente. El transform no tiene responsabilidad sobre la validación.

---

### ℹ️ F4 — INFO: Timeout diverge entre reference (30s) y SDD (10s)

**Severidad:** Informativo  
**Impacto:** Ninguno si el Builder sigue el SDD (que es correcto)

**Evidencia:**  
Reference `llm.ts`: `AbortSignal.timeout(30_000)`  
SDD Wave 1 paso 5: `AbortSignal.timeout(10_000)` (AC7)

El SDD está correcto y es más restrictivo. Solo asegurarse de que el Builder use el valor del SDD, no el del reference.

---

## Summary

| # | Severidad | Descripción | Acción |
|---|-----------|-------------|--------|
| F1 | 🔴 Crítico | 402 no retryable en reference → Builder hereda bug | Agregar `msg.includes('402')` explícitamente en Wave 1 paso 4 |
| F2 | 🟡 Menor | AC8 logging incompleto en fallback paths | Especificar formato de log estructurado para items 7 y 8 de Wave 3 |
| F3 | 🟡 Menor | AC2 ambiguo sobre validateInput 422 | Agregar nota aclaratoria en AC2 |
| F4 | ℹ️ Info | Timeout diverge reference vs SDD | No action needed — SDD overrides |

---

## Verdict

**⚠️ NECESITA CORRECCIÓN**

El SDD es sólido en estructura, coherencia y fail-open design. Sin embargo, **F1 es un bug certero** que el Builder heredará si porta literalmente el reference — Together AI (el único provider activo con 402 billing) nunca hará fallback correcto. Requiere corrección antes de pasar al Builder.

F2 y F3 son mejoras menores de calidad pero no bloquean la implementación si el Builder es cuidadoso.

**Mínimo para aprobar:** Corregir F1 en Wave 1 paso 4.
