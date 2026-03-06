# Report — SDD #020: NA-H01 Solvency Fix + NA-M03 Fee Timelock
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-75

## Resumen
Se resolvieron dos limitaciones conocidas del NexusAudit. NA-H01 (HIGH): se agregaron contadores globales `totalKeyBalances` y `totalEarnings` como invariante de solvencia, con una función pública `checkSolvency()` que verifica que el contrato siempre tenga suficiente USDC para todas sus obligaciones. Cada función que mueve USDC actualiza ambos contadores correctamente.

NA-M03 (MEDIUM): se reemplazó `setPlatformFee` por un patrón propose/execute/cancel con timelock de 48 horas (`proposeFee`, `executeFee`, `cancelFee`), protegiendo a los usuarios de cambios de fee entre depósito y settlement. Se invirtieron los tests de PoC del NexusAudit confirmando que ambos ataques ya no son ejecutables.

## Archivos principales
- `contracts/src/WasiAIMarketplace.sol` (modificado — solvency counters + fee timelock)
- `contracts/test/WasiAIMarketplace.t.sol` (modificado — tests de solvencia y timelock)
- `contracts/test/NexusAuditValidation.t.sol` (modificado — PoC invertidos NA-H01 y NA-M03)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
