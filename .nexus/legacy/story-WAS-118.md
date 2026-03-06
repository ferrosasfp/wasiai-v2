# Story File — WAS-118: `refundExpired()` trustless en WasiEscrow

**NNN:** 030 | **SP:** 3 | **Prioridad:** P0  
**Estado:** STORY_READY  
**Fase:** F2.5 — Story File  
**Fecha:** 2026-03-03

---

## 1. Objetivo

Agregar `refundExpired()` a `WasiEscrow.sol`:  
Función trustless que permite a **cualquier address** recuperar fondos al payer original después de `RELEASE_TIMEOUT` (24h), protegiendo al usuario si el operador desaparece.

---

## 2. Archivos a modificar

| Archivo | Acción |
|---------|--------|
| `contracts/src/WasiEscrow.sol` | Agregar función `refundExpired()` |
| `contracts/test/WasiEscrow.t.sol` | Agregar 6 tests |

---

## 3. Diff exacto — `WasiEscrow.sol`

### Ubicación

Insertar entre `releaseExpired()` y `refundEscrow()`.

Buscar esta línea en el contrato:
```
    /**
     * @notice Operador devuelve USDC al payer (agente falló o cancelación).
     */
    function refundEscrow(bytes32 escrowId)
```

**Insertar ANTES de esa línea:**

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
        e.status = EscrowStatus.Refunded;              // CEI: Effect primero
        usdc.safeTransfer(e.payer, e.amount);           // Interaction después
        emit EscrowRefunded(escrowId, e.payer, e.amount);
    }

```

---

## 4. Contrato de integración

### Input
```
escrowId: bytes32  — ID del escrow existente, estado Pending, createdAt + 24h ≤ block.timestamp
```

### Output
```
EscrowTx.status  → Refunded
usdc.balanceOf[payer] += amount
usdc.balanceOf[WasiEscrow] -= amount
emit EscrowRefunded(escrowId, payer, amount)
```

### Invariantes
- Solo funciona en estado `Pending`
- Solo funciona después de `RELEASE_TIMEOUT` (24h exactas = válido, `block.timestamp >= createdAt + 24h`)
- Cualquier address puede llamar (trustless)
- El payer recibe el 100% del amount
- Reentrancy imposible: `nonReentrant` + estado cambia antes del transfer

---

## 5. CEI Pattern — verificación explícita

```
[CHECKS]
  modifier nonReentrant          → ReentrancyGuard de OZ
  modifier escrowExists(id)      → require(escrows[id].createdAt > 0)
  modifier isPending(id)         → require(escrows[id].status == Pending)
  require(timestamp >= createdAt + RELEASE_TIMEOUT)

[EFFECTS]
  e.status = EscrowStatus.Refunded   ← ESTADO CAMBIA AQUÍ

[INTERACTIONS]
  usdc.safeTransfer(e.payer, e.amount)   ← transfer ocurre DESPUÉS
  emit EscrowRefunded(...)
```

---

## 6. Tests completos para `WasiEscrow.t.sol`

Agregar al final de `WasiEscrowTest`, antes del cierre `}`:

```solidity
    // ── WAS-118: refundExpired ────────────────────────────────────────────────

    function test_RefundExpired_After24h() public {
        _createEscrow();
        uint256 payerBefore = usdc.balanceOf(payer);
        vm.warp(block.timestamp + 25 hours);
        // cualquier address puede llamar (trustless)
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
        // segundo llamado debe fallar
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

## 7. Waves de implementación

### W0 (serial — en orden)

1. **Editar `contracts/src/WasiEscrow.sol`**  
   Insertar `refundExpired()` entre `releaseExpired()` y `refundEscrow()`  
   → Ver diff exacto en sección 3

2. **Editar `contracts/test/WasiEscrow.t.sol`**  
   Agregar 6 tests (sección 6) al final de `WasiEscrowTest`

3. **Verificar compilación y tests:**
   ```bash
   cd contracts
   forge build
   forge test --match-contract WasiEscrowTest -vv
   ```

4. **Commit y push:**
   ```bash
   cd /home/ferdev/.openclaw/workspace/wasiai-v2
   git add contracts/src/WasiEscrow.sol contracts/test/WasiEscrow.t.sol
   git commit -m "feat(030): WAS-118 refundExpired trustless en WasiEscrow"
   git push origin master && git push origin master:main
   ```

---

## 8. Comando forge verify (post-deploy)

```bash
# Variables de entorno necesarias
export FUJI_RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
export SNOWTRACE_API_KEY="<tu-api-key>"
export WASIEESCROW_ADDRESS="<deployed-address>"
export USDC_ADDRESS="<fuji-usdc>"
export MARKETPLACE_ADDRESS="<marketplace>"

# Verify
forge verify-contract \
  --chain-id 43113 \
  --rpc-url $FUJI_RPC_URL \
  --etherscan-api-key $SNOWTRACE_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address)" $USDC_ADDRESS $MARKETPLACE_ADDRESS) \
  $WASIEESCROW_ADDRESS \
  src/WasiEscrow.sol:WasiEscrow
```

---

## 9. Anti-Hallucination Checklist (para Dev)

Antes de implementar, verificar:

- [ ] `EscrowStatus.Refunded` existe en el enum — ✅ (línea: `enum EscrowStatus { Pending, Released, Refunded, Disputed }`)
- [ ] `event EscrowRefunded` existe — ✅ (línea: `event EscrowRefunded(bytes32 indexed escrowId, address indexed payer, uint256 amount)`)
- [ ] `RELEASE_TIMEOUT` es constante pública — ✅ (`uint256 public constant RELEASE_TIMEOUT = 24 hours`)
- [ ] `SafeERC20` ya importado — ✅ (`using SafeERC20 for IERC20`)
- [ ] Modifiers `escrowExists` e `isPending` ya existen — ✅
- [ ] `nonReentrant` modifier disponible (`ReentrancyGuard`) — ✅
- [ ] Patrón CEI idéntico a `refundEscrow()` existente — ✅

---

## 10. Exemplar (código de referencia en codebase)

La función más cercana a replicar es `releaseExpired()` + lógica de `refundEscrow()`:

```solidity
// releaseExpired() — tomar el timeout check de aquí:
require(
    block.timestamp >= escrows[escrowId].createdAt + RELEASE_TIMEOUT,
    "WasiEscrow: timeout not reached"
);

// refundEscrow() — tomar el CEI pattern de aquí:
EscrowTx storage e = escrows[escrowId];
e.status = EscrowStatus.Refunded;
usdc.safeTransfer(e.payer, e.amount);
emit EscrowRefunded(escrowId, e.payer, e.amount);
```

`refundExpired()` = timeout check de `releaseExpired` + body de `refundEscrow` — sin `onlyOperator`.
