# SDD #258: Invoke — Reemplazar void Promise con after() en fire-and-forget

> SPEC_APPROVED: no
> Fecha: 2026-03-20
> Tipo: improvement
> SDD_MODE: full
> Branch: improvement/258-void-promise-after
> Artefactos: .nexus/sprints/258-void-promise-after/

---

## 1. Resumen

En Vercel serverless, al retornar la respuesta HTTP la función puede ser terminada antes de que los `void Promise.resolve(...)` en background completen. Esto representa riesgo de pérdida silenciosa de datos financieros: receipts de invocación, registros de settlement failures, y contabilidad off-chain de earnings del creator.

`after()` de `next/server` (stable en Next.js 15+, proyecto en v16) garantiza que las operaciones registradas se completen incluso después de enviada la respuesta HTTP, sin impactar TTFB.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 258 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Garantizar ejecución de operaciones background post-response en payment path |
| **Scope IN** | `src/app/api/v1/models/[slug]/invoke/route.ts` — 3 instancias específicas |
| **Scope OUT** | Todo lo demás. No tocar lógica de pago. No triggerAgentEvent. No otros archivos. |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

- **AC1:** WHEN successful Agent Key invocation occurs, THE `receipt_signature` update to `agent_calls` SHALL use `after()` to guarantee execution post-response.
- **AC2:** WHEN x402 payment is settled but upstream fails, THE insert to `settlement_failures` SHALL use `after()` to guarantee execution post-response.
- **AC3:** WHEN successful x402 invocation occurs, THE `increment_pending_earnings` RPC call SHALL use `after()` to guarantee execution post-response.
- **AC4:** WHEN `after()` callbacks are registered, THE HTTP response SHALL be returned to the caller before the callbacks execute (no TTFB impact).
- **AC5:** WHEN any `after()` callback throws or rejects, THE error SHALL be logged preserving the original log level: `logger.warn` para instancia 1 (best-effort), `logger.error` para instancias 2 y 3.
- **AC6:** WHEN settlement_failures `after()` callback executes, BOTH success path (`logger.warn` with `txHash`) AND error path (`logger.error` with `txHash`) SHALL be logged preserving existing log context.
- **AC7:** WHEN the change is applied, THE TypeScript build (`tsc --noEmit`) SHALL pass with zero errors.

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Archivo objetivo | 3 instancias `void Promise.resolve()`, cada una con distinto contexto de logging |

### Las 3 instancias exactas

**Instancia 1 — ~línea 361 (Route A, Agent Key):**
```ts
void Promise.resolve(
  supabase
    .from('agent_calls')
    .update({ receipt_signature: receiptSignature })
    .eq('id', callId)
).catch(err => logger.warn('[invoke] receipt_signature update failed', { err }))
```
Best-effort. Solo log de error, sin log de éxito.

**Instancia 2 — ~línea 506 (Route B, x402 — settlement failure):**
```ts
void Promise.resolve(
  supabase.from('settlement_failures').insert({...})
).then((res) => {
  if (res.error) {
    logger.error('[invoke] settlement_failure insert DB error', { err: res.error.message, txHash: settlement.transactionHash })
  } else {
    logger.warn('[invoke] settlement_failure recorded', { slug, txHash: settlement.transactionHash })
  }
}).catch((err: unknown) => {
  logger.error('[invoke] settlement_failure insert failed', { err: String(err).slice(0, 200), txHash: settlement.transactionHash })
})
```
Logging completo: éxito (warn) y error (error con txHash). DEBE preservarse íntegro.

**Instancia 3 — ~línea 542 (Route B, x402 — earnings):**
```ts
void Promise.resolve(
  supabase.rpc('increment_pending_earnings', {
    p_user_id: model.creator_id as string,
    p_amount:  creatorPrice,
  })
).catch((err: unknown) => logger.error('[invoke] increment_pending_earnings failed', { err }))
```
Solo log de error.

### Imports existentes en el archivo

```ts
import { after } from 'next/server'  // NO existe actualmente — DEBE AGREGARSE
```

El archivo ya importa `NextResponse`, `NextRequest` desde `'next/server'`. Se agrega `after` al mismo import.

---

## 4. Diseño Técnico

### 4.1 Archivos a modificar

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Agregar `after` al import de `next/server` + migrar las 3 instancias | Patrón `after(() => { ... })` de Next.js 15 docs |

### 4.2 Patrón de migración

El patrón es envolver la operación existente dentro de `after()`:

**Antes:**
```ts
void Promise.resolve(operacion).catch(err => logger.error(...))
```

**Después:**
```ts
after(async () => {
  try {
    await operacion
  } catch (err) {
    logger.error(..., { err, slug })
  }
})
```

### 4.3 Cambio por instancia

**Instancia 1 — receipt_signature (best-effort, preservar logger.warn original):**
```ts
after(async () => {
  try {
    await supabase
      .from('agent_calls')
      .update({ receipt_signature: receiptSignature })
      .eq('id', callId)
  } catch (err) {
    // try/catch válido aquí — solo hay excepciones de red/JS, no errores DB-level
    // Preservar logger.warn del código original (no elevar a error)
    logger.warn('[invoke] receipt_signature update failed', { err, slug })
  }
})
```

**Instancia 2 — settlement_failures (logging completo PRESERVADO — patrón Supabase correcto):**

⚠️ Supabase NO lanza excepciones en errores DB — retorna `{ data, error }`. Se requiere chequear `res.error` explícitamente. El patrón `try/catch` puro NO captura errores de DB-level. La lógica correcta:

```ts
after(async () => {
  try {
    const res = await supabase.from('settlement_failures').insert({
      settlement_tx_hash: settlement.transactionHash ?? 'unknown',
      agent_slug: slug,
      amount_usdc: model.price_per_call,
      caller_wallet: null,
      error_reason: (typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? 'upstream_error')).slice(0, 500),
      agent_call_id: callId ?? null,
    })
    // Chequear res.error EXPLÍCITAMENTE — Supabase no lanza en errores DB
    if (res.error) {
      logger.error('[invoke] settlement_failure insert DB error', { err: res.error.message, txHash: settlement.transactionHash, slug })
    } else {
      logger.warn('[invoke] settlement_failure recorded', { slug, txHash: settlement.transactionHash })
    }
  } catch (err: unknown) {
    // Solo captura excepciones de red/JS (no errores DB — esos van por res.error arriba)
    logger.error('[invoke] settlement_failure insert failed', { err: String(err).slice(0, 200), txHash: settlement.transactionHash, slug })
  }
})
```

**Instancia 3 — increment_pending_earnings (nota: RPC también retorna {data, error}):**
```ts
after(async () => {
  try {
    // Nota: supabase.rpc() también retorna {data, error} sin lanzar.
    // El código actual (.catch() solo) tampoco captura errores DB-level.
    // Comportamiento preservado — no es regresión.
    await supabase.rpc('increment_pending_earnings', {
      p_user_id: model.creator_id as string,
      p_amount:  creatorPrice,
    })
  } catch (err: unknown) {
    logger.error('[invoke] increment_pending_earnings failed', { err, slug })
  }
})
```

### 4.4 Import a modificar

Buscar la línea:
```ts
import { NextResponse, NextRequest } from 'next/server'
// o similar
```
Agregar `after`:
```ts
import { NextResponse, NextRequest, after } from 'next/server'
```

### 4.5 Flujo principal (Happy Path)

1. Invoke route procesa pago y upstream call
2. Construye y retorna respuesta HTTP al caller (sin cambio)
3. DESPUÉS de retornar: `after()` ejecuta las 3 operaciones background
4. Vercel garantiza que los callbacks completen antes de cerrar la función

### 4.6 Flujo de error

- Si cualquier `after()` callback lanza → `catch` interno lo maneja con `logger.error`
- La respuesta HTTP ya fue enviada — el error es interno, no afecta al caller
- Los `void triggerAgentEvent()` permanecen sin cambios (best-effort por diseño)

---

## 5. Waves de Implementación

### Wave 0 — Pre-flight
- [ ] W0.1: Verificar que `after` existe en `next/server` con `grep -r "from 'next/server'" src/` y confirmar Next.js >= 15
- [ ] W0.2: Localizar las 3 instancias exactas con `grep -n "void Promise.resolve" src/app/api/v1/models/\[slug\]/invoke/route.ts`
- [ ] W0.3: `tsc --noEmit` pasa en estado actual
- [ ] W0.4: Build gate: confirmar líneas exactas de las 3 instancias

### Wave 1 — Agregar import
- [ ] W1.1: Agregar `after` al import de `next/server` en invoke/route.ts
- [ ] W1.2: Build gate: `tsc --noEmit` pasa (solo el import)

### Wave 2 — Migrar instancias (secuencial, una por una)
- [ ] W2.1: Migrar Instancia 1 (receipt_signature) — patrón: try/catch con logger.warn
- [ ] W2.2: Build gate: `tsc --noEmit` pasa
- [ ] W2.3: Migrar Instancia 2 (settlement_failures) — PRESERVAR logging completo con txHash
- [ ] W2.4: Build gate: `tsc --noEmit` pasa
- [ ] W2.5: Migrar Instancia 3 (increment_pending_earnings) — patrón: try/catch con logger.error
- [ ] W2.6: Build gate: `tsc --noEmit` pasa

### Wave 3 — Verificación final
- [ ] W3.1: Confirmar que `void triggerAgentEvent()` permanece sin cambios (grep)
- [ ] W3.2: Build gate final: `npm run build` o `tsc --noEmit` completo
- [ ] W3.3: Confirmar que no hay otros `void Promise.resolve` en el archivo (grep)

---

## 6. Constraint Directives

### OBLIGATORIO
- Agregar `after` al import existente de `next/server` — no crear un import separado
- Instancia 2: preservar EXACTAMENTE el logging existente (txHash en éxito Y en error)
- Usar `async () => { try { await ... } catch (err) { logger.error(...) } }` como patrón uniforme
- Slug disponible en el contexto — incluirlo en todos los logs de error para trazabilidad

### PROHIBIDO
- NO modificar `void triggerAgentEvent()` calls — son best-effort por diseño (WAS-74)
- NO modificar la lógica de pago principal
- NO modificar ningún otro archivo
- NO simplificar el logging de la Instancia 2 — el logging detallado con txHash es requerido
- NO usar `after` fuera de las 3 instancias identificadas

---

## 7. Rollback

**Antes de implementar:** `git stash` o anotar el commit actual.  
**Si W2 falla parcialmente:** `git checkout -- src/app/api/v1/models/\[slug\]/invoke/route.ts`  
**Post-merge:** `git revert <commit>` — las 3 operaciones vuelven a ser `void Promise.resolve()`. Sin cambio de schema, sin efecto visible al usuario.

---

## 8. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| `after` no disponible en runtime de Vercel | Ninguna | — | Next.js 16 + Vercel soporta after() nativamente |
| Instancia 2: simplificación accidental del logging | Media | Alto | Constraint Directive explícita + build gate post-instancia 2 |
| Variables fuera de scope dentro de after() | Baja | Bajo | Las variables (`supabase`, `model`, `slug`, etc.) están en closure |

---

*SDD generado por NexusAgil — FULL*
