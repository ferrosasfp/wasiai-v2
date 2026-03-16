# Sprint 10 — Backlog v3 (FINAL — HU_APPROVED)
**Fecha:** 2026-03-16
**Status:** HU_APPROVED
**Incorpora:** Review ronda 1 + observaciones SM + Review ronda 2

---

## WAS-216 (QUALITY) — Nuevo contrato WasiAIMarketplace V2

### Decisiones de arquitectura (cerradas)
- **D-1:** Solo `earnings[creator]` — no `agentEarnings[slug]`. El desglose por agente es responsabilidad de la DB.
- **D-2:** `batchSelfRegister` con slug ya registrado → revertir TODA la tx con el slug problemático en el mensaje.
- **D-3:** `settleKeyBatch` con slug no registrado → skipear con evento `SettlementSkipped(keyId, slug, amount)`. La deducción del keyBalance es post-loop (solo lo acreditado).

### Acceptance Criteria

**Registro:**
- AC-1: `batchSelfRegister(slugs[], prices[], erc8004Ids[])` — N agentes en 1 tx, msg.sender = creator
- AC-2: batchSelfRegister SHALL revertir con "WasiAI: empty batch" si slugs[].length == 0
- AC-3: batchSelfRegister SHALL revertir con "WasiAI: batch too large" si slugs[].length > 50
- AC-4: batchSelfRegister SHALL revertir con "WasiAI: array length mismatch" si arrays de largo desigual
- AC-5: batchSelfRegister SHALL revertir con "WasiAI: slug taken: {slug}" si cualquier slug ya está registrado (revierte toda la tx)
- AC-6: batchSelfRegister SHALL cobrar `registrationFee` por cada agente que exceda `freeRegistrationsPerUser` del msg.sender (usando safeTransferFrom USDC). El contador `userRegistrationCount[msg.sender]` se incrementa al final de la tx exitosa, no por slug individual.
- AC-7: batchSelfRegister SHALL emitir `AgentRegistered(slug, creator, price, erc8004Id)` por cada agente registrado exitosamente
- AC-8: batchSelfRegister SHALL tener modifier `whenNotPaused`
- AC-9: `setAgentPrice(slug, newPrice)` — callable solo por creator del slug o operator; revertir con "WasiAI: not authorized" si msg.sender no autorizado

**Settlement graceful:**
- AC-10: `settleKeyBatch` SHALL skipear slugs no registrados (creator == address(0)) emitiendo `SettlementSkipped(bytes32 keyId, string slug, uint256 amount)` — NO revertir
- AC-11: La deducción del keyBalance SHALL ser post-loop: `keyBalances[keyId] -= totalActuallySettled` donde `totalActuallySettled` es la suma de amounts de slugs registrados únicamente. Los montos de slugs skipeados NO se deducen.
- AC-12: Test Foundry: batch con 3 slugs (2 registrados + 1 skipeado) → keyBalance decrementado en suma de los 2 registrados únicamente, SettlementSkipped emitido para el 3ero

**Reputation:**
- AC-13: `ReputationRecord` extendido: `{ uint16 avgRating, uint32 totalCalls, uint32 successCalls, uint32 disputeCount, uint32 avgResponseMs, uint64 lastUpdated }`
- AC-14: `submitReputationBatch(slugs[], avgRatings[], totalCalls[], successCalls[], disputeCounts[], avgResponseMs[])` — callable solo por operator, reemplaza la función actual
- AC-15: `getReputation(slug)` retorna el struct completo

**Earnings:**
- AC-16: El contrato mantiene UN SOLO mapping `earnings[creator]` como fuente de verdad on-chain
- AC-17: `getPendingEarnings(creator)` — función de lectura pública existente, permanece igual

**Admin / seguridad:**
- AC-18: `pause()` / `unpause()` permanecen
- AC-19: `proposeFee` / `executeFee` con timelock 48h permanecen
- AC-20: `emergencyWithdrawUSDC(address to)` — callable solo por owner y solo `whenPaused`

**Tests Foundry:**
- AC-21: `batchSelfRegister` happy path (N agentes en 1 tx)
- AC-22: `batchSelfRegister` arrays desiguales → revert
- AC-23: `batchSelfRegister` slug ya registrado → revert con slug en mensaje
- AC-24: `batchSelfRegister` batch vacío → revert
- AC-25: `batchSelfRegister` batch > 50 → revert
- AC-26: `settleKeyBatch` mezcla registrados + no-registrados → procesa registrados, skipea no-registrados, keyBalance correcto
- AC-27: `setAgentPrice` por creator → OK; por tercero → revert
- AC-28: Solvency invariant: `usdc.balanceOf(contract) >= totalKeyBalances + totalEarnings` después de toda operación

**Migración y doc:**
- AC-29: Script de migración registra los 5 agentes WasiAI via `batchSelfRegister`
- AC-30: Post-deploy script verifica los 5 agentes son legibles via `getAgent(slug)`
- AC-31: `NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET` actualizado en Vercel prod
- AC-32: NatSpec completo en cada función pública y evento (`@notice`, `@dev`, `@param`, `@return`)
- AC-33: Sin breaking changes: `withdrawKey`, `depositForKey`, `withdraw`, `withdrawFor`, `recordInvocation` permanecen con misma firma

---

## WAS-224 (TASK) — Audit y corrección de paths de insert en agent_calls

> **Prerrequisito de WAS-223. Ejecutar en paralelo con WAS-216.**
> Reclasificado de FAST-FIX a TASK.

### Acceptance Criteria
- AC-1: Grep exhaustivo de todos los archivos que insertan en `agent_calls` — documentar en `.nexus/sprints/sprint-10/insert-audit.md`
- AC-2: Para cada path: documentar qué campos setea actualmente y cuáles faltan (`payment_type`, `agent_slug`)
- AC-3: Corregir cada path para incluir `payment_type` y `agent_slug` obligatorios:
  - `models/[slug]/invoke/route.ts` con api_key → `'api_key'`
  - `models/[slug]/invoke/route.ts` con x402 → `'x402'`
  - `sandbox/invoke/[slug]/route.ts` → `'sandbox'`
  - `src/lib/x402/x402Handler.ts` → `'x402'` con slug como parámetro obligatorio
  - free trial → `'free_trial'`
- AC-4: Verificar en dev que 0 inserts ocurren sin `agent_slug` o sin `payment_type` después de los cambios
- AC-5: WAS-223 AC-1..AC-3 se resuelven en ESTE ticket; WAS-223 los referencia como "COMPLETED IN WAS-224"

---

## WAS-223 (HU-MAJOR) — Tipado estricto de pagos en agent_calls

> **Depende de WAS-224 completado. Orden de deploy: paths corregidos → deploy → 24h monitoreo → constraints.**

### Decisiones de arquitectura
- **D-1:** `amount_paid` constraint = `>= 0` (no `> 0`). Calls fallidas pueden tener amount_paid = 0.
- **D-2:** NOT NULL constraints se aplican DESPUÉS de verificar 0 nulls por 24h en prod.
- **D-3:** Rows ambiguas en backfill → `'unknown'`, nunca asumir `'free_trial'`.

### Acceptance Criteria
- AC-1: DEPENDS ON WAS-224 — audit y corrección de paths completado
- AC-2: Fase 1 (con deploy): agregar columna `payment_type TEXT CHECK (payment_type IN ('api_key', 'x402', 'free_trial', 'sandbox', 'unknown'))` nullable
- AC-3: `amount_paid` constraint: `CHECK (amount_paid >= 0)`
- AC-4: Backfill de rows existentes:
  - `key_id IS NOT NULL AND amount_paid > 0` → `'api_key'`
  - `tx_hash IS NOT NULL AND key_id IS NULL` → `'x402'`
  - `amount_paid = 0 AND key_id IS NULL AND tx_hash IS NULL` → `'unknown'` (no asumir free_trial)
  - `agent_slug IS NULL` → `requires_review = true` (agregar columna boolean, no borrar)
- AC-5: Backfill ejecutado en dev → verificado → prod
- AC-6: Fase 2 (24h después, 0 nulls verificados): aplicar NOT NULL en `payment_type` y `agent_slug`
- AC-7: Settlement filtra `payment_type = 'api_key' AND settled_at IS NULL AND agent_slug IS NOT NULL`
- AC-8: Calls `payment_type IN ('free_trial', 'sandbox', 'unknown')` excluidas de settlement con log DEBUG
- AC-9: Índice compuesto `(agent_slug, payment_type, settled_at)` en `agent_calls`

---

## WAS-218 (HU-MAJOR) — On-chain como fuente de verdad para balances de keys

> **Depende de WAS-216 deployado.**

### Decisiones de arquitectura
- **D-1:** `budget_usdc` = caché del balance on-chain con `balance_synced_at`
- **D-2:** `spent_usdc` como campo operacional se reemplaza por `total_deposited_usdc` histórico
- **D-3:** Actualizaciones de budget_usdc son post-confirmación (1 bloque), no optimistas
- **D-4:** RPC failure → devolver caché con `stale: true`

### Acceptance Criteria
- AC-1: Migración DB: agregar `balance_synced_at TIMESTAMPTZ DEFAULT NULL` a `agent_keys`
- AC-2: Migración DB: agregar `total_deposited_usdc NUMERIC(18,6) DEFAULT 0` a `agent_keys`, poblada desde `budget_usdc` actual como seed inicial
- AC-3: `/api/agent-keys` SHALL leer `getKeyBalance(keyId)` on-chain para cada key y devolver valor real
- AC-4: IF RPC falla → devolver `{ balance: budget_usdc, stale: true, synced_at: balance_synced_at }`
- AC-5: UI SHALL mostrar "⚠ Balance desactualizado" si `balance_synced_at` > 5 minutos
- AC-6: WHEN settlement completa → actualizar `budget_usdc = getKeyBalance(keyId)` y `balance_synced_at = NOW()`
- AC-7: WHEN withdrawKey completa → actualizar `budget_usdc = getKeyBalance(keyId)` y `balance_synced_at = NOW()`
- AC-8: Actualización post-tx espera confirmación on-chain (polling de receipt, timeout 30s)
- AC-9: Botón "Sync" en UI llama `POST /api/agent-keys/[id]/sync-balance`
- AC-10: `/sync-balance` rate limit: 1 request por key cada 30s; responder 429 si se excede
- AC-11: `spent_usdc_display = total_deposited_usdc - budget_usdc` (calculado desde los 2 campos de DB)

---

## WAS-217 (HU-MAJOR) — Flujo Withdraw con registro on-chain obligatorio

> **Depende de WAS-216 deployado + WAS-218 completado.**

### Decisiones de arquitectura
- **D-1:** 2 pasos visibles y separados
- **D-2:** Si `pendingEarnings = 0` → botón deshabilitado, no mostrar flujo de registro
- **D-3:** Verificar USDC allowance antes de Paso 1 si hay registrationFee

### Acceptance Criteria

**Backend (prerrequisito):**
- AC-1: Crear `GET /api/creator/agents/on-chain-status` (autenticado por wallet):
  - Lee slugs del creator desde DB (`agents` table, `creator_wallet_address`)
  - Para cada slug, llama `getAgent(slug)` on-chain
  - Retorna `{ registered: string[], unregistered: string[] }`
  - Cachea resultado 60s por creator
- AC-2: IF `/on-chain-status` falla (RPC timeout) → UI muestra "No se pudo verificar estado on-chain. Intenta de nuevo." y NO deshabilita el botón de withdraw

**Pre-flight:**
- AC-3: WHEN creator abre Withdraw modal, THE frontend llama `/api/creator/agents/on-chain-status`
- AC-4: IF `unregistered.length === 0` → mostrar solo paso de withdraw (flujo actual)
- AC-5: IF `pendingEarnings = 0` → botón deshabilitado con tooltip "Acumula earnings antes de retirar"
- AC-6: IF `unregistered.length > 0` AND `pendingEarnings > 0` → mostrar flujo 2 pasos

**Paso 1 — Registrar:**
- AC-7: UI muestra lista de slugs a registrar y estimación de gas antes de solicitar firma
- AC-8: IF `registrationFee > 0` → UI verifica allowance; si insuficiente, solicita `approve` primero
- AC-9: WHEN creator firma → frontend llama `batchSelfRegister(unregistered[], prices[], erc8004Ids[])` en 1 tx
- AC-10: Polling de confirmación con timeout 30s; si no confirma → mostrar "Tx pendiente" con link al explorador + opción reintentar
- AC-11: IF batchSelfRegister falla (revert) → mostrar error con slug problemático + opción reintentar
- AC-12: Agentes sin `erc8004_id` en DB → excluir del batch con advertencia: "N agentes sin ERC-8004 — configúralos antes de registrar"

**Paso 2 — Withdraw:**
- AC-13: WHEN Paso 1 confirma → avanzar automáticamente a Paso 2
- AC-14: Paso 2 ejecuta claimEarnings (flujo existente)
- AC-15: IF usuario cierra browser después de Paso 1 → al reabrir, detectar via `/on-chain-status` que Paso 1 completó y mostrar directamente Paso 2

---

## Orden de ejecución (dependencias)

```
WAS-224 (TASK, paralelo con WAS-216)
WAS-216 (QUALITY, bloquea WAS-217 y WAS-218)
    ↓
WAS-223 (depende WAS-224)
WAS-218 (depende WAS-216)
    ↓
WAS-217 (depende WAS-216 + WAS-218)
```
