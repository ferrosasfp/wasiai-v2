# Report — SDD #043: Retiro parcial/total Agent Key
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-04
**Issue:** WAS-141

## Resumen
Se implementó la función `withdrawKey(bytes32 keyId, uint256 amount)` en el contrato WasiAIMarketplace, permitiendo al owner de una Agent Key retirar USDC parcial o totalmente. La función usa `nonReentrant` sin `whenNotPaused` para garantizar que los usuarios siempre puedan retirar sus fondos, y mantiene el invariante de solvencia actualizando `totalKeyBalances`.

En el backend, se creó la ruta `POST /api/agent-keys/[id]/withdraw` que verifica el receipt de la transacción on-chain antes de actualizar la DB. En el frontend, se agregó un WithdrawModal que permite seleccionar monto, firmar la transacción via `eth_sendTransaction` con `encodeFunctionData` de viem, y hacer polling del receipt. Si el balance resultante es ≤ 0, la key se desactiva automáticamente.

## Archivos principales
- `contracts/src/WasiAIMarketplace.sol` (modificado — withdrawKey + KeyWithdrawn event)
- `src/lib/contracts/WasiAIMarketplace.ts` (modificado — ABI entry)
- `src/app/api/agent-keys/route.ts` (modificado — exponer key_hash)
- `src/app/api/agent-keys/[id]/withdraw/route.ts` (nuevo)
- `src/app/[locale]/agent-keys/page.tsx` (modificado — WithdrawModal)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
