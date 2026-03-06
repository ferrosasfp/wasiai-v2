# Story File — WAS-103: Arquitectura Dual-Flow (OZ-A1)

**NNN:** 024  
**Sprint:** 17  
**Story Points:** 3  
**Modo:** QUALITY  
**Estado:** SPEC_APPROVED ✅  
**SDD:** `doc/sdd/024-dual-flow-arch/sdd.md`  
**Dependencias:** WAS-89 (tests ERC-3009 reales — debe estar merged antes)

---

## Readiness Check (completa esto ANTES de escribir código)

- [ ] WAS-89 está mergeado en `master`
- [ ] `forge test` corre exitosamente: `cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts && forge test` — confirmar **138 tests passing**
- [ ] Tienes abierto `contracts/src/WasiAIMarketplace.sol` en tu editor
- [ ] Tienes abierto `contracts/test/WasiAIMarketplace.t.sol` para referencia de tests
- [ ] Leíste la sección "Constraint Directives" de este story file completamente
- [ ] Entendiste que este refactor es **solo arquitectónico** — cero cambios de lógica

---

## Contexto

El contrato `WasiAIMarketplace.sol` implementa dos flows de pago distintos en el mismo contrato sin separación explícita (hallazgo OZ-A1):

- **Flow x402:** pago directo post-funded (`recordInvocation`, `withdraw`, `withdrawFor`)
- **Flow Key:** pre-funded API key (`depositForKey`, `settleKeyBatch`, `refundKeyToEarnings`, `emergencyWithdrawKey`)

El problema es triple:
1. No hay documentación explícita de qué función pertenece a qué flow
2. El modificador `whenNotPaused` se aplica de forma inconsistente en el Flow Key (`refundKeyToEarnings` lo falta)
3. Un auditor externo no puede determinar rápidamente la superficie de ataque de cada flow

Este story es **únicamente arquitectónico**: claridad + corrección de asimetría. Sin nuevas features, sin cambios de lógica.

---

## Wave 0 — Única wave (cambios simples, en serie)

### Tarea 1 — Agregar `whenNotPaused` a `refundKeyToEarnings`

**Archivo:** `contracts/src/WasiAIMarketplace.sol`

Busca la función `refundKeyToEarnings`. Su firma actual es:

```solidity
function refundKeyToEarnings(bytes32 keyId) external onlyOperator nonReentrant {
```

Cámbiala a:

```solidity
function refundKeyToEarnings(bytes32 keyId) external onlyOperator nonReentrant whenNotPaused {
```

**Solo cambia la firma de la función.** El body no cambia.

**Justificación:** `depositForKey` y `settleKeyBatch` tienen `whenNotPaused`. `refundKeyToEarnings` es la operación inversa de `depositForKey` — debe respetarse el estado pausado. `emergencyWithdrawKey` NO recibe `whenNotPaused` (es la salida trustless del usuario, debe funcionar incluso si el sistema está pausado).

---

### Tarea 2 — Agregar bloque FLOW GUIDE antes de `// ─── Payment Accounting ───`

**Archivo:** `contracts/src/WasiAIMarketplace.sol`

Busca el comentario de sección:

```solidity
    // ─── Payment Accounting ───────────────────────────────────────────────────
```

Justo **antes** de ese comentario (sin eliminar nada), inserta el siguiente bloque:

```solidity
    // ─── FLOW GUIDE ───────────────────────────────────────────────────────────────
    // This contract implements two payment flows that share state but serve
    // distinct use cases:
    //
    //  ┌─ Flow x402 (direct payment, post-funded) ──────────────────────────────┐
    //  │  Used by: Ultravioleta DAO facilitator after on-chain USDC settlement  │
    //  │  Functions: recordInvocation(), withdraw(), withdrawFor()              │
    //  │  State:     earnings[creator], totalEarnings, usedPaymentIds           │
    //  └────────────────────────────────────────────────────────────────────────┘
    //
    //  ┌─ Flow Key (pre-funded API key) ────────────────────────────────────────┐
    //  │  Used by: Backend operator after user signs ERC-3009 authorization     │
    //  │  Functions: depositForKey(), settleKeyBatch(), refundKeyToEarnings(),  │
    //  │             emergencyWithdrawKey()                                      │
    //  │  State:     keyBalances[keyId], keyOwners[keyId], totalKeyBalances     │
    //  └────────────────────────────────────────────────────────────────────────┘
    //
    //  Both flows share: agents[], operators[], platformFeeBps, totalVolume,
    //  totalInvocations, treasury.
    //
    //  OZ-A1 note: A single `onlyOperator` modifier controls both flows.
    //  Future role separation tracked in WAS-110+.
    // ─────────────────────────────────────────────────────────────────────────────

```

---

### Tarea 3 — Agregar `@dev flow:` en NatSpec de funciones de flow

**Archivo:** `contracts/src/WasiAIMarketplace.sol`

Para cada función listada abajo, agrega una línea `@dev flow: ...` dentro de su bloque NatSpec existente (después de `@notice`, antes de `@param` o del primer `@dev` existente si hay).

#### 3a. `recordInvocation()` (~L245)

Busca:
```solidity
     * @notice Record an invocation and split earnings.
     * @dev Called by the backend AFTER the x402 USDC payment has been confirmed
```

Agrega después del `@notice`:
```solidity
     * @dev flow: x402
```

Resultado:
```solidity
     * @notice Record an invocation and split earnings.
     * @dev flow: x402
     * @dev Called by the backend AFTER the x402 USDC payment has been confirmed
```

---

#### 3b. `withdraw()` (~L285)

Busca:
```solidity
     * @notice Creator claims all pending USDC earnings.
     */
    function withdraw()
```

Cambia a:
```solidity
     * @notice Creator claims all pending USDC earnings.
     * @dev flow: x402 (also accessible after Key refund via refundKeyToEarnings)
     */
    function withdraw()
```

---

#### 3c. `withdrawFor()` (~L298)

Busca:
```solidity
     * @notice Operator-triggered withdrawal on behalf of a creator.
     * @dev Useful for automatic payouts triggered by the backend.
     */
    function withdrawFor
```

Cambia a:
```solidity
     * @notice Operator-triggered withdrawal on behalf of a creator.
     * @dev flow: x402
     * @dev Useful for automatic payouts triggered by the backend.
     */
    function withdrawFor
```

---

#### 3d. `depositForKey()` (~L315)

Busca:
```solidity
     * @notice Fund an API key with USDC via ERC-3009 transferWithAuthorization.
     * @dev Operator calls this after user signs the ERC-3009 authorization off-chain.
```

Cambia a:
```solidity
     * @notice Fund an API key with USDC via ERC-3009 transferWithAuthorization.
     * @dev flow: Key
     * @dev Operator calls this after user signs the ERC-3009 authorization off-chain.
```

---

#### 3e. `settleKeyBatch()` (~L366)

Busca:
```solidity
     * @notice Liquida un batch de llamadas de key en una sola tx.
     * @dev Gas amortizado: una tx cubre cientos de llamadas.
```

Cambia a:
```solidity
     * @notice Liquida un batch de llamadas de key en una sola tx.
     * @dev flow: Key
     * @dev Gas amortizado: una tx cubre cientos de llamadas.
```

---

#### 3f. `refundKeyToEarnings()` (~L420)

Busca:
```solidity
     * @notice Mueve el balance restante de una key a earnings del owner.
     * @dev Operador llama esto cuando el usuario cierra su key.
```

Cambia a:
```solidity
     * @notice Mueve el balance restante de una key a earnings del owner.
     * @dev flow: Key
     * @dev Operador llama esto cuando el usuario cierra su key.
```

---

#### 3g. `emergencyWithdrawKey()` (~L437)

Busca:
```solidity
     * @notice Salida de emergencia: usuario recupera su USDC si el operador
     *         lleva más de EMERGENCY_TIMEOUT sin actividad.
     * @dev Trustless exit — no requiere permiso del operador.
     */
```

Cambia a:
```solidity
     * @notice Salida de emergencia: usuario recupera su USDC si el operador
     *         lleva más de EMERGENCY_TIMEOUT sin actividad.
     * @dev flow: Key (trustless exit — no operator permission required)
     * @dev Trustless exit — no requiere permiso del operador.
     */
```

---

## Verificación Final

```bash
# 1. Compilar sin errores
cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts
forge build

# 2. Correr todos los tests — DEBE PASAR 138/138
forge test

# 3. Verificar el modificador
grep -n "whenNotPaused" src/WasiAIMarketplace.sol
# Expected output debe incluir refundKeyToEarnings

# 4. Verificar FLOW GUIDE existe
grep -n "FLOW GUIDE" src/WasiAIMarketplace.sol
# Expected: 1 línea encontrada

# 5. Verificar flow tags en NatSpec
grep -n "@dev flow:" src/WasiAIMarketplace.sol
# Expected: 7 líneas (una por función de flow)

# 6. Diff limpio — solo adiciones, cero eliminaciones de lógica
git diff contracts/src/WasiAIMarketplace.sol
```

---

## Constraint Directives

### ✅ OBLIGATORIO

- `forge test` debe pasar exactamente **138 tests** antes y después del refactor
- El único cambio funcional es agregar `whenNotPaused` a `refundKeyToEarnings`
- Todo lo demás son comentarios y NatSpec (cero impacto en bytecode de funciones)
- Hacer `forge build` y confirmar 0 errores antes de hacer el test run

### 🚫 PROHIBIDO

- **NO** cambiar el body de ninguna función
- **NO** cambiar los cálculos de fees o splits
- **NO** cambiar el orden de variables de estado (storage layout)
- **NO** agregar nuevas variables de estado
- **NO** crear nuevos modifiers
- **NO** cambiar `emergencyWithdrawKey` — no recibe `whenNotPaused` (es trustless exit)
- **NO** agregar `whenNotPaused` a `recordInvocation` (decisión arquitectónica consciente — el pago x402 ya ocurrió off-chain)
- **NO** agregar `whenNotPaused` a `withdraw` (pull pattern siempre disponible — validado en test)
- **NO** tocar `contracts/test/WasiAIMarketplace.t.sol`
- **NO** tocar ningún archivo fuera de `contracts/src/WasiAIMarketplace.sol`

---

## Entregables

- [ ] `contracts/src/WasiAIMarketplace.sol` modificado (Tareas 1-3)
- [ ] `forge test` → 138/138 passing, evidencia en pantalla
- [ ] `forge build` → 0 errors
- [ ] `git diff` revisado y limpio (solo comentarios + 1 modificador)
- [ ] Adversarial Review solicitado al rol Adversary antes de merge

---

## Tests de regresión a verificar manualmente (top 5)

Estos tests son los más relevantes para el cambio de `whenNotPaused` en `refundKeyToEarnings`:

1. `test_RefundKeyToEarnings` — debe seguir pasando (no está en estado paused)
2. `test_RefundKeyToEarnings_OwnerCanWithdraw` — idem
3. `test_RefundKeyToEarnings_UnknownKey` — idem
4. `test_RefundKeyToEarnings_NothingToRefund` — idem
5. `test_Integration_FullKeyLifecycle` — flujo completo deposit→settle→refund→withdraw

Ninguno de estos tests ejecuta `refundKeyToEarnings` con el contrato pausado, así que todos deben continuar pasando.

---

*Generado por San (NexusAgil Architect) — 2026-03-02 — WAS-103/NNN-024*  
*Requiere SPEC_APPROVED del Product Owner antes de iniciar implementación.*
