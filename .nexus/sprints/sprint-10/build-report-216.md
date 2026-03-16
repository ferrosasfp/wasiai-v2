# Build Report — SDD #WAS-216

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | ✅ PASS | Baseline: forge build OK, forge test 121/121 passing |
| Wave 1 | ✅ DONE | ✅ PASS | `contracts/src/WasiAIMarketplace.sol` — batchSelfRegister + SettlementSkipped event + settleKeyBatch graceful + ReputationRecord extendido + emergencyWithdrawUSDC |
| Wave 2 | ✅ DONE | ✅ PASS | `contracts/test/WasiAIMarketplace.t.sol` — 19 nuevos tests, 140/140 passing |
| Wave 3 | ✅ DONE | ✅ PASS | `contracts/script/DeployV2.s.sol` — deploy + batchSelfRegister 5 agentes; build OK |

## Commit

- Hash: `b14686778`
- Message: `feat(WAS-216): marketplace V2 — batchSelfRegister + graceful settleKeyBatch + ReputationRecord extended`
- Files changed: 3
  - `contracts/src/WasiAIMarketplace.sol` (modificado)
  - `contracts/test/WasiAIMarketplace.t.sol` (modificado)
  - `contracts/script/DeployV2.s.sol` (creado)

## Discrepancias encontradas

- **Wave 1 / Wave 2**: Los tests existentes de `submitReputationBatch` y `getReputation` usaban la firma antigua de 3 parámetros. Al cambiar la firma del contrato a 6 parámetros (según el SDD), esos tests dejaban de compilar. Solución: se adaptaron los tests existentes a la nueva firma (no se borraron, se actualizaron). El SDD dice "no borrar tests existentes" — interpretado como "no eliminar funciones de test", lo cual se respetó.

## Cambios implementados

### WasiAIMarketplace.sol (V2)

1. **`SettlementSkipped` event** — nuevo evento emitido cuando `settleKeyBatch` skipea un slug no registrado
2. **`batchSelfRegister`** — nueva función para registrar hasta 50 agentes en una sola tx; con fee tier, pre-check atómico de slugs, ternary para evitar underflow
3. **`settleKeyBatch` refactor** — lógica post-loop graceful: skipea slugs no registrados (emit `SettlementSkipped`), deducción de `keyBalances` sobre `totalSettled` (no pre-loop total), daily cap check post-loop
4. **`ReputationRecord` struct extendido** — agrega `totalCalls`, `successCalls`, `disputeCount`, `avgResponseMs`; elimina `voteCount`
5. **`submitReputationBatch`** — nueva firma con 6 params (slugs, avgRatings, totalCalls, successCalls, disputeCounts, avgResponseMs)
6. **`getReputation`** — retorna 6 campos del nuevo struct
7. **`emergencyWithdrawUSDC(address to)`** — `onlyOwner whenPaused`; transfiere solo el exceso sobre `totalKeyBalances + totalEarnings`

### Tests nuevos (19 tests WAS-216)

- W2.1: `test_batchSelfRegister_EmptyBatch_Reverts` (AC-1)
- W2.1: `test_batchSelfRegister_ArrayLengthMismatch_Reverts` (AC-2)
- W2.1: `test_batchSelfRegister_TooLarge_Reverts` (AC-3)
- W2.1: `test_batchSelfRegister_SlugTaken_Reverts` (AC-4)
- W2.1: `test_batchSelfRegister_HappyPath_EmitsEvents` (AC-5)
- W2.1: `test_batchSelfRegister_FeeCalculation_FreeTierExhausted`
- W2.1: `test_batchSelfRegister_WhenPaused_Reverts`
- W2.1: `test_batchSelfRegister_AllFreeNoFeeCharged`
- W2.2: `test_settleKeyBatch_Graceful_SkipsUnregistered` (AC-6)
- W2.2: `test_settleKeyBatch_Graceful_KeyBalanceCorrect` (AC-8)
- W2.2: `test_settleKeyBatch_DailyCapPostLoop`
- W2.2: `test_settleKeyBatch_Graceful_AllSkipped_ZeroDeducted`
- W2.3: `test_solvency_AfterSettleWithSkip`
- W2.3: `test_solvency_AfterBatchSelfRegisterWithFee`
- W2.4: `test_submitReputationBatch_AllSixFieldsWritten` (AC-9)
- W2.5: `test_whenPaused_batchSelfRegister_Reverts` (AC-10)
- W2.5: `test_whenPaused_depositForKey_Reverts` (AC-10)
- W2.5: `test_whenPaused_settleKeyBatch_Reverts` (AC-10)
- W2.5: `test_whenPaused_recordInvocation_Reverts` (AC-10)

### DeployV2.s.sol

- Usa `vm.envUint("TREASURY_PRIVATE_KEY")` (no `OPERATOR_PRIVATE_KEY`) — per SDD crítico
- Deploy V2 → setOperator → batchSelfRegister 5 agentes WasiAI → verify via getAgent

## Notas para Auditor/QA

1. **Invariant solvencia**: los tests `test_solvency_AfterSettleWithSkip` y `testFuzz_Solvency_AlwaysHolds` cubren el invariant. La lógica post-loop de `settleKeyBatch` preserva el invariant porque `totalKeyBalances -= totalSettled` (solo lo realmente procesado).
2. **Reentrancy**: `settleKeyBatch` usa `nonReentrant`. El único external call (safeTransfer al treasury) ocurre post-loop, después de actualizar todos los estados.
3. **Fuji testnet deploy (W3.2) y mainnet deploy (W3.3)**: fuera del scope del Builder — requieren llaves privadas reales. El script está listo para ejecutarse.
4. **Update Vercel env var (W3.4)**: fuera del scope del Builder — requiere acceso al dashboard Vercel.
5. **Tests de AC-7 (empty batch reverts)**: cubierto por el test existente `test_SettleKeyBatch_EmptyBatch` que sigue pasando.
6. **getReputation signature cambió**: de 3 returns a 6. Esto es intencional por el cambio de struct. Cualquier cliente off-chain que llame `getReputation` necesitará actualizar su ABI.
