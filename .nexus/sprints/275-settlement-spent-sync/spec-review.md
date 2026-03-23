# Spec Review — SDD #095 (WAS-275)

> Reviewer: Spec Reviewer subagent  
> Fecha: 2026-03-22  
> Branch: fix/275-settlement-spent-sync

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 — Fix ya existe | ✅ NO EXISTE | `sync_key_after_settlement` no encontrado en codebase. Bug confirmado en route.ts líneas ~204-215. Fix pendiente. |
| 0.2 — Archivos referenciados existen | ✅ TODOS EXISTEN | Los 5 archivos fuente y ambas rutas destino (`075_sync_key_after_settlement.sql`, `route.ts`) son válidos. Última migración = `074_defi_chat_collection.sql` → 075 es el número correcto. |
| 0.3a — Código de referencia compila | ⚠️ ISSUE MEDIO | Ver Finding #1: Wave 2 pseudocode no hace error-check del RPC call (Supabase no lanza excepción automáticamente). |
| 0.3b — Columnas DB correctas | ✅ OK | `budget_usdc`, `spent_usdc`, `is_active` en `agent_keys` confirmados. `amount_paid` en `agent_calls` confirmado (usado en route). `balance_synced_at` agregado en migración 064. |
| 0.3d — DB Security | ⚠️ ISSUE LEVE | Ver Finding #2: Ausencia de `is_active` guard en la nueva función no está documentada como decisión consciente. |
| 0.3d — SECURITY DEFINER | ✅ OK | SDD especifica SECURITY DEFINER + REVOKE FROM PUBLIC + GRANT a service_role. Patrón tomado de 045/048. |
| 0.3d — SQL Injection | ✅ OK | Todos los parámetros tipados (UUID, UUID[], NUMERIC). |
| 0.3d — RLS bypass justificado | ✅ OK | Llamado exclusivamente desde admin route con service_role. |
| 0.4 — Dependencias SDDs | ✅ OK | No depende de otros SDDs pendientes. |
| 0.5 — SDD completo | ✅ OK | Sin TODOs ni placeholders. AC definidos, waves con build gates, rollback ejecutable. |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| Cada AC tiene wave | ✅ | AC-1→8: Wave 1 (SQL). AC-9: Wave 1 (GREATEST + RAISE NOTICE). AC-10: Wave 1 (REVOKE/GRANT). |
| Waves sin AC correspondiente | ✅ | W0.x son pre-flight, no requieren AC propios. W2 deriva de AC-1/2/4/5/7/8. |
| Cada wave tiene build gate | ✅ | W1: `supabase db reset`. W2: `npx tsc --noEmit`. |
| Rollback ejecutable | ✅ | Revertir commit route → RPC inerte (no se llama). Sin cambios de schema. |
| Mínimo 3 PROHIBIDO | ✅ | 5 directivas PROHIBIDO definidas. |
| ACs huérfanos | ✅ NINGUNO | AC-3 (batch trimmed) cubierto implícitamente por Wave 2 (caller pasa `batchCallIds` ya recortado). AC-6 (no modificar RPCs existentes) es constraint, no wave, OK. |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🔴 ALTO | **Wave 2: RPC error silencioso.** El pseudocode en Wave 2 hace `await supabase.rpc('sync_key_after_settlement', {...})` sin destructuring ni error-check. Supabase client **no lanza excepción** en errores de RPC — devuelve `{ data, error }`. Si el RPC falla (e.g., constraint violation, DB unreachable), el código continúa al `balance_synced_at` update sin detectar el fallo. AC-4 queda violado (spent_usdc no fue modificado, pero el caller no lo sabe). | Cambiar pseudocode a: `const { error: rpcErr } = await supabase.rpc(...)` seguido de `if (rpcErr) throw rpcErr`. Esto hace que el catch externo absorba el fallo correctamente. |
| 2 | 🟡 MEDIO | **is_active guard no documentada.** Las funciones `deduct_key_balance` y `refund_key_balance` ambas tienen `AND is_active = true`. El SDD no menciona si `sync_key_after_settlement` debe incluir este guard. Si se omite (UPDATE afecta keys inactivas), el comportamiento difiere de los RPCs hermanos y puede ser inesperado. Si se incluye, un key desactivado post-settlement nunca sincronizará, dejando datos inconsistentes. | Documentar decisión explícita en el SDD (Constraint Directives). Recomendado: **omitir el guard** para este RPC porque el sync debe ocurrir independientemente del estado activo/inactivo (es operación admin). Agregar comentario en la migración explicando la decisión. |
| 3 | 🟡 MEDIO | **RETURNS void vs. señal de error.** La función retorna `void`. Si `p_key_id` no existe en `agent_keys`, el UPDATE afecta 0 filas silenciosamente. Esto es inconsistente con `increment_key_budget` que hace `RAISE EXCEPTION` on NOT FOUND. Si el Builder omite el guard `is_active` y un key_id inválido se pasa, el RPC no reporta nada. | Añadir al SDD: después del UPDATE, `GET DIAGNOSTICS rows_affected = ROW_COUNT; IF rows_affected = 0 THEN RAISE WARNING 'sync_key_after_settlement: no rows updated for key_id %', p_key_id; END IF;`. No bloquear (no EXCEPTION) — el settlement ya ocurrió on-chain. |
| 4 | 🟢 BAJO | **settled_amount NULL cuando p_call_ids vacío.** `SUM(amount_paid) FROM agent_calls WHERE id = ANY(p_call_ids)` con array vacío devuelve `NULL` (no 0). La operación `GREATEST(0, spent_usdc - NULL)` resulta en `NULL`, corrompiendo `spent_usdc`. El SDD en la sección de Riesgos dice "SUM de array vacío = 0" — esto es **incorrecto**. | En el SQL usar `COALESCE(SUM(amount_paid), 0)` para garantizar que `settled_amount` nunca sea NULL. Corregir también el texto de Riesgos del SDD. |
| 5 | 🟢 BAJO | **Wave 2: balance_synced_at usa .eq diferente.** El código actual hace `.eq('key_hash', keyRow.key_hash)`. El pseudocode del SDD propone `.eq('id', keyId)`. Ambos son válidos, pero el Builder debe usar `id` (PK) como dice el SDD, no replicar el patrón actual. La inconsistencia puede confundir. | No es un bug del SDD — el SDD mejora el patrón existente. Solo documentar explícitamente en Wave 2 que se cambia de `key_hash` a `id` como punto de atención para el Builder. |

---

## Trazabilidad AC → Wave

| AC | Wave | Estado |
|----|------|--------|
| AC-1: spent_usdc reducido por SUM(amount_paid) de batchCallIds | W1 (RPC) + W2 (caller pasa batchCallIds) | ✅ |
| AC-2: postcondición matemática exacta | W1 (RPC) | ✅ |
| AC-3: batch parcial → solo settled amount | W2 (caller pasa batchCallIds recortado) | ✅ |
| AC-4: sync falla → spent_usdc NO modificado | W2 (try/catch) | ⚠️ Bloqueado por Finding #1 |
| AC-5: no idempotente, caller no llama 2x | W2 (documentado, settlement admin-triggered) | ✅ |
| AC-6: deduct/increment/refund no modificados | PROHIBIDO directive | ✅ |
| AC-7: firma RPC (UUID, UUID[], NUMERIC) | W1 | ✅ |
| AC-8: budget_usdc y spent_usdc en mismo UPDATE | W1 | ✅ |
| AC-9: GREATEST(0,...) + RAISE NOTICE | W1 | ✅ |
| AC-10: REVOKE FROM PUBLIC + GRANT service_role | W1 | ✅ |

---

## Veredicto

### ⛔ NECESITA CORRECCIÓN

**Bloqueantes antes de Builder:**

1. **Finding #1 (ALTO)** — Añadir `const { error: rpcErr } = await supabase.rpc(...)` + `if (rpcErr) throw rpcErr` en el pseudocode de Wave 2. Sin esto, AC-4 está técnicamente violado.
2. **Finding #4 (BAJO pero riesgo real)** — Cambiar `SUM(...)` a `COALESCE(SUM(...), 0)` en el SQL del RPC. El SDD afirma incorrectamente que SUM de array vacío = 0 en PostgreSQL.

**No bloqueantes (can proceed con nota al Builder):**

3. Finding #2: Documentar decisión sobre `is_active` guard.
4. Finding #3: Agregar RAISE WARNING para 0 rows.
5. Finding #5: Anotación para el Builder sobre cambio `key_hash` → `id`.

**Correcciones mínimas requeridas en el SDD antes de pasar al Builder:** Findings #1 y #4.
