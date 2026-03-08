# Work Item #063 — withdrawKey directo + redeploy WasiAIMarketplace

> Fecha: 2026-03-07 · Tipo: feature + ops · SDD_MODE: full
> Branch: feat/063-withdraw-key-direct · SPEC_APPROVED: 2026-03-07

## Objetivo
Redesplegar `WasiAIMarketplace` con `withdrawKey(bytes32,uint256)` activo.
Migrar `WithdrawModal` para que el usuario llame el contrato directamente desde su wallet,
habilitando retiros parciales y eliminando dependencia del operador para retirar.

## Acceptance Criteria

AC-1: WHEN el usuario abre WithdrawModal, THEN puede ingresar monto entre 0.01 y balance disponible.
AC-2: WHEN confirma el retiro, THEN su wallet firma withdrawKey(keyId, amount) directamente — USDC llega en la misma tx.
AC-3: WHEN la tx es confirmada, THEN el servidor lee evento KeyWithdrawn del receipt para obtener el monto real. NO confía en amount del body.
AC-4: WHEN balance post-retiro > 0, THEN is_active permanece true.
AC-5: WHEN balance post-retiro = 0, THEN is_active = false.
AC-6: IF usuario intenta retirar más del balance, THEN contrato revierte y UI muestra error claro.
AC-7: WHEN contrato redesplegado, THEN flujos existentes (depositKey, x402) siguen funcionando.
AC-8: WHEN usuario abre WithdrawModal, THEN UI muestra aviso gas AVAX (~0.001 AVAX).

## Gates
| Gate | Estado |
|------|--------|
| HU_APPROVED | 2026-03-07 |
| SPEC_APPROVED | 2026-03-07 |
