# Work Item — WAS-275: Post-settlement spent_usdc desync

## Resumen

Después de un settlement batch, el sistema actualiza `budget_usdc` al balance on-chain post-settlement pero **no resetea `spent_usdc`** para las llamadas ya liquidadas. Esto crea un estado donde `budget_usdc - spent_usdc` es negativo, bloqueando al usuario de gastar su saldo real on-chain hasta que deposite suficiente para cubrir la "deuda fantasma".

## Tipo

Bugfix — accounting post-settlement

## Clasificación

QUALITY (toca pagos, contabilidad, settlement on-chain)

## Contexto técnico

### Estado actual

1. **Deposit:** `increment_key_budget` suma `p_amount` a `budget_usdc` (aditivo) ✅
2. **Llamadas:** `deduct_key_balance` suma `p_amount` a `spent_usdc` con guard atómico `WHERE (budget_usdc - spent_usdc) >= p_amount` ✅
3. **Settlement:** `settleKeyBatchOnChain` liquida calls en lote on-chain, luego:
   - Marca calls como `settled_at = now()` ✅
   - **Sobreescribe** `budget_usdc = getKeyBalanceOnChain()` ← PROBLEMA
   - **No toca** `spent_usdc` ← PROBLEMA

### Escenario de reproducción

```
1. budget_usdc = 10, spent_usdc = 0, on-chain = 10
2. Usuario hace 5.792 USDC en llamadas
   → budget=10, spent=5.792, available=4.208
3. Settlement liquida 5.792 on-chain
   → on-chain keyBalance = 10 - 5.792 = 4.208
4. Post-settlement sync: budget_usdc SET TO 4.208
   → budget=4.208, spent=5.792, available = -1.584
5. UI muestra 0. deduct_key_balance BLOQUEA todo.
6. Usuario deposita 3 USDC → budget = 7.208
   → available = 7.208 - 5.792 = 1.416 (debería ser 7.208)
```

### Impacto

- **NO es un bug de seguridad** — `deduct_key_balance` es atómico y nunca permite gastar sin fondos
- **SÍ es un bug de UX/accounting** — el usuario pierde acceso a su saldo real post-settlement
- **El usuario NO pierde dinero** — pero su balance disponible se reduce artificialmente

## Acceptance Criteria (EARS)

### Originales (corregidos)

- **AC-1:** WHEN a settlement batch completes successfully, THEN `spent_usdc` SHALL be reduced by exactly `SUM(amount_paid)` of the calls included in `batchCallIds` for that key — NOT by calls outside the batch (unregistered, trimmed, or beyond the 500-call limit).
- **AC-2:** WHEN the sync RPC executes, THEN the postcondition SHALL be: `spent_usdc_new = spent_usdc_old - settled_amount` where `settled_amount = SUM(amount_paid) FROM agent_calls WHERE id = ANY(batchCallIds)`. Tolerancia: 0 (NUMERIC con misma precisión).
- **AC-3:** WHEN a settlement batch partially settles (trimmed by key balance), THEN `spent_usdc` SHALL only be reduced by the amount actually settled — remaining pending calls SHALL stay in `spent_usdc`.
- **AC-4:** WHEN post-settlement sync fails (try/catch), THEN `spent_usdc` SHALL NOT be modified (fail-safe: better to block than to allow overspend).
- **AC-6:** The existing `deduct_key_balance` RPC SHALL NOT be modified. The existing `budget_usdc = postSettleBalance` SET in the settlement route SHALL be preserved (moved inside the RPC or kept alongside it).

### Nuevos (del Requirements Review)

- **AC-7 (No-idempotente, caller guards):** The RPC uses relative subtraction (`spent_usdc - settled_amount`) and is NOT idempotent. If the settlement route retries, the caller SHALL verify that `balance_synced_at` for the key was not already updated for this batch before calling the RPC again. This is acceptable because settlements are admin-triggered and controlled.
- **AC-8 (Interfaz RPC):** `sync_key_after_settlement` SHALL accept `p_key_id UUID`, `p_call_ids UUID[]`, and `p_new_budget NUMERIC` as parameters. It SHALL internally compute `settled_amount = SUM(amount_paid) FROM agent_calls WHERE id = ANY(p_call_ids)`. The caller (route.ts) SHALL NOT pre-compute the settled amount in TypeScript to avoid TOCTOU race conditions. `p_new_budget` is the post-settlement on-chain balance passed by the caller.
- **AC-9 (Floor zero):** AFTER `sync_key_after_settlement` executes, `spent_usdc` for the affected key SHALL be >= 0. The RPC SHALL use `GREATEST(0, spent_usdc - settled_amount)`. If clamping is applied, the RPC SHALL log a WARNING via RAISE NOTICE (not exception).
- **AC-10 (Atomicidad):** The update of `budget_usdc` (SET to `p_new_budget`) AND the reduction of `spent_usdc` SHALL occur in the same RPC call (`sync_key_after_settlement`) in a single UPDATE statement to prevent partial updates if the process crashes between the two operations.
- **AC-11 (Security):** The new RPC SHALL follow the REVOKE/GRANT pattern: `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role;` — matching `deduct_key_balance` and `refund_key_balance`.

## Scope

### IN
- Post-settlement sync en `settlement/route.ts`
- Nueva migración SQL con RPC `sync_key_after_settlement`
- Llamada al RPC desde el settlement route

### OUT
- `deduct_key_balance` (no se toca)
- `increment_key_budget` (no se toca)
- Compose route (no se toca)
- Deposit route (no se toca)
- UI/frontend (no se toca)

## Archivos afectados

1. `src/app/api/admin/settlement/route.ts` — post-settlement sync (líneas ~204-215)
2. `supabase/migrations/075_sync_key_after_settlement.sql` — nueva migración con RPC

## Riesgos

- R1: Si el cálculo de settled_amount es incorrecto, `spent_usdc` podría quedar en negativo → mitigado con `GREATEST(0, ...)` (AC-9)
- R2: Race condition entre settlement y llamadas concurrentes → mitigado porque el RPC calcula internamente en SQL (AC-8)
- R3: Idempotencia en retry → mitigado porque el RPC calcula desde los call_ids, no de un delta incremental (AC-7)
- R4: Partial crash entre budget_usdc SET y spent_usdc reduction → mitigado moviendo ambos al mismo RPC (AC-10)
