# Work Item #056 — Retiro de Agent Key vía Operador

> Fecha: 2026-03-07
> Tipo: bugfix
> SDD_MODE: full
> Branch: fix/056-withdraw-via-operator

---

## Work Item

| Campo | Valor |
|-------|-------|
| **#** | 056 |
| **Tipo** | bugfix |
| **SDD_MODE** | full |
| **Objetivo** | Corregir el flujo de retiro de Agent Key. El contrato desplegado en Fuji (`0xe3250...`) no incluye `withdrawKey(bytes32,uint256)` en su bytecode. Migrar a `refundKeyToEarnings` + `withdrawFor` ejecutadas por el operador server-side. |
| **Root Cause** | SDD-043 definió `withdrawKey` en source pero el contrato no fue redesplantado. El selector `0x55665727` no existe en bytecode on-chain. |
| **Scope IN** | `withdraw/route.ts`, `WithdrawModal` en `page.tsx`, `marketplaceClient.ts` |
| **Scope OUT** | Redespliegue del contrato, retiros parciales, `CloseKeyModal` |
| **Missing Inputs** | Verificar si `keyRow` tiene `owner_address` (W0.2) |

---

## Gates

| Gate | Estado |
|------|--------|
| **Gate 1** | HU_APPROVED — 2026-03-07 |
| **Gate 2** | SPEC_APPROVED — pendiente |
