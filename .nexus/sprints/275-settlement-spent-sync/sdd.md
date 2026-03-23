# SDD #095: [BUG] Post-settlement spent_usdc desync — WAS-275

> SPEC_APPROVED: yes (2026-03-22)
> Fecha: 2026-03-22
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/275-settlement-spent-sync

---

## 1. Resumen del bug

Después de un settlement batch, `budget_usdc` se sobreescribe con el balance on-chain post-settlement pero `spent_usdc` no se reduce por las llamadas recién liquidadas. Esto crea un estado donde `budget_usdc - spent_usdc` es negativo, bloqueando al usuario de gastar su saldo real hasta que deposite suficiente para cubrir la "deuda fantasma". No es un bug de seguridad (no permite gastar sin fondos), pero impide el acceso legítimo al saldo post-settlement.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-275 / SDD #095 |
| **Tipo** | bugfix |
| **Objetivo** | Corregir el sync post-settlement para que `spent_usdc` refleje solo llamadas no liquidadas |
| **Scope IN** | Settlement route post-sync + nueva migración SQL |
| **Scope OUT** | deduct_key_balance, increment_key_budget, compose route, deposit route, UI, contratos |

## 3. Reproducción

### Repro steps
1. Agent key con budget_usdc=10, spent_usdc=0
2. Ejecutar llamadas por 5.792 USDC → budget=10, spent=5.792
3. Admin ejecuta settlement batch → on-chain keyBalance baja a 4.208
4. Post-settlement sync: budget_usdc SET TO 4.208, spent_usdc no se toca
5. available = 4.208 - 5.792 = -1.584

### Actual
Balance disponible se muestra como 0. `deduct_key_balance` bloquea todas las llamadas. Usuario necesita depositar para cubrir deuda fantasma antes de poder usar su saldo real.

### Expected
Balance disponible = 4.208 (el balance on-chain real menos llamadas no liquidadas). `deduct_key_balance` permite llamadas si hay saldo on-chain real.

## 4. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/app/api/admin/settlement/route.ts` | Settlement route | Línea ~207: `budget_usdc = postSettleBalance` sin tocar `spent_usdc` |
| `supabase/migrations/017_pipeline_executions.sql` | `deduct_key_balance` RPC | Atómico, guard correcto: `WHERE (budget_usdc - spent_usdc) >= p_amount` |
| `supabase/migrations/013_increment_key_budget.sql` | `increment_key_budget` RPC | Aditivo: `budget_usdc = budget_usdc + p_amount` |
| `supabase/migrations/045_refund_key_balance.sql` | `refund_key_balance` RPC | Patrón REVOKE/GRANT a seguir: `GREATEST(0, spent_usdc - p_amount)` |

### Exemplar para el fix
| Fix en | Seguir patrón de | Razón |
|--------|------------------|-------|
| Nueva migración SQL | `045_refund_key_balance.sql` | Mismo patrón: RPC plpgsql + SECURITY DEFINER + REVOKE/GRANT + GREATEST(0,...) |
| Settlement route | Bloque existente líneas ~204-215 | Reemplazar el try/catch de sync con llamada al nuevo RPC |

## 5. Análisis de causa raíz

### Dónde está el bug
| Archivo | Línea/zona | Qué está mal |
|---------|-----------|-------------|
| `src/app/api/admin/settlement/route.ts` | ~204-215 | Post-settlement sync sobreescribe `budget_usdc` pero no reduce `spent_usdc` |

### Causa raíz
El diseño de WAS-218 (on-chain como fuente de verdad) hizo `budget_usdc = getKeyBalanceOnChain()` post-settlement, pero no consideró que `spent_usdc` es acumulativo y ya incluye las llamadas que acaban de ser liquidadas on-chain. Al reducir `budget_usdc` sin reducir `spent_usdc`, el balance disponible se vuelve negativo.

### Fix propuesto
Crear un RPC `sync_key_after_settlement(p_key_id, p_call_ids[], p_new_budget)` que en un solo UPDATE:
1. Compute `settled_amount = SUM(amount_paid) FROM agent_calls WHERE id = ANY(p_call_ids)`
2. SET `budget_usdc = p_new_budget`
3. SET `spent_usdc = GREATEST(0, spent_usdc - settled_amount)`

Reemplazar el bloque actual (budget_usdc update separado) con la llamada a este RPC.

## 6. Acceptance Criteria (EARS)

- **AC-1:** WHEN a settlement batch completes successfully, THEN `spent_usdc` SHALL be reduced by exactly `SUM(amount_paid)` of the calls included in `batchCallIds` for that key.
- **AC-2:** WHEN the sync RPC executes, THEN the postcondition SHALL be: `spent_usdc_new = spent_usdc_old - settled_amount` where `settled_amount = SUM(amount_paid) FROM agent_calls WHERE id = ANY(batchCallIds)`. Tolerancia: 0.
- **AC-3:** WHEN a settlement batch partially settles (trimmed by key balance), THEN `spent_usdc` SHALL only be reduced by the amount actually settled.
- **AC-4:** WHEN post-settlement sync fails (try/catch), THEN `spent_usdc` SHALL NOT be modified.
- **AC-5:** The RPC uses relative subtraction and is NOT idempotent. The caller SHALL NOT call the RPC twice for the same batch.
- **AC-6:** `deduct_key_balance` and `increment_key_budget` RPCs SHALL NOT be modified.
- **AC-7:** The RPC SHALL accept `p_key_id UUID`, `p_call_ids UUID[]`, and `p_new_budget NUMERIC`. It SHALL compute `settled_amount` internally from the call_ids in SQL.
- **AC-8:** `budget_usdc` SET and `spent_usdc` reduction SHALL occur in the same UPDATE statement inside the RPC.
- **AC-9:** `spent_usdc` SHALL never be < 0 after the RPC. Use `GREATEST(0, spent_usdc - settled_amount)`. If clamping is applied, RAISE WARNING (not exception).
- **AC-11:** The RPC SHALL also SET `balance_synced_at = now()` in the same UPDATE statement — no separate round-trip needed.
- **AC-10:** The RPC SHALL use `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role;`.

## 7. Constraint Directives

### OBLIGATORIO seguir
- Patrón de RPC: seguir `045_refund_key_balance.sql` (SECURITY DEFINER, REVOKE/GRANT, GREATEST)
- Settlement route: reemplazar el bloque try/catch de ~204-215, no agregar código nuevo antes ni después
- El RPC hace UN solo UPDATE — no transacción multi-statement

### PROHIBIDO
- NO modificar `deduct_key_balance`, `increment_key_budget`, ni `refund_key_balance`
- NO refactorizar código adyacente en settlement route
- NO agregar columnas a `agent_calls` (no se necesita marker de idempotencia)
- NO pre-computar settled_amount en TypeScript — el cálculo va en SQL
- NO cambiar la lógica de `settleKeyBatchOnChain` ni el marcado de `settled_at`

## Waves

### Wave 0 — Pre-flight
- [ ] W0.1: Verificar que migración 074 es la última existente
- [ ] W0.2: Verificar que `refund_key_balance` en migración 045 compila y sigue el patrón esperado
- [ ] W0.3: Verificar que el bloque post-settlement sync (líneas ~204-215) no cambió desde el análisis

### Wave 1 — Migración SQL
- [ ] W1.1: Crear `supabase/migrations/075_sync_key_after_settlement.sql` con:
  - `CREATE OR REPLACE FUNCTION sync_key_after_settlement(p_key_id UUID, p_call_ids UUID[], p_new_budget NUMERIC) RETURNS void`
  - Compute `settled_amount` con `COALESCE(SUM(amount_paid), 0)` — SUM sobre 0 filas retorna NULL en PostgreSQL, COALESCE lo protege
  - Single UPDATE: `SET budget_usdc = p_new_budget, spent_usdc = GREATEST(0, spent_usdc - v_settled_amount), balance_synced_at = now() WHERE id = p_key_id AND is_active = true`
  - Si 0 rows updated: `RAISE WARNING 'sync_key_after_settlement: key % not found or inactive', p_key_id`
  - Si clamping aplicado (spent_usdc sería negativo): `RAISE WARNING 'sync_key_after_settlement: clamping applied for key %', p_key_id`
  - NOTA: `batchCallIds` del caller es `string[]` (Supabase JS). PostgreSQL castea automáticamente a `UUID[]` vía el driver.
  - `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role;`
- [ ] **Build gate:** `supabase db reset` o validar SQL syntax

### Wave 2 — Settlement route
- [ ] W2.1: En `src/app/api/admin/settlement/route.ts`, reemplazar el bloque:
  ```
  try {
    const postSettleBalance = await getKeyBalanceOnChain(keyRow.key_hash)
    await supabase.from('agent_keys').update({ budget_usdc: postSettleBalance, balance_synced_at: ... }).eq(...)
  } catch { ... }
  ```
  Con:
  ```
  try {
    const postSettleBalance = await getKeyBalanceOnChain(keyRow.key_hash)
    const { error: rpcErr } = await supabase.rpc('sync_key_after_settlement', {
      p_key_id: keyId,
      p_call_ids: batchCallIds,
      p_new_budget: postSettleBalance,
    })
    if (rpcErr) throw rpcErr
    // balance_synced_at se actualiza dentro del RPC — no hace falta UPDATE separado
  } catch (syncErr) {
    logger.warn('[admin/settlement] post-settlement sync failed', { keyId, err: String(syncErr).slice(0, 200) })
  }
  ```
  NOTA: Supabase RPC no lanza excepciones — devuelve `{ data, error }`. El destructuring + throw es obligatorio para que AC-4 funcione.
- [ ] **Build gate:** `npx tsc --noEmit`

## Rollback

1. Revertir el commit en settlement route (volver al SET directo de budget_usdc)
2. El RPC en la migración queda inerte — no se llama si el route se revierte
3. No hay cambios de schema ni columnas nuevas — rollback limpio

## 8. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| settled_amount > spent_usdc actual (clamping) | Baja | Bajo | GREATEST(0,...) + RAISE NOTICE |
| Race condition con deduct_key_balance concurrente | Muy baja | Bajo | Substracción relativa (no SET absoluto) se compone correctamente |
| RPC llamado dos veces para mismo batch | Muy baja | Medio | No-idempotente; caller guards (settlement es admin-triggered) |
| `batchCallIds` vacío | Baja | Nulo | `COALESCE(SUM(...), 0)` = 0, spent_usdc no cambia |

---

*SDD generado por NexusAgil — BUGFIX*
