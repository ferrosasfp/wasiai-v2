# Report — SDD #030: refundExpired() trustless en WasiEscrow
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-03
**Issue:** WAS-118

## Resumen
Se implementó la función `refundExpired()` en el contrato WasiEscrow, cerrando el gap de trustlessness donde el payer no podía recuperar fondos sin intervención del operador. La nueva función permite que cualquier persona (trustless) dispare el refund al payer después de 24 horas (`RELEASE_TIMEOUT`) si el escrow sigue en estado `Pending`. Sigue el patrón CEI (Check-Effect-Interaction) consistente con `releaseExpired()` y `refundEscrow()`, usando modifiers `nonReentrant`, `escrowExists`, `isPending` y un `require` de timeout.

## Archivos principales
- `contracts/src/WasiEscrow.sol` — nueva función `refundExpired()`
- Tests del contrato verificando el path trustless de refund

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
