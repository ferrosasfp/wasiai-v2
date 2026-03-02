# Story File — SDD #022: WAS-94 Operator Daily Settlement Cap
**Sprint 12 | WAS-94 [SHK-ATTACKER]**
**Classification: QUALITY — HU-MAJOR**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

NexusAudit finding SHK-ATTACKER: Si el hot wallet del operador es comprometido,
un atacante puede drenar todo el contrato de una sola vez via `settleKeyBatch`.
No hay ningún límite de cuánto puede extraer el operador por día.

La solución es un cap diario configurable por el owner. Si el operador intenta
liquidar más de X USDC en 24h, la transacción revierte. Esto limita el blast
radius máximo a ~1 día de volumen, no todo el contrato.

---

## Acceptance Criteria

- AC1: `dailySettlementCap` configurable por owner (default: 10_000_000_000 = 10,000 USDC con 6 decimales)
- AC2: `dailySettledAmount` acumula lo liquidado en el día en curso
- AC3: `dailySettlementReset` timestamp del inicio del período actual (24h)
- AC4: `settleKeyBatch` revierte si `dailySettledAmount + batchTotal > dailySettlementCap`
- AC5: El contador se resetea automáticamente cuando `block.timestamp >= dailySettlementReset + 24h`
- AC6: `setDailySettlementCap(uint256)` solo owner, emite `DailyCapUpdated`
- AC7: `getDailySettlementStatus()` view — retorna `(cap, settled, resetsAt)`
- AC8: Tests forge cubren: normal, exceder cap, reset automático, owner cambia cap
- AC9: `forge test` 0 failures

---

## Implementation

### Wave 1 — Contrato

**File:** `contracts/src/WasiAIMarketplace.sol`

#### Nuevas variables de estado (agregar después de `totalEarnings`):

```solidity
/// @notice Max USDC that can be settled in a 24h window (6 decimals)
uint256 public dailySettlementCap;
/// @notice USDC settled in the current 24h window
uint256 public dailySettledAmount;
/// @notice Timestamp when the current 24h window started
uint256 public dailySettlementReset;
```

#### Constructor — inicializar cap:
```solidity
// En el constructor, después de las asignaciones existentes:
dailySettlementCap    = 10_000 * 1e6; // 10,000 USDC default
dailySettlementReset  = block.timestamp;
```

#### Nuevo evento:
```solidity
event DailyCapUpdated(uint256 oldCap, uint256 newCap);
```

#### Nueva función owner:
```solidity
/// @notice Update the daily settlement cap. Set to 0 to disable cap.
function setDailySettlementCap(uint256 newCap) external onlyOwner {
    uint256 old = dailySettlementCap;
    dailySettlementCap = newCap;
    emit DailyCapUpdated(old, newCap);
}
```

#### Nueva view:
```solidity
/// @notice Returns current daily settlement window status.
function getDailySettlementStatus()
    external view
    returns (uint256 cap, uint256 settled, uint256 resetsAt)
{
    cap      = dailySettlementCap;
    settled  = dailySettledAmount;
    resetsAt = dailySettlementReset + 24 hours;
}
```

#### Helper interno — agregar antes de `settleKeyBatch`:
```solidity
/// @dev Reset daily counter if 24h window has passed.
function _checkAndResetDailyWindow() internal {
    if (block.timestamp >= dailySettlementReset + 24 hours) {
        dailySettledAmount   = 0;
        dailySettlementReset = block.timestamp;
    }
}
```

#### Modificar `settleKeyBatch` — agregar al inicio:
```solidity
function settleKeyBatch(...) external onlyOperator nonReentrant whenNotPaused {
    require(keyIds.length <= 500, "WasiAI: batch too large");

    // Reset daily window if needed
    _checkAndResetDailyWindow();

    // ... calcular totalBatchAmount sumando todos los amounts del batch ...
    // El contrato ya calcula `total` sumando amounts[] — reusar esa variable
    // settleKeyBatch signature: (bytes32 keyId, string[] slugs, uint256[] amounts)
    // total = sum(amounts[i]) — ya calculado antes del cap check

    // Check daily cap (0 = disabled)
    if (dailySettlementCap > 0) {
        require(
            dailySettledAmount + totalBatchAmount <= dailySettlementCap,
            "WasiAI: daily cap exceeded"
        );
    }
    dailySettledAmount += totalBatchAmount;

    // ... resto del batch logic sin cambios ...
}
```

**IMPORTANT:** Leer el `settleKeyBatch` actual para entender su estructura exacta
antes de modificar. El cap check debe ir ANTES de hacer cualquier transferencia.

### Wave 2 — Tests

**File:** `contracts/test/WasiAIMarketplace.t.sol`

```solidity
function test_DailyCap_NormalSettlement_Passes() public {
    // Setup: deposit + settle dentro del cap
    _depositKey(KEY_ID, 5_000 * 1e6);
    _settleKey(KEY_ID, 5_000 * 1e6); // dentro del 10k default cap
    (,uint256 settled,) = marketplace.getDailySettlementStatus();
    assertEq(settled, 5_000 * 1e6);
}

function test_DailyCap_ExceedsCap_Reverts() public {
    _depositKey(KEY_ID, 15_000 * 1e6);
    vm.prank(operator);
    vm.expectRevert("WasiAI: daily cap exceeded");
    // Intenta liquidar 15k > 10k cap
    _settleKey(KEY_ID, 15_000 * 1e6);
}

function test_DailyCap_ResetsAfter24h() public {
    _depositKey(KEY_ID, 20_000 * 1e6);
    _settleKey(KEY_ID, 9_000 * 1e6); // dentro del cap
    vm.warp(block.timestamp + 24 hours + 1);
    _settleKey(KEY_ID, 9_000 * 1e6); // nuevo día, cap reseteado
    (,uint256 settled,) = marketplace.getDailySettlementStatus();
    assertEq(settled, 9_000 * 1e6); // solo el segundo
}

function test_DailyCap_OwnerCanUpdate() public {
    vm.prank(owner);
    marketplace.setDailySettlementCap(50_000 * 1e6);
    (uint256 cap,,) = marketplace.getDailySettlementStatus();
    assertEq(cap, 50_000 * 1e6);
}

function test_DailyCap_ZeroDisablesCap() public {
    vm.prank(owner);
    marketplace.setDailySettlementCap(0);
    _depositKey(KEY_ID, 999_999 * 1e6);
    _settleKey(KEY_ID, 999_999 * 1e6); // sin cap, pasa todo
}
```

---

## Wave Order

W1 → forge build (0 errores) → W2 → forge test (0 failures) → commit

---

## Critical Constraints

1. **Leer `settleKeyBatch` completo antes de modificar** — la estructura actual es compleja
2. **El cap check va ANTES de cualquier transferencia** — evitar partial state
3. **`dailySettlementCap = 0` desactiva el cap** — útil para contratos recién deployados en testnet
4. **Constructor debe inicializar `dailySettlementReset = block.timestamp`** — evitar que el primer día empiece en timestamp 0
5. **No modificar `recordInvocation`** — ese flujo no usa `settleKeyBatch`
6. **Fuji v9 deploy requerido** después de este cambio (combinado con SDD #021 si van juntos)
