# WasiAI v2 — Audit Brief para Auditor Externo
**Preparado:** 2026-03-04  
**Para:** Auditor (sesión independiente con Nexus Audit mejorado)  
**Metodología:** NexusAudit + Claude Opus

---

## Contexto del Proyecto

WasiAI es un marketplace de agentes de IA con pagos en USDC en Avalanche Fuji (testnet).  
Los creadores publican agentes, los usuarios los invocan pagando por llamada.  
El sistema es **non-custodial**: los fondos fluyen de usuario → contrato → key balance → creator wallet.

---

## Alcance — Contratos a Auditar

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `contracts/src/WasiAIMarketplace.sol` | 693 | Contrato principal — depositForKey, settle, withdraw, fees |
| `contracts/src/WasiEscrow.sol` | 244 | Escrow alternativo (beta, no productivo aún) |
| `contracts/test/WasiAIMarketplace.t.sol` | ~1200 | 103 test functions Foundry |
| `contracts/test/NexusAuditValidation.t.sol` | ~400 | 20 test functions — validaciones de audit |

---

## Funciones del Contrato Principal (WasiAIMarketplace.sol)

### Escritura (state-changing)
| Función | Rol | Protección |
|---------|-----|------------|
| `depositForKey(bytes32, uint256, ...)` | Cualquier usuario | ERC-3009 auth |
| `settleKeyBatch(bytes32[], uint256[])` | Solo operador | `onlyOperator` |
| `withdrawKey(bytes32, uint256)` | Solo creator (msg.sender = keyOwner) | `nonReentrant`, sin `whenNotPaused` ⚠️ |
| `emergencyWithdrawKey(bytes32)` | Solo operador | `onlyOperator`, `nonReentrant` |
| `claimEarnings(address)` | Solo creator (msg.sender) | `nonReentrant` |
| `proposeFee(uint16)` | Solo owner | timelock 48h |
| `executeFee()` | Solo owner | después de timelock |
| `setOperator(address)` | Solo owner | — |
| `pause()` / `unpause()` | Solo owner | — |
| `emergencyWithdraw(address, uint256)` | Solo owner | `whenPaused` |

### Lectura
| Función | Descripción |
|---------|-------------|
| `getKeyBalance(bytes32)` | Balance USDC de una key |
| `getCreatorEarnings(address)` | Earnings pendientes del creator |
| `platformFeeBps` | Fee actual (basis points) |

---

## Cambios desde Último Audit (2026-03-03)

El audit anterior (NA-001 a NA-025) fue el 2026-03-03.  
**Desde entonces se añadió:**

### ➕ WAS-141 — `withdrawKey` (2026-03-04, commit 18a06a6)

```solidity
// mapping(bytes32 => address) public keyOwners;  — line 106
// event KeyWithdrawn(bytes32 indexed keyId, address indexed owner, uint256 amount);  — line 158

function withdrawKey(bytes32 keyId, uint256 amount) external nonReentrant {
    require(keyOwners[keyId] == msg.sender,    "WasiAI: not key owner");
    require(amount > 0,                         "WasiAI: amount must be > 0");
    require(keyBalances[keyId] >= amount,       "WasiAI: insufficient key balance");

    keyBalances[keyId] -= amount;
    totalKeyBalances   -= amount;
    usdc.safeTransfer(msg.sender, amount);

    emit KeyWithdrawn(keyId, msg.sender, amount);
}
```

**Patrón CEI:** ✅ (checks → effects → interact)  
**`keyOwner` mapping:** ✅ existe en línea 106, se setea en `depositForKey` (línea 400–401)

**Puntos de atención específicos para esta función:**
1. ¿El check `msg.sender == keyOwner` es correcto? ¿Existe un mapping `keyOwner`?
2. ¿El invariante `totalKeyBalances -= amount` se mantiene?
3. ¿Sin `whenNotPaused` es correcto? (decisión intencional: creator siempre puede recuperar fondos)
4. ¿CEI pattern correcto? (Check → Effect → Interact)
5. ¿Reentrancy posible dado que USDC es ERC-20 standard (no callback)?

---

## Hallazgos del Audit Anterior — Estado Actual

Ver `doc/audit/wasiai-v2-audit-report.md` para el reporte completo.

**Resumen de hallazgos previos y su estado:**

| ID | Severidad | Título | Estado |
|----|-----------|--------|--------|
| NA-001 | HIGH | ABI mismatch `setPlatformFee` | ⚠️ Pendiente verificar si fue resuelto |
| NA-002 | HIGH | `.gitignore` no protege `.env` | ⚠️ Pendiente verificar |
| NA-003 | MEDIUM | `totalKeyBalances` invariant en `emergencyWithdrawKey` | ⚠️ Pendiente verificar |
| NA-004 | MEDIUM | Flash loan en `depositForKey` | Aceptado (Fuji testnet) |
| NA-005 | MEDIUM | `settleKeyBatch` sin cap de array | ⚠️ Pendiente verificar |
| NA-006 | MEDIUM | `claimEarnings` sin evento | ⚠️ Pendiente verificar |
| NA-007 | LOW | `platformFeeBps` max no verificado | ⚠️ Pendiente verificar |
| NA-008 | LOW | `proposeFee` con bps=0 posible | ⚠️ Pendiente verificar |
| NA-009 | LOW | `setOperator(address(0))` posible | ⚠️ Pendiente verificar |

---

## Red y Entorno

| Variable | Valor |
|----------|-------|
| Red activa | Avalanche Fuji (testnet) — Chain ID 43113 |
| Mainnet | NO desplegado aún |
| USDC en Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| Contrato Marketplace | Variable de entorno `MARKETPLACE_CONTRACT_ADDRESS` |
| Operador | Wallet controlada por backend (`OPERATOR_PRIVATE_KEY`) |

---

## Tests de Contrato

```
contracts/test/WasiAIMarketplace.t.sol  — 103 test functions
contracts/test/NexusAuditValidation.t.sol — 20 test functions
```

Ejecutar con: `cd contracts && forge test --summary`

---

## Archivos Clave para el Auditor

```
contracts/src/WasiAIMarketplace.sol      ← CONTRATO PRINCIPAL
contracts/src/WasiEscrow.sol             ← CONTRATO ESCROW (beta)
contracts/test/WasiAIMarketplace.t.sol   ← TESTS FOUNDRY
contracts/test/NexusAuditValidation.t.sol← TESTS DE AUDIT
doc/audit/wasiai-v2-audit-report.md      ← REPORTE AUDIT ANTERIOR
src/lib/contracts/WasiAIMarketplace.ts   ← ABI usado por el backend
src/app/api/agent-keys/[id]/withdraw/route.ts  ← Backend WAS-141
```

---

## Preguntas Abiertas para el Auditor

1. **`withdrawKey` — ¿keyOwner mapping existe?** El contrato debe tener un `mapping(bytes32 => address) public keyOwner` — verificar que se setea en `depositForKey` y se usa correctamente en `withdrawKey`.
2. **Re-entrancy en USDC transfer:** USDC es ERC-20 sin callbacks — `nonReentrant` es suficiente pero confirmar.
3. **Frontrunning en `withdrawKey`:** ¿Puede el operador hacer `settleKeyBatch` justo antes de un `withdrawKey` y dejar balance insuficiente?
4. **Pausability gap:** `withdrawKey` sin `whenNotPaused` — ¿esto crea un vector donde el owner pausa el contrato pero el creator puede seguir extrayendo fondos? (Podría ser intencional o un riesgo).
5. **NA-001 revisited:** ¿El ABI en `WasiAIMarketplace.ts` fue sincronizado después de agregar `withdrawKey`?
