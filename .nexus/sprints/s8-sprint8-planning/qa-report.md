# QA Report — Sprint 8
> Generado: 2026-03-15 | Verifier: NexusAgil QA v1.3
> TSC: `npx tsc --noEmit` → **PASS** (sin output)

---

## SDD #073 — WAS-182: Agentes DeFi precios + badge featured
**Commit:** `1b0638bb3`

| AC | Descripción | Estado | Evidencia |
|----|-------------|--------|-----------|
| AC1 | Migración actualiza precios y is_featured=true en 5 slugs | ✅ CUMPLE | `supabase/migrations/061_defi_agents_prices.sql:1-9` — 5 UPDATE statements con precios correctos ($0.010/$0.020/$0.050/$0.100/$0.200) e `is_featured = true` |
| AC2 | Página /models/[slug] muestra badge "WasiAI Official" si is_featured=true | ✅ CUMPLE | `src/app/[locale]/models/[slug]/page.tsx:83-84` — `{model.is_featured && (<span ...>WasiAI Official</span>)}` |
| AC3 | SQL completa sin error aunque slugs no existan en DB | ✅ CUMPLE | `supabase/migrations/061_defi_agents_prices.sql:3-7` — Uses plain `UPDATE` (no INSERT/UPSERT), UPDATE on non-existent rows returns 0 rows affected without error |

**Veredicto SDD #073: ✅ QA PASS**

---

## SDD #074 — WAS-204: Compose retry — persistir step outputs paralelos
**Commit:** `865094ad6`

| AC | Descripción | Estado | Evidencia |
|----|-------------|--------|-----------|
| AC1 | Grupo paralelo con ≥1 step exitoso llama append_step_output por cada fulfilled (best-effort) | ✅ CUMPLE | `src/app/api/v1/compose/route.ts:703-710` — `supabase.rpc('append_step_output', {...}).then(undefined, () => undefined)` dentro del loop sobre groupResults fulfilled |
| AC2 | retry con start_from_step:N recupera retryLastOutput del step N-1 | ✅ CUMPLE | Habilitado por AC1; outputs paralelos ahora se persisten en step_outputs, disponibles para retry lookup |
| AC3 | Si append_step_output falla, pipeline continúa sin error (fire-and-forget) | ✅ CUMPLE | `src/app/api/v1/compose/route.ts:707` — `.then(undefined, () => undefined)` — no await, error silenciado |

**Veredicto SDD #074: ✅ QA PASS**

---

## SDD #075 — WAS-189: Dispute Resolution
**Commit:** `e299ab0d7`

| AC | Descripción | Estado | Evidencia |
|----|-------------|--------|-----------|
| AC1 | invoke response incluye meta.call_id con UUID del agent_call | ✅ CUMPLE | `src/app/api/v1/models/[slug]/invoke/route.ts:709` — `call_id: callId ?? undefined` en buildResponse. Route A captura: línea 342 (éxito) y 386 (error). Route B: línea 483. |
| AC2 | POST /api/v1/calls/:call_id/dispute con key válida y call propia → 201 + dispute_id | ✅ CUMPLE | `src/app/api/v1/calls/[call_id]/dispute/route.ts:96-103` — insert + return `{dispute_id, status: 'open', message}` con status 201 |
| AC3 | Call no pertenece a key → 403 | ✅ CUMPLE | `src/app/api/v1/calls/[call_id]/dispute/route.ts:79-83` — `if (agentCall.key_id !== keyRow.id)` → 403 |
| AC4 | Segundo dispute sobre mismo call_id → 409 | ✅ CUMPLE | `src/app/api/v1/calls/[call_id]/dispute/route.ts:88-97` — unique constraint 23505 → 409 `dispute_already_exists` |
| AC5 | reason inválida → 422 | ✅ CUMPLE | `src/app/api/v1/calls/[call_id]/dispute/route.ts:49-57` — VALID_REASONS check → 422 con `invalid_reason` |
| AC6 | PATCH /api/admin/disputes/:id actualiza status, resolution_note, resolved_at | ✅ CUMPLE | `src/app/api/admin/disputes/[id]/route.ts:47-52` — UPDATE con `{status, resolution_note, resolved_at: new Date().toISOString()}` |
| AC7 | Tab "Disputes" en dashboard creador lista disputes de sus agentes | ✅ CUMPLE | `src/app/[locale]/creator/dashboard/page.tsx:121-130` (fetch), `:330-357` (render tab "Disputes" con call_id, reason, status, created_at) |

**Veredicto SDD #075: ✅ QA PASS**

---

## SDD #076 — BUG-03: memory_diffs filter hardcoded keys
**Commit:** `bf173c2d0`

| AC | Descripción | Estado | Evidencia |
|----|-------------|--------|-----------|
| AC1 | upstream devuelve memory_diffs sin keys 'delta'/'diff' → COB los incluye | ✅ CUMPLE | `src/lib/introspect/buildCOB.ts:55-60` — No `.filter()` en el path shallow/mid; solo `.slice()`. El `.filter()` fue eliminado. |
| AC2 | >20 diffs en modo mid → exactamente 20 | ✅ CUMPLE | `src/lib/introspect/buildCOB.ts:59` — `.slice(0, opts.depth === 'mid' ? 20 : 10)` |
| AC3 | >10 diffs en modo shallow/full → exactamente 10 | ⚠️ PARCIAL | `src/lib/introspect/buildCOB.ts:55-60` — shallow: `.slice(0, 10)` ✅. **full**: `memoryDiffs = raw` sin slice — retorna TODOS los diffs sin límite. AC3 dice full→10 pero el código devuelve raw completo para full depth. |

**Observación AC3:** El AC especifica explícitamente que el modo `full` debe limitar a 10. Sin embargo, el código en línea 55-57 devuelve `raw` sin slice para `full`. Esto viola el AC tal como está escrito. Si la intención real del SDD era que `full` no tuviera límite (devuelve todo), el AC está mal redactado y habría que aclarar con el autor.

**Veredicto SDD #076: ⚠️ QA FAIL (AC3 incumplido para modo `full`)**

---

## SDD #077 — Docs: corregir input serializado
**Commit:** `868aee249`

| AC | Descripción | Estado | Evidencia |
|----|-------------|--------|-----------|
| AC1 | Ejemplo sdk-node: input como objeto JSON (no string) | ✅ CUMPLE | `src/features/docs/content/sdk-node.tsx:32` — `input: {` (objeto); `sdk-node.tsx:76` — `input: { token_name: 'AVAX', token_symbol: 'AVAX' }` |
| AC2 | Ejemplo compose: pipeline funciona sin input_validation_failed | ✅ CUMPLE | `src/features/docs/content/compose.tsx:13,17,39,44` — Las 4 ocurrencias usan `"input": { ... }` (objeto directo, sin JSON.stringify) |

**Adicional verificado:** `src/features/docs/content/agent-keys.tsx:44` — `input: { token_name: 'AVAX', token_symbol: 'AVAX' }` ✅

**Veredicto SDD #077: ✅ QA PASS**

---

## Resultado TSC

```
npx tsc --noEmit → sin errores (output vacío)
```

**TSC: ✅ PASS**

---

## VEREDICTO GLOBAL

| SDD | Ticket | Estado |
|-----|--------|--------|
| #073 | WAS-182 | ✅ PASS |
| #074 | WAS-204 | ✅ PASS |
| #075 | WAS-189 | ✅ PASS |
| #076 | BUG-03 | ⚠️ FAIL |
| #077 | Docs fix | ✅ PASS |

## 🔴 QA FAIL

**Blocker:** SDD #076 AC3 — modo `full` en `buildCOB.ts` no aplica el límite de 10 diffs. El código devuelve `raw` sin slice para `depth === 'full'`, mientras que el AC especifica exactamente 10. 

**Acción requerida:** Clarificar con el autor del SDD #076 si el límite aplica a `full` o si el AC está mal redactado. Si aplica → fix en `src/lib/introspect/buildCOB.ts:55`: cambiar `memoryDiffs = raw` por `memoryDiffs = raw.slice(0, 10)`.

---

## Amendment — SDD #076 AC3 (2026-03-15)

**Decisión PO:** `full` depth NO tiene límite de diffs — comportamiento intencional.
AC3 redactado incorrectamente en el SDD. Corregido: AC3 aplica solo a `shallow`; nuevo AC4 documenta que `full` devuelve todo sin límite.

**#076 → QA PASS**

**Veredicto global actualizado: ✅ QA PASS — 5/5 SDDs aprobados**
