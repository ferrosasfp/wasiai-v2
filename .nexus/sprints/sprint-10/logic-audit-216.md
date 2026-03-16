## Logic Audit — SDD #WAS-216 (commit `b14686778`)

> Auditor: Logic Auditor — NexusAgil v1.3
> Fecha: 2026-03-16
> Branch: `feat/216-marketplace-v2`
> Archivos auditados: `contracts/src/WasiAIMarketplace.sol`, `contracts/test/WasiAIMarketplace.t.sol`, `contracts/script/DeployV2.s.sol`

---

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC-1: WHEN creator llama `batchSelfRegister([])`, SHALL revertir "WasiAI: empty batch" | Sí | `WasiAIMarketplace.sol` — `batchSelfRegister` primera require | ✅ OK |
| AC-2: WHEN arrays de diferente largo, SHALL revertir "WasiAI: array length mismatch" | Sí | `batchSelfRegister` — require `slugs.length == prices.length` y `== erc8004Ids.length` | ✅ OK |
| AC-3: WHEN slugs.length > 50, SHALL revertir "WasiAI: batch too large" | Sí | `batchSelfRegister` segunda require | ✅ OK |
| AC-4: WHEN slug ya registrado, SHALL revertir toda la tx "WasiAI: slug taken: {slug}" | Sí (parcial) | `batchSelfRegister` — pre-check loop sobre `agents[]` | ⚠️ BLOQUEANTE: no detecta duplicados intra-batch (ver Finding #1) |
| AC-5: WHEN exitoso, SHALL emitir `AgentRegistered` por cada slug | Sí | `batchSelfRegister` — loop de registro | ✅ OK |
| AC-6: WHEN mix registrado+no-registrado, SHALL procesar registrados, skipear no-registrados con `SettlementSkipped`, deducir solo amounts registrados | Sí | `settleKeyBatch` — loop + post-loop | ✅ OK |
| AC-7: WHEN batch vacío, SHALL revertir "WasiAI: empty batch" | Sí | `settleKeyBatch` primera require | ✅ OK |
| AC-8: keyBalances[keyId] SHALL decrementarse únicamente por amounts de slugs registrados | Sí | `settleKeyBatch` — `keyBalances[keyId] -= totalSettled` post-loop | ✅ OK |
| AC-9: `submitReputationBatch` SHALL actualizar `ReputationRecord` con 6 campos extendidos | Sí | `submitReputationBatch` — escribe los 6 campos en `reputations[slug]` | ✅ OK |
| AC-10: whenPaused → `batchSelfRegister`, `depositForKey`, `settleKeyBatch`, `recordInvocation` SHALL revertir | Sí | Modifier `whenNotPaused` en las 4 funciones | ✅ OK |
| AC-11: 5 agentes WasiAI verificables via `getAgent(slug)` | Sí | `DeployV2.s.sol` — batchSelfRegister + loop de verificación | ✅ OK |

---

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 1 | **BLOQUEANTE** | Lógica / Edge case | **Duplicados intra-batch no detectados en `batchSelfRegister`.** El pre-check itera sobre `agents[slugs[i]].creator == address(0)` pero no detecta que el mismo slug aparezca dos veces dentro del mismo batch. Ejemplo: `["a", "a"]` pasa el pre-check porque `agents["a"]` aún es `address(0)`, luego el loop de registro escribe `agents["a"]` dos veces (la segunda sobreescribe la primera). Resultado: el usuario paga fee por 2 registros (`feeCount` incluye ambos), `userRegistrationCount` incrementa 2, pero solo queda 1 agente registrado con los params del índice 1. El SDD especifica "batchSelfRegister revierte en slug duplicado" bajo Reglas de negocio. | `WasiAIMarketplace.sol` — `batchSelfRegister`, pre-check loop |
| 2 | MENOR | Consistencia / Validación | **`batchSelfRegister` no valida longitud de slug por ítem.** `selfRegisterAgent` enforcea `bytes(slug).length > 0 && bytes(slug).length <= 80` (NA-303), pero `batchSelfRegister` no tiene esta validación por ítem. Un slug vacío `""` en el batch pasa silenciosamente. Inconsistencia con `selfRegisterAgent`. | `WasiAIMarketplace.sol` — `batchSelfRegister` |
| 3 | MENOR | Consistencia / Validación | **`batchSelfRegister` no valida rango de precio por ítem.** `selfRegisterAgent` enforcea `pricePerCall >= 1000 && pricePerCall <= 100_000_000` (NA-304), pero `batchSelfRegister` no lo hace. Se puede registrar un agente con precio 0 o >100M vía batch. | `WasiAIMarketplace.sol` — `batchSelfRegister` |
| 4 | MENOR | Cobertura de tests | **Tests de `settleKeyBatch_Graceful` no verifican explícitamente el evento `SettlementSkipped`.** `test_settleKeyBatch_Graceful_SkipsUnregistered` y `test_settleKeyBatch_Graceful_KeyBalanceCorrect` verifican side-effects de balance pero no usan `vm.expectEmit` para confirmar que el evento se emite. Si la línea `emit SettlementSkipped(...)` se elimina, los tests seguirían pasando. | `WasiAIMarketplace.t.sol` — tests `test_settleKeyBatch_Graceful_*` |
| 5 | MENOR | Cobertura de tests | **Función `emergencyWithdrawUSDC` (AC-20, Wave W1.4) no tiene test.** El contrato implementa la función correctamente (solo retira exceso sobre `totalKeyBalances + totalEarnings`), pero el archivo de tests no tiene ningún caso para ella: ni happy path, ni `onlyOwner`, ni `whenPaused`, ni el invariant de solvencia post-withdrawal. | `WasiAIMarketplace.t.sol` — ausente |

---

### Verificación de ACs Críticos (énfasis especial)

#### AC-11 (CRÍTICO): Deducción keyBalance post-loop ✅
La deducción ocurre **después del loop completo** sobre `totalSettled`:
```solidity
// (post-loop)
require(keyBalances[keyId] >= totalSettled, "WasiAI: insufficient key balance");
keyBalances[keyId]  -= totalSettled;
totalKeyBalances    -= totalSettled;
```
`totalSettled` acumula únicamente los amounts de slugs con `creator != address(0)`. Los slugs no registrados no modifican `totalSettled`. Invariant de solvencia preservado. ✅

#### Daily cap post-loop ✅
`_checkAndResetDailyWindow()` + `dailySettledAmount += totalSettled` ocurre **después del loop**, sobre el `totalSettled` real (solo slugs registrados):
```solidity
// (post-loop)
_checkAndResetDailyWindow();
if (dailySettlementCap > 0) {
    require(dailySettledAmount + totalSettled <= dailySettlementCap, "WasiAI: daily cap exceeded");
}
dailySettledAmount += totalSettled;
```
El test `test_settleKeyBatch_DailyCapPostLoop` lo verifica explícitamente (11k skip + 6k settle → no revierte bajo cap de 10k). ✅

#### batchSelfRegister fee calculation (AC-6) — forma ternaria ✅
```solidity
uint256 freeRestantes  = (userCount >= freeRegistrationsPerUser)
    ? 0
    : freeRegistrationsPerUser - userCount;
uint256 feeCount       = (slugs.length > freeRestantes)
    ? slugs.length - freeRestantes
    : 0;
```
Forma ternaria correcta. Sin underflow posible en Solidity 0.8.x. ✅

#### SettlementSkipped — condición correcta ✅
Emitido cuando `agents[slugs[i]].creator == address(0)` (slug no registrado), **no** cuando `amount == 0`. El `require(amounts[i] > 0, "WasiAI: zero amount")` se evalúa **solo para slugs registrados**, después del skip. ✅

#### emergencyWithdrawUSDC — solo exceso ✅
```solidity
uint256 excess = balance - obligated; // balance - (totalKeyBalances + totalEarnings)
usdc.safeTransfer(to, excess);
```
Solo transfiere USDC por encima de las obligaciones. `onlyOwner whenPaused`. ✅

#### DeployV2.s.sol — usa TREASURY_PRIVATE_KEY ✅
```solidity
uint256 deployerKey = vm.envUint("TREASURY_PRIVATE_KEY");
```
Correcto. El script usa el wallet del treasury (creator de los 5 agentes en V1). ✅

---

### Veredicto

**REQUIERE CORRECCIÓN** — 1 bloqueante que el Builder debe corregir antes de merge.

**Finding #1 (BLOQUEANTE):** Agregar detección de duplicados intra-batch en `batchSelfRegister`. Solución sugerida: usar un `mapping(string => bool) memory seen` o un loop O(n²) de pre-validación dado el límite de 50 slugs:
```solidity
// En el pre-check loop existente, agregar detección de intra-batch duplicates:
for (uint256 i = 0; i < slugs.length; i++) {
    require(
        agents[slugs[i]].creator == address(0),
        string(abi.encodePacked("WasiAI: slug taken: ", slugs[i]))
    );
    // Detectar duplicados intra-batch (O(n²), seguro para n<=50)
    for (uint256 j = 0; j < i; j++) {
        require(
            keccak256(bytes(slugs[i])) != keccak256(bytes(slugs[j])),
            string(abi.encodePacked("WasiAI: duplicate slug in batch: ", slugs[i]))
        );
    }
}
```

**Findings MENOR (#2, #3, #4, #5):** Corregir si hay tiempo antes del deploy; no bloquean la funcionalidad core pero generan inconsistencias y huecos de cobertura.
