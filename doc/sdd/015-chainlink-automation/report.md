# Report — SDD #015: Chainlink Automation Integration
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-115

## Resumen
Se agregaron las funciones `checkUpkeep` y `performUpkeep` al contrato WasiAIMarketplace para integración con Chainlink Automation. `checkUpkeep` retorna `upkeepNeeded = true` cuando han pasado ≥23 horas desde el último upkeep. `performUpkeep` es un trigger/señal que actualiza `lastUpkeepTimestamp` y emite `UpkeepPerformed` — el settlement real sigue siendo el Vercel cron o el admin panel.

Se redesplegó el contrato en Fuji, se actualizó el ABI en TypeScript con las nuevas funciones, y se agregaron 4 tests nuevos en Foundry. Se documentaron las instrucciones de registro del Upkeep en Chainlink y los pasos de deploy.

## Archivos principales
- `contracts/src/WasiAIMarketplace.sol` (modificado — checkUpkeep, performUpkeep, UpkeepPerformed)
- `contracts/test/WasiAIMarketplace.t.sol` (modificado — 4 tests nuevos)
- `src/lib/contracts/WasiAIMarketplace.ts` (modificado — ABI actualizado)
- `doc/sdd/015-chainlink-automation/deploy-notes.md` (nuevo)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
