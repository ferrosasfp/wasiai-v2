## Spec Review — SDD #WAS-216

> Revisado por: Spec Reviewer (NexusAgil v1.3)
> Fecha: 2026-03-16
> SDD: Nuevo contrato WasiAIMarketplace V2

---

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `batchSelfRegister` NO existe en V1 (solo `selfRegisterAgent`). `settleKeyBatch` en V1 revierte en slug no registrado (`require(agent.creator != address(0), "WasiAI: agent not found")`). `SettlementSkipped` NO existe. `ReputationRecord` en V1 solo tiene 3 campos. Ningún cambio propuesto está ya implementado. |
| 0.2 Archivos existen | ✅ PASS | `contracts/src/WasiAIMarketplace.sol` ✅ (935 líneas). `contracts/test/WasiAIMarketplace.t.sol` ✅. `contracts/script/Deploy.s.sol` ✅. `contracts/script/DeployV2.s.sol` ❌ (a crear — correcto según scope). |
| 0.3a Tipos correctos | ⚠️ RISK | Ver Finding #3: la nueva firma de `submitReputationBatch` cambia de 3 arrays a 6 arrays — rompe el ABI existente. No es un error (es intencional) pero el SDD no documenta explícitamente que el ABI cambia y que los callers del operador deben actualizarse. |
| 0.3b Encoding correcto | ✅ PASS | `event SettlementSkipped(bytes32 indexed keyId, string slug, uint256 amount)` — formato consistente con `KeyCallSettled` existente (slug no-indexed en ambos). Sin conflictos de encoding. |
| 0.3c Seguridad contratos | ❌ FAIL | Ver Findings #1 (daily cap missing en nuevo flujo) y #2 (underflow en fee pseudocode). |
| 0.4 Dependencias | ✅ PASS | SDD declara "Ninguna. Es el bloqueo de WAS-217 y WAS-218." Correcto — WAS-217/218 dependen de este, no al revés. |
| 0.5 Completitud | ❌ FAIL | Ver Finding #4 (AC numbers desconectados de Wave plan) y #5 (daily cap omitido en NUEVO FLUJO). |

---

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ❌ FAIL | Wave plan referencia "ACs 21-25, AC-26, ACs 27-28" pero el SDD define ACs numerados 1-11. No coinciden. AC-9 (submitReputationBatch 6 campos) y AC-10 (whenPaused) no tienen wave de test correspondiente. AC-27 y AC-28 referenciados en W2.3 no están definidos en el SDD. |
| Build gates | ✅ PASS | Wave 1 tiene BUILD GATE: `forge build`. Wave 2 tiene BUILD GATE: `forge test`. |
| Rollback | ⚠️ MENOR | Rollback existe pero no es concreto: "Revertir env var" no especifica el comando Vercel CLI. La dirección del contrato V1 actual tampoco está documentada. |
| Constraints | ✅ PASS | 6 PROHIBIDO documentados, todos específicos. OBLIGATORIO con detalles concretos. |

---

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | **BLOQUEANTE** | **Daily cap check omitido en NUEVO FLUJO de settleKeyBatch.** El SDD describe 6 pasos para el nuevo flujo post-loop, pero no menciona dónde va el `_checkAndResetDailyWindow()` ni el `dailySettledAmount += totalSettled`. En V1 el cap se verifica y acumula ANTES de deducir balances. En la nueva lógica post-loop, el cap solo se puede verificar DESPUÉS de computar `totalSettled`. El SDD dice en la sección Riesgos "Daily cap check falla post-loop" pero no da la solución. El Builder tendría que improvisar la posición de este check. | Agregar paso explícito entre el paso 3 y 4 del NUEVO FLUJO: `3b. _checkAndResetDailyWindow(); require(dailySettledAmount + totalSettled <= dailySettlementCap); dailySettledAmount += totalSettled;` |
| 2 | **BLOQUEANTE** | **Underflow en pseudocode de batchSelfRegister fee calculation.** El SDD especifica: `freeRegistrationsRestantes = max(0, freeRegistrationsPerUser - userRegistrationCount[msg.sender])`. En Solidity 0.8.x la aritmética es checked por defecto. Si `userRegistrationCount[msg.sender] > freeRegistrationsPerUser`, la resta `freeRegistrationsPerUser - userRegistrationCount[msg.sender]` revertirá con underflow ANTES de que el `max(0, ...)` pueda actuar. El pseudocode es semánticamente correcto pero técnicamente peligroso — el Builder que lo implemente literalmente con `uint256` producirá un bug. | Cambiar pseudocode a: `freeRestantes = (userCount >= freeRegistrationsPerUser) ? 0 : freeRegistrationsPerUser - userCount;` seguido de `feeCount = (slugs.length > freeRestantes) ? slugs.length - freeRestantes : 0;` |
| 3 | **BLOQUEANTE** | **AC numbering desconectado del Wave plan.** W2.1 referencia "ACs 21-25", W2.2 referencia "AC-26", W2.3 referencia "ACs 27-28". Los ACs del SDD están numerados 1-11. Los números 21-28 no existen. El Builder no puede saber qué tests cubren qué ACs. Adicionalmente: AC-9 (submitReputationBatch con 6 campos) y AC-10 (whenPaused en batchSelfRegister/depositForKey/settleKeyBatch/recordInvocation) no tienen wave de test asignada. W2.3 menciona "setAgentPrice" que no aparece en ningún AC. | Corregir numeración en Wave plan: W2.1→ACs 1-5, W2.2→ACs 6-8, agregar W2.4 para AC-9 (submitReputationBatch), agregar AC-9 y AC-10 a W2.x con tests explícitos. Eliminar "setAgentPrice" de W2.3 o agregar el AC correspondiente. |
| 4 | **MENOR** | **W1.4 sin AC correspondiente (scope creep).** Wave 1 incluye "W1.4: Agregar `emergencyWithdrawUSDC(address to) onlyOwner whenPaused`" pero ningún AC en el SDD cubre esta función. Es scope creep no documentado en el contrato de aceptación. | Agregar AC-12 que especifique el comportamiento de `emergencyWithdrawUSDC`, o mover W1.4 a scope OUT. |
| 5 | **MENOR** | **DeployV2.s.sol: env var del signer no especificada.** El SDD dice en un comentario "msg.sender = treasury wallet que los registró en V1" pero no especifica qué env var debe usarse en el script (el exemplar `Deploy.s.sol` usa `OPERATOR_PRIVATE_KEY`). El treasury wallet es `0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967`. Si el Builder sigue el exemplar literalmente y usa `OPERATOR_PRIVATE_KEY`, los agentes quedarían registrados con `msg.sender = operator`, NO con `msg.sender = treasury` — rompiendo AC-11 (verificables via `getAgent(slug)`). | Agregar al script pseudocode: `uint256 deployerKey = vm.envUint("TREASURY_PRIVATE_KEY"); // MUST be 0xBF9554... wallet` |
| 6 | **MENOR** | **Rollback incompleto.** "Revertir env var" no es ejecutable. No hay comando Vercel CLI ni dirección del contrato V1 actual documentada. | Agregar: dirección del contrato V1 en mainnet, comando concreto `vercel env add NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET [V1_address]`. |
| 7 | **INFORMATIVO** | **Solvency invariant post-loop es correcto.** La pregunta era si mover el `require(keyBalances[keyId] >= totalSettled)` al final del loop es seguro ante reentrancy. Respuesta: SÍ, es seguro. El contrato usa `nonReentrant` (ReentrancyGuard de OZ), el mutex se activa al inicio de la función. Durante el loop no hay external calls (solo state reads/writes a `earnings` y contadores). El único external call es `safeTransfer(treasury, ...)` que ocurre DESPUÉS de que todos los state changes están completos. El post-loop design es más correcto que el pre-loop para el caso graceful porque el total real solo se conoce al terminar el loop. |  |

---

### Veredicto

**NECESITA CORRECCIÓN**

Bloqueantes a resolver antes de SPEC_APPROVED:
1. **Finding #1**: Agregar daily cap check explícito en NUEVO FLUJO de settleKeyBatch (entre paso 3 y 4)
2. **Finding #2**: Corregir pseudocode de fee calculation para evitar underflow en Solidity 0.8.x
3. **Finding #3**: Corregir AC numbering en Wave plan (1-11 no 21-28), agregar waves para AC-9 y AC-10

Los findings #4, #5, #6 son menores pero #5 en particular podría causar que los agentes queden registrados con el wallet incorrecto — se recomienda resolverlo antes de que el Builder escriba el script.

---

*Revisión realizada contra WasiAIMarketplace.sol V1 (935 líneas), Deploy.s.sol, y SDD completo WAS-216.*
