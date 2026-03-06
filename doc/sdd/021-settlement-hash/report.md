# Report — SDD #021: Settlement Hash On-Chain
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-38

## Resumen
Se implementó un sistema de hash determinístico para hacer el settlement off-chain verificable on-chain (finding SHK-01 del NexusAudit). Se agregó una función view `computePaymentId` al contrato que calcula `keccak256(abi.encodePacked(slug, payer, amount, nonce, chainId))`, permitiendo a cualquier auditor externo recalcular el hash y correlacionar eventos on-chain con registros off-chain.

En el backend, se creó `computePaymentId.ts` usando viem para generar el hash de forma determinística antes de llamar a `recordInvocation`. El nonce aleatorio se almacena en Supabase junto al registro de invocación. No se modificó el ABI de `recordInvocation` — la verificación es off-chain verificable.

## Archivos principales
- `contracts/src/WasiAIMarketplace.sol` (modificado — función view `computePaymentId`)
- `contracts/test/WasiAIMarketplace.t.sol` (modificado — tests de determinismo)
- `src/lib/payments/computePaymentId.ts` (nuevo)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
