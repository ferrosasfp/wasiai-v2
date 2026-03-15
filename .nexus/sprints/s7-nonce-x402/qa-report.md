# QA Report — S7-03: Nonce x402 en agent_calls

> **Veredicto: ✅ QA PASS**
> Fecha: 2026-03-15
> Commit: `2189aa6f6`
> QA Verifier: NexusAgil v1.3

---

## Fase 1 — Drift Detection

| SDD planificó | Qué se hizo | Drift |
|---|---|---|
| Extraer nonce de `paymentHeader.payload.authorization.nonce` | ✅ Implementado en Route B | Ninguno |
| Añadir parámetro opcional `nonce?: string \| null` a `logCall()` | ✅ Implementado en firma de `logCall` | Ninguno |
| Pasar nonce al `.insert({...})` en `logCall` | ✅ `nonce: nonce ?? null` en insert | Ninguno |
| Return 402 `payment_already_used` en `23505` | ✅ Implementado | Ninguno |
| Scope OUT: NO cambiar firma de forma que rompa Route A | ✅ Parámetro es opcional (nullable) | Ninguno |
| Scope OUT: NO tocar contratos, migración | ✅ Sin cambios fuera del scope | Ninguno |

**Drift detectado: NINGUNO.** La implementación sigue el SDD al pie de la letra.

---

## Fase 2 — Verificación de ACs

### AC1: Invocación x402 válida → `agent_calls.nonce` poblado con EIP-3009 nonce

**CUMPLE** ✅

Evidencia:
- `route.ts:439-441` — Extracción del nonce:
  ```typescript
  const x402Nonce = (paymentHeader?.payload as X402EVMPayload | undefined)
    ?.authorization?.nonce ?? null
  ```
- `route.ts:443` — Pasado a `logCall` como último argumento: `logCall(..., slug, x402Nonce)`
- `route.ts:583` — Parámetro `nonce?: string | null` en firma de `logCall`
- `route.ts:597` — Insertado en DB: `nonce: nonce ?? null`

El nonce se extrae de `payload.authorization.nonce` (EIP-3009) y se persiste en `agent_calls`.

---

### AC2: Invocación vía agent key (Route A) → `nonce` = null (sin regresión)

**CUMPLE** ✅

Evidencia:
- `route.ts:376` (Route A success path): `await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)`
  — No se pasa el parámetro `nonce` → defaults a `undefined` → `nonce ?? null` = `null` en insert.
- `route.ts:380` (Route A error path): `await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)`
  — Igual, sin nonce.
- `route.ts:583` — `nonce?: string | null` es opcional: callers de Route A no lo pasan, Supabase inserta `null`.

Route A no toca el nonce en ningún momento. Sin regresión.

---

### AC3: Dos requests con mismo nonce → segundo retorna 402 `payment_already_used`

**CUMPLE** ✅

Evidencia:
- `route.ts:599-601` — En `logCall`, detección de violación unique:
  ```typescript
  if (insertResult.error && (insertResult.error as { code?: string }).code === '23505') {
    return { error: { code: 'payment_already_used' } }
  }
  ```
- `route.ts:444-449` — En Route B, manejo del error devuelto:
  ```typescript
  if (logResult.error?.code === 'payment_already_used') {
    return NextResponse.json(
      { error: 'payment_already_used', code: 'payment_already_used' },
      { status: 402 },
    )
  }
  ```

El flujo completo: nonce duplicado → Supabase lanza `23505` (unique constraint `idx_agent_calls_nonce_unique`) → `logCall` retorna `{ error: { code: 'payment_already_used' } }` → Route B retorna HTTP 402 con body `{ error: 'payment_already_used' }`.

> **Nota:** La constraint `idx_agent_calls_nonce_unique` fue creada en migración 060 (pre-existente, fuera del scope de este sprint). Su existencia es prerequisito asumido por el SDD.

---

## Fase 3 — Build Verification

```
$ npx tsc --noEmit
(sin output)
```

**✅ Build limpio — cero errores TypeScript.**

---

## Fase 4 — Regression Check

Archivos fuera de scope analizados:

| Archivo | Estado |
|---|---|
| `logCall()` callers en Route A (líneas ~376, ~380) | ✅ Sin cambios, firma compatible |
| `buildResponse()` | ✅ Sin cambios |
| `settleX402()` / `build402Instructions()` | ✅ Sin cambios |
| `callUpstream()` | ✅ Sin cambios |
| `GET` handler | ✅ Sin cambios |

La firma de `logCall` se extendió de forma retrocompatible (parámetro opcional al final). Ningún caller existente se rompe.

---

## Resumen Ejecutivo

| Item | Estado |
|---|---|
| AC1: nonce poblado en x402 | ✅ PASS |
| AC2: nonce null en Route A | ✅ PASS |
| AC3: 402 en replay attack | ✅ PASS |
| Build TypeScript | ✅ PASS (0 errores) |
| Drift vs SDD | ✅ PASS (ninguno) |
| Regresión en callers | ✅ PASS |

---

## ✅ QA PASS

*S7-03 implementado correctamente. Todos los ACs verificados con evidencia concreta. Build limpio. Sin regresiones detectadas.*
