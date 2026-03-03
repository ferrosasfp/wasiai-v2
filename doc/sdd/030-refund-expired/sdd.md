# SDD — WAS-118: `refundExpired()` trustless en WasiEscrow

**NNN:** 030 | **SP:** 3 | **Prioridad:** P0  
**Estado:** SDD DRAFT  
**Fecha:** 2026-03-03  
**Autor:** San (Architect, NexusAgil)

---

## 1. Contexto

`WasiEscrow` tiene dos paths post-timeout actualmente:

| Función           | Actor       | Destino    | Trustless |
|-------------------|-------------|------------|-----------|
| `releaseExpired()`| cualquiera  | marketplace| ✅        |
| `refundEscrow()`  | operator    | payer      | ❌        |

**GAP:** No existe path trustless de refund al payer. Si el operador desaparece y la tarea falló, el payer no puede recuperar sus fondos sin depender del operador.

**WAS-118** cierra ese gap con `refundExpired()`.

---

## 2. Codebase Grounding

### 2.1 Patrones reales extraídos del contrato

**`releaseExpired()` — patrón trustless + timeout check:**
```solidity
function releaseExpired(bytes32 escrowId)
    external
    nonReentrant
    escrowExists(escrowId)
    isPending(escrowId)
{
    require(
        block.timestamp >= escrows[escrowId].createdAt + RELEASE_TIMEOUT,
        "WasiEscrow: timeout not reached"
    );
    _release(escrowId);
}
```

**`refundEscrow()` — patrón CEI + EscrowRefunded:**
```solidity
function refundEscrow(bytes32 escrowId)
    external
    onlyOperator
    nonReentrant
    escrowExists(escrowId)
    isPending(escrowId)
{
    EscrowTx storage e = escrows[escrowId];
    e.status = EscrowStatus.Refunded;          // ← Effect ANTES de Transfer
    usdc.safeTransfer(e.payer, e.amount);
    emit EscrowRefunded(escrowId, e.payer, e.amount);
}
```

**Constantes relevantes:**
- `RELEASE_TIMEOUT = 24 hours`
- `enum EscrowStatus { Pending, Released, Refunded, Disputed }`
- `event EscrowRefunded(bytes32 indexed escrowId, address indexed payer, uint256 amount)`

### 2.2 Verificación CEI en funciones existentes

| Función          | Check                         | Effect (estado)              | Interaction (transfer)          |
|------------------|-------------------------------|------------------------------|---------------------------------|
| `releaseEscrow()`| modifiers                     | `e.status = Released` (en `_release`) | `safeTransfer(marketplace)`  |
| `refundEscrow()` | modifiers                     | `e.status = Refunded`        | `safeTransfer(e.payer)`        |
| `releaseExpired()`| modifiers + require timeout  | `e.status = Released` (en `_release`) | `safeTransfer(marketplace)`  |

✅ **CEI confirmado en todas las funciones existentes.**

---

## 3. Diseño de `refundExpired()`

### 3.1 Código exacto

```solidity
/**
 * @notice Trustless refund: cualquiera puede llamar tras RELEASE_TIMEOUT
 *         y devolver los fondos al payer original.
 *         Protege al payer si el operador desaparece y la tarea falló.
 * @dev    CEI pattern: estado → Refunded ANTES del safeTransfer.
 */
function refundExpired(bytes32 escrowId)
    external
    nonReentrant
    escrowExists(escrowId)
    isPending(escrowId)
{
    require(
        block.timestamp >= escrows[escrowId].createdAt + RELEASE_TIMEOUT,
        "WasiEscrow: timeout not reached"
    );
    EscrowTx storage e = escrows[escrowId];
    e.status = EscrowStatus.Refunded;              // ← CEI: Effect primero
    usdc.safeTransfer(e.payer, e.amount);           // ← Interaction después
    emit EscrowRefunded(escrowId, e.payer, e.amount);
}
```

### 3.2 CEI Pattern verificado

```
CHECKS:
  1. nonReentrant guard
  2. escrowExists(escrowId)  → reverts "WasiEscrow: not found"
  3. isPending(escrowId)     → reverts "WasiEscrow: not pending"
  4. require(block.timestamp >= createdAt + RELEASE_TIMEOUT)  → reverts "WasiEscrow: timeout not reached"

EFFECTS:
  5. e.status = EscrowStatus.Refunded  ← Estado cambia ANTES del transfer

INTERACTIONS:
  6. usdc.safeTransfer(e.payer, e.amount)  ← Token transfer DESPUÉS de cambio de estado
  7. emit EscrowRefunded(...)
```

**Reentrancy seguro:** Si `safeTransfer` llamara de vuelta a `refundExpired`, el paso 3 (isPending) ya fallaría porque el estado es `Refunded`.

---

## 4. Tests a agregar en `WasiEscrow.t.sol`

```solidity
// ── WAS-118: refundExpired ────────────────────────────────────────────────

function test_RefundExpired_After24h() public {
    _createEscrow();
    uint256 payerBefore = usdc.balanceOf(payer);
    vm.warp(block.timestamp + 25 hours);
    // cualquier address puede llamar
    vm.prank(stranger);
    escrow.refundExpired(escrowId);
    assertEq(usdc.balanceOf(payer), payerBefore + AMOUNT);
    assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Refunded));
}

function test_RefundExpired_Before24h_Reverts() public {
    _createEscrow();
    vm.prank(stranger);
    vm.expectRevert("WasiEscrow: timeout not reached");
    escrow.refundExpired(escrowId);
}

function test_RefundExpired_AlreadyRefunded_Reverts() public {
    _createEscrow();
    vm.warp(block.timestamp + 25 hours);
    vm.prank(stranger);
    escrow.refundExpired(escrowId);
    vm.prank(stranger);
    vm.expectRevert("WasiEscrow: not pending");
    escrow.refundExpired(escrowId);
}

function test_RefundExpired_AlreadyReleased_Reverts() public {
    _createEscrow();
    vm.prank(operator);
    escrow.releaseEscrow(escrowId);
    vm.warp(block.timestamp + 25 hours);
    vm.prank(stranger);
    vm.expectRevert("WasiEscrow: not pending");
    escrow.refundExpired(escrowId);
}

function test_RefundExpired_ExactlyAt24h_Succeeds() public {
    _createEscrow();
    uint256 createdAt = escrow.getEscrow(escrowId).createdAt;
    vm.warp(createdAt + 24 hours);
    vm.prank(stranger);
    escrow.refundExpired(escrowId);
    assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Refunded));
}

function test_RefundExpired_EmitsEvent() public {
    _createEscrow();
    vm.warp(block.timestamp + 25 hours);
    vm.expectEmit(true, true, false, true);
    emit WasiEscrow.EscrowRefunded(escrowId, payer, AMOUNT);
    vm.prank(stranger);
    escrow.refundExpired(escrowId);
}
```

---

## 5. Constraint Directives

### OBLIGATORIO
- ✅ CEI pattern: `e.status = Refunded` ANTES de `safeTransfer`
- ✅ Modifiers: `nonReentrant`, `escrowExists`, `isPending`
- ✅ Misma string de error que `releaseExpired`: `"WasiEscrow: timeout not reached"`
- ✅ Emitir `EscrowRefunded` (evento ya existe, misma firma)
- ✅ Leer de `EscrowTx storage` (no memory) para evitar copias innecesarias
- ✅ No requiere `onlyOperator` — es trustless, cualquier address puede llamar
- ✅ Insertar en contrato entre `releaseExpired()` y `refundEscrow()`

### PROHIBIDO
- ❌ NO cambiar `RELEASE_TIMEOUT`
- ❌ NO introducir variables memory intermedias antes del cambio de estado
- ❌ NO emitir evento antes del cambio de estado
- ❌ NO agregar parámetros adicionales a la función
- ❌ NO modificar funciones existentes

---

## 6. Placement en WasiEscrow.sol

Insertar después de `releaseExpired()` (línea ~145) y antes de `refundEscrow()`:

```
releaseEscrow()    → operator release
releaseExpired()   → trustless release → marketplace
[NUEVO] refundExpired()  → trustless refund → payer    ← WAS-118
refundEscrow()     → operator refund → payer
disputeEscrow()    → operator dispute
```

---

## 7. DoD (Definition of Done)

- [ ] `refundExpired()` implementado con CEI pattern
- [ ] 6 tests pasan: `forge test --match-contract WasiEscrowTest -vv`
- [ ] `forge build` 0 errores, 0 warnings nuevos
- [ ] `git push origin master && git push origin master:main`
