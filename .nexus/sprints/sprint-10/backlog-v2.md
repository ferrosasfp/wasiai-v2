# Sprint 10 — Backlog v2
**Fecha:** 2026-03-16
**Incorpora:** observaciones del SM + Requirements Review ronda 1

---

## WAS-216 (QUALITY) — Nuevo contrato WasiAIMarketplace V2

### Contexto
Redeploy completo del contrato en mainnet. Solo hay ~$0.83 USDC y 5 agentes propios — migración de bajo costo. El contrato actual tiene errores de arquitectura que bloquean escalar.

### Decisiones de arquitectura (cerradas antes de SDD)
- **D-1:** No usar `agentEarnings[slug]` en el contrato — evita doble contabilidad con `earnings[creator]`. El desglose por agente se resuelve en DB (off-chain). Un solo mapping `earnings[creator]` es la fuente de verdad on-chain.
- **D-2:** `batchSelfRegister` con slug ya registrado → **revertir toda la tx** con el slug problemático en el mensaje. No graceful-skip (sería peligroso — el creator asumiría que todos se registraron).
- **D-3:** `settleKeyBatch` con slug no registrado → **skipear con evento** `SettlementSkipped(keyId, slug)`. Comportamiento opuesto a batchSelfRegister porque settlement es operación del operador, no del creator.

### Acceptance Criteria

**Registro:**
- AC-1: `batchSelfRegister(slugs[], prices[], erc8004Ids[])` — N agentes en 1 tx, msg.sender = creator
- AC-2: batchSelfRegister SHALL revertir con "WasiAI: array length mismatch" si arrays de largo desigual
- AC-3: batchSelfRegister SHALL revertir con "WasiAI: slug taken: {slug}" si cualquier slug ya está registrado (revierte toda la tx, no skip parcial)
- AC-4: batchSelfRegister SHALL cobrar `registrationFee` por cada agente que exceda `freeRegistrationsPerUser` del msg.sender (usando safeTransferFrom USDC)
- AC-5: batchSelfRegister SHALL emitir `AgentRegistered(slug, creator, price, erc8004Id)` por cada agente registrado exitosamente
- AC-6: `setAgentPrice(slug, newPrice)` — callable solo por creator del slug o operator; revertir si msg.sender no autorizado

**Settlement graceful:**
- AC-7: `settleKeyBatch` SHALL skipear slugs no registrados (creator == address(0)) emitiendo `SettlementSkipped(keyId, slug, amount)` — NO revertir
- AC-8: El monto de los slugs skipeados SHALL ser devuelto al keyBalance (no deducido de la key ni transferido a nadie)

**Reputation:**
- AC-9: `ReputationRecord` extendido: `{ uint16 avgRating, uint32 totalCalls, uint32 successCalls, uint32 disputeCount, uint32 avgResponseMs, uint64 lastUpdated }`
- AC-10: `updateReputationBatch(slugs[], avgRatings[], totalCalls[], successCalls[], disputeCounts[], avgResponseMs[])` — callable solo por operator
- AC-11: `getReputation(slug)` retorna el struct completo

**Earnings (sin doble contabilidad):**
- AC-12: El contrato mantiene UN SOLO mapping `earnings[creator]` como fuente de verdad on-chain
- AC-13: `getAgentEarnings(slug)` NO existe en el contrato — el desglose por agente es responsabilidad de la DB
- AC-14: `getPendingEarnings(creator)` — función de lectura pública que retorna `earnings[creator]` (ya existe, verificar que permanece)

**Admin / seguridad:**
- AC-15: `pause()` / `unpause()` permanecen (ya existen)
- AC-16: `proposeFee` / `executeFee` con timelock de 48h permanecen (ya existen)
- AC-17: `emergencyWithdrawUSDC(address to)` — callable solo por owner y solo whenPaused

**Tests Foundry:**
- AC-18: Test `batchSelfRegister` happy path (N agentes en 1 tx)
- AC-19: Test `batchSelfRegister` arrays desiguales → revert
- AC-20: Test `batchSelfRegister` slug ya registrado → revert con slug en mensaje
- AC-21: Test `batchSelfRegister` intento de registro por non-creator (msg.sender ≠ quien firmó) — N/A por diseño (msg.sender IS creator), pero verificar que no hay forma de registrar en nombre de otro
- AC-22: Test `settleKeyBatch` con mezcla de slugs registrados y no-registrados → procesa registrados, skipea no-registrados, emite SettlementSkipped
- AC-23: Test `setAgentPrice` por creator → OK; por tercero → revert
- AC-24: Test solvency invariant: `usdc.balanceOf(contract) >= totalKeyBalances + totalEarnings` después de toda operación

**Migración:**
- AC-25: Script de migración registra los 5 agentes WasiAI en nuevo contrato via `batchSelfRegister`
- AC-26: Post-deploy script verifica que los 5 agentes son legibles via `getAgent(slug)` en el nuevo contrato
- AC-27: `NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET` y `WASIAI_MARKETPLACE_ADDRESS` actualizados en Vercel prod

**Documentación:**
- AC-28: NatSpec completo en cada función pública (incluye `@notice`, `@dev`, `@param`, `@return`)
- AC-29: NatSpec en eventos (`@notice`)
- AC-30: Sin breaking changes: `withdrawKey`, `depositForKey`, `withdraw`, `withdrawFor`, `recordInvocation`, `settleKeyBatch` (firma) permanecen iguales

---

## WAS-217 (HU-MAJOR) — Flujo Withdraw con registro on-chain obligatorio

### Contexto
El creator hace withdraw desde `/creator/dashboard`. Si tiene agentes off-chain, debe registrarlos antes. El flujo es 2 pasos: (1) registrar off-chain → (2) retirar earnings.

### Decisiones de arquitectura
- **D-1:** 2 pasos visibles y separados en la UI — no transparente para el usuario
- **D-2:** Si `pendingEarnings = 0` y hay agentes off-chain → botón deshabilitado con tooltip, no mostrar el flujo de registro (no hay nada que retirar)
- **D-3:** El frontend debe verificar USDC allowance antes del Paso 1 si hay `registrationFee` aplicable

### Acceptance Criteria

**Pre-flight:**
- AC-1: WHEN creator abre Withdraw modal, THE frontend SHALL llamar `/api/creator/agents/on-chain-status` que retorna `{ registered: string[], unregistered: string[] }` para los agentes del creator
- AC-2: IF `unregistered.length === 0` → mostrar solo el paso de withdraw (flujo actual)
- AC-3: IF `pendingEarnings = 0` → botón Withdraw deshabilitado con tooltip "Acumula earnings invocando tus agentes antes de retirar"
- AC-4: IF `unregistered.length > 0` AND `pendingEarnings > 0` → mostrar flujo de 2 pasos

**Paso 1 — Registrar:**
- AC-5: UI DEBE mostrar lista de slugs a registrar y costo de gas estimado antes de solicitar firma
- AC-6: IF `registrationFee > 0` para algún agente → UI DEBE mostrar costo en USDC Y verificar allowance; si allowance insuficiente, solicitar `approve` primero
- AC-7: WHEN creator firma Paso 1 → frontend llama `batchSelfRegister(unregistered[], prices[], erc8004Ids[])` en 1 tx
- AC-8: Frontend hace polling de confirmación con timeout de 30s; si no confirma → mostrar "Tx pendiente" con link al explorador y opción de reintentar
- AC-9: IF batchSelfRegister falla (revert) → mostrar mensaje de error con el slug problemático + opción de reintentar
- AC-10: Agentes sin `erc8004Id` configurado en DB → excluir del batch con advertencia visible: "N agentes sin identidad ERC-8004 — configúralos antes de registrar"

**Paso 2 — Withdraw:**
- AC-11: WHEN Paso 1 confirma on-chain → avanzar automáticamente a Paso 2 sin acción del usuario
- AC-12: Paso 2 ejecuta el flujo de withdraw existente (claimEarnings)
- AC-13: IF usuario cierra browser después de Paso 1 → al reabrir modal, detectar vía on-chain que Paso 1 ya está completo y mostrar directamente Paso 2

**Estado:**
- AC-14: DEPENDS ON WAS-216 — bloqueado hasta que contrato V2 esté deployado con batchSelfRegister

---

## WAS-218 (HU-MAJOR) — On-chain como fuente de verdad para balances de keys

### Contexto
`budget_usdc` y `spent_usdc` se han desincronizado múltiples veces del balance on-chain. La UI muestra available negativo. La fuente de verdad es siempre `getKeyBalance(keyId)` on-chain.

### Decisiones de arquitectura
- **D-1:** `budget_usdc` = caché del balance on-chain, con `balance_synced_at` para saber cuándo fue la última lectura
- **D-2:** `spent_usdc` desaparece como campo operacional; se calcula solo para display histórico
- **D-3:** Actualizaciones de budget_usdc son post-confirmación on-chain (no optimistas)
- **D-4:** Si RPC falla → devolver último valor cacheado con flag `stale: true`

### Acceptance Criteria

**Schema (migración requerida antes de deploy):**
- AC-1: Migración DB: agregar columna `balance_synced_at TIMESTAMPTZ DEFAULT NULL` a `agent_keys` en dev y prod

**Lectura on-chain:**
- AC-2: `/api/agent-keys` (lista de keys del usuario) SHALL leer `getKeyBalance(keyId)` on-chain para cada key y devolver el valor real
- AC-3: IF llamada on-chain falla (RPC error/timeout) → devolver último `budget_usdc` cacheado con `{ balance: X, stale: true, synced_at: balance_synced_at }`
- AC-4: UI SHALL mostrar indicador "⚠ Balance desactualizado" si `balance_synced_at` tiene más de 5 minutos

**Sincronización automática:**
- AC-5: WHEN settlement completa exitosamente → endpoint SHALL actualizar `budget_usdc = getKeyBalance(keyId)` y `balance_synced_at = NOW()` para cada key procesada
- AC-6: WHEN withdrawKey completa exitosamente → endpoint SHALL actualizar `budget_usdc = getKeyBalance(keyId)` y `balance_synced_at = NOW()`
- AC-7: Actualización post-tx DEBE esperar confirmación on-chain (1 bloque), no optimista

**Sync manual:**
- AC-8: Botón "Sync" en UI de keys llama `POST /api/agent-keys/[id]/sync-balance`
- AC-9: `/sync-balance` SHALL tener rate limit: máximo 1 request por key cada 30 segundos; responder 429 si se excede
- AC-10: `/sync-balance` spec: autenticado (owner de la key), devuelve `{ budget_usdc, balance_synced_at, stale: false }`

**Display:**
- AC-11: `spent_usdc` en UI = `total_historico_depositado - budget_usdc_actual` (calculado, no leído de DB como campo operacional)

**Dependencias:**
- AC-12: DEPENDS ON WAS-216 — requiere contrato V2 deployado con `getKeyBalance` disponible (ya existe en V1, verificar que permanece en V2)

---

## WAS-223 (HU-MAJOR) — Tipado estricto de pagos en agent_calls

### Contexto
`agent_calls` no distingue confiablemente entre calls pagadas, free trial y sandbox. El constraint NOT NULL en producción romperá los paths de insert que aún no setean el campo. Orden crítico: corregir paths → verificar → aplicar constraint.

### Decisiones de arquitectura
- **D-1:** `amount_paid` constraint = `>= 0` (no `> 0`). Las calls fallidas con amount_paid = 0 y payment_type api_key son válidas y deben registrarse
- **D-2:** El constraint NOT NULL en agent_slug se aplica DESPUÉS de corregir todos los paths de insert y verificar 0 inserts sin slug por 24h en prod
- **D-3:** Orden de deploy: (1) corregir paths → (2) deploy → (3) monitorear 24h → (4) aplicar constraints

### Acceptance Criteria

**Audit de paths (PRIMERO — antes de cualquier constraint):**
- AC-1: Audit completo de todos los paths que insertan en `agent_calls`:
  - `src/app/api/v1/models/[slug]/invoke/route.ts`
  - `src/app/api/v1/sandbox/invoke/[slug]/route.ts`
  - `src/app/api/v1/compose/route.ts`
  - `src/lib/x402/x402Handler.ts`
  - Cualquier otro path identificado en el audit
- AC-2: EACH path SHALL incluir `payment_type` explícito en el insert:
  - invoke con api_key → `'api_key'`
  - invoke con x402 → `'x402'`
  - sandbox → `'sandbox'`
  - free trial → `'free_trial'`
- AC-3: EACH path SHALL incluir `agent_slug` — si el slug no está disponible en el contexto (ej: x402Handler), el handler DEBE recibirlo como parámetro obligatorio

**Schema (en 2 fases):**
- AC-4: Fase 1 (con deploy): agregar columna `payment_type` con tipo TEXT y DEFAULT NULL (nullable) + valores válidos como check constraint `payment_type IN ('api_key', 'x402', 'free_trial', 'sandbox')`
- AC-5: Fase 2 (24h después, tras verificar 0 nulls): aplicar NOT NULL en `payment_type` y `agent_slug`
- AC-6: `amount_paid` constraint: `CHECK (amount_paid >= 0)` (no `> 0` — calls fallidas pueden tener 0)

**Migración / backfill:**
- AC-7: Backfill de rows existentes:
  - `key_id IS NOT NULL AND amount_paid > 0` → `payment_type = 'api_key'`
  - `tx_hash IS NOT NULL AND key_id IS NULL` → `payment_type = 'x402'`
  - `amount_paid = 0 AND key_id IS NULL` → `payment_type = 'free_trial'`
  - `agent_slug IS NULL` → marcar `payment_type = 'unknown'` + columna `requires_review = true` (no borrar)
- AC-8: Backfill ejecutado en dev primero, verificado, luego aplicado en prod

**Settlement:**
- AC-9: Settlement endpoint filtra `payment_type = 'api_key' AND settled_at IS NULL AND agent_slug IS NOT NULL`
- AC-10: Calls con `payment_type IN ('free_trial', 'sandbox', 'unknown')` excluidas de settlement con log DEBUG

**Validación a nivel de aplicación:**
- AC-11: Cada path de insert valida `payment_type` antes del insert y devuelve HTTP 500 con log de error si payment_type es inválido (no exponer el error de constraint al usuario)

**Performance:**
- AC-12: Agregar índice `(agent_slug, payment_type, settled_at)` en `agent_calls` para queries de settlement

---

## WAS-224 (FAST-FIX) — Audit de x402Handler y paths de insert (pre-requisito de WAS-223)

### Contexto
Nueva issue separada del audit de paths. Ejecutar antes de WAS-223 para identificar todos los inserts sin slug o sin payment_type.

### Acceptance Criteria
- AC-1: Listar todos los archivos que hacen `insert` en `agent_calls` con grep exhaustivo
- AC-2: Para cada path: documentar qué campos setea actualmente y cuáles faltan
- AC-3: Corregir cada path para incluir `payment_type` y `agent_slug` obligatorios
- AC-4: Verificar en dev que 0 inserts ocurren sin slug o sin payment_type después de los cambios
