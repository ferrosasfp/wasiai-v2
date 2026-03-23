# QA Report — WAS-275: sync spent_usdc post-settlement
**Sprint:** 275-settlement-spent-sync  
**Verifier:** qa-verifier-275 subagent  
**Date:** 2026-03-22  
**Commit:** 6872b0308

---

## Fase 1 — Drift Detection

| Archivo | Esperado | Estado |
|---|---|---|
| `supabase/migrations/075_sync_key_after_settlement.sql` | CREADO | ✅ Existe |
| `src/app/api/admin/settlement/route.ts` | MODIFICADO | ✅ Modificado |
| Archivos fuera de scope | 0 | ✅ OK |

**RESULTADO: NO DRIFT**

---

## Fase 2 — Verificación de ACs

### AC-1: WHEN settlement batch completes, spent_usdc reduced by SUM(amount_paid) of batchCallIds
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:21-24`: `SELECT COALESCE(SUM(amount_paid), 0) INTO v_settled_amount FROM agent_calls WHERE id = ANY(p_call_ids)`
- `075_sync_key_after_settlement.sql:34`: `spent_usdc = GREATEST(0, spent_usdc - v_settled_amount)` en el UPDATE

### AC-2: Postcondition: spent_usdc_new = spent_usdc_old - settled_amount
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:27`: `v_new_spent := GREATEST(0, v_old_spent - v_settled_amount)` (variable calculada)
- `075_sync_key_after_settlement.sql:34`: UPDATE aplica la misma lógica

### AC-3: Partial settlement only reduces by actually settled amount
**✅ CUMPLE**  
- `route.ts:152-163`: El batch se recorta (`batchCallIds = callIds.slice(0, end)`) antes de llamar on-chain
- El RPC recibe sólo `batchCallIds` (los efectivamente liquidados), por lo que SUM(amount_paid) es sólo de los liquidados
- `route.ts:175`: `p_call_ids: batchCallIds` — se pasan los IDs reales del batch, no todos

### AC-4: If sync fails, spent_usdc NOT modified
**✅ CUMPLE**  
- `route.ts:168-178`: El RPC se llama dentro de `try/catch`. Si falla, se captura el error con `logger.warn` y continúa sin modificar spent_usdc
- El UPDATE de `agent_calls.settled_at` ya ocurrió (línea 164), pero `spent_usdc` no se toca si el RPC falla

### AC-5: Not idempotent, caller guards
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql` no tiene lógica de idempotencia (no verifica si ya fue ejecutado)
- El caller guarda: `route.ts:100`: `.is('settled_at', null)` filtra sólo calls no liquidadas — evita doble procesamiento antes de llamar al RPC

### AC-6: deduct_key_balance and increment_key_budget NOT modified
**✅ CUMPLE** (ver Fase 4)  
- Archivos `017_pipeline_executions.sql` y `013_increment_key_budget.sql` sin cambios en últimos commits

### AC-7: RPC accepts (p_key_id UUID, p_call_ids UUID[], p_new_budget NUMERIC), computes internally
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:3-6`:
  ```sql
  CREATE OR REPLACE FUNCTION sync_key_after_settlement(
    p_key_id    UUID,
    p_call_ids  UUID[],
    p_new_budget NUMERIC
  )
  ```
- `v_settled_amount` se computa internamente (línea 21-24), no se recibe como parámetro

### AC-8: budget_usdc SET and spent_usdc reduction in same UPDATE
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:32-36`:
  ```sql
  UPDATE agent_keys
     SET budget_usdc       = p_new_budget,
         spent_usdc        = GREATEST(0, spent_usdc - v_settled_amount),
         balance_synced_at = now()
   WHERE id = p_key_id AND is_active = true;
  ```
  Ambos en el mismo UPDATE.

### AC-9: spent_usdc >= 0, GREATEST(0,...), RAISE WARNING on clamping
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:27`: `v_new_spent := GREATEST(0, v_old_spent - v_settled_amount)`
- `075_sync_key_after_settlement.sql:29-31`: 
  ```sql
  IF v_new_spent = 0 AND (v_old_spent - v_settled_amount) < 0 THEN
    RAISE WARNING 'sync_key_after_settlement: clamping applied for key %', p_key_id;
  END IF;
  ```
- `075_sync_key_after_settlement.sql:34`: `GREATEST(0, spent_usdc - v_settled_amount)` también en el UPDATE

### AC-10: REVOKE/GRANT pattern
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:49-50`:
  ```sql
  REVOKE EXECUTE ON FUNCTION sync_key_after_settlement(UUID, UUID[], NUMERIC) FROM PUBLIC;
  GRANT  EXECUTE ON FUNCTION sync_key_after_settlement(UUID, UUID[], NUMERIC) TO service_role;
  ```

### AC-11: balance_synced_at = now() in same UPDATE
**✅ CUMPLE**  
- `075_sync_key_after_settlement.sql:35`: `balance_synced_at = now()` en el mismo UPDATE (línea 32-36)

---

## Fase 3 — Build Verification

```
npx tsc --noEmit
```
**RESULTADO: ✅ PASS** (sin errores ni warnings)

---

## Fase 4 — Regression Check

| Archivo | Cambios en HEAD | Estado |
|---|---|---|
| `supabase/migrations/017_pipeline_executions.sql` | Ninguno | ✅ NO TOCADO |
| `supabase/migrations/013_increment_key_budget.sql` | Ninguno | ✅ NO TOCADO |

`git log` no muestra modificaciones recientes en estos archivos. Los RPCs `deduct_key_balance` e `increment_key_budget` están intactos.

---

## Resumen Final

| Fase | Resultado |
|---|---|
| Drift Detection | ✅ PASS — sin drift |
| ACs (11/11) | ✅ TODOS CUMPLEN |
| Build TypeScript | ✅ PASS |
| Regression Check | ✅ PASS |

**VEREDICTO: ✅ SPRINT 275 APROBADO — Listo para merge/deploy**
