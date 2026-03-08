# Work Item #064 — Withdraw Earnings Directo desde Wallet del Creator

| Campo | Valor |
|-------|-------|
| **#** | 064 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Status** | PENDING (awaiting HU_APPROVED) |
| **Objetivo** | Migrar el botón "Withdraw USDC" del creator dashboard para que el creator llame directamente `withdraw()` desde su propia wallet, eliminando la dependencia del operador y el costo de gas en AVAX del operador. |
| **Reglas de negocio** | Solo el creator autenticado puede retirar sus `earnings[msg.sender]`. El contrato ya tiene `withdraw() external nonReentrant` que transfiere `earnings[msg.sender]` al llamante. No se modifica la lógica de acumulación de earnings. |

## Acceptance Criteria

| # | Criterio |
|---|----------|
| AC-1 | WHEN el creator hace clic en "Withdraw USDC", THE UI SHALL solicitar firma de `withdraw()` a la wallet conectada del creator (no al operador) |
| AC-2 | WHEN la transacción es confirmada on-chain, THE sistema SHALL verificar el evento `Withdrawn(address,uint256)` en el receipt antes de actualizar la UI |
| AC-3 | WHEN `receipt.status !== 'success'`, THE sistema SHALL mostrar error y NO actualizar la UI como exitosa |
| AC-4 | WHILE el creator no tiene wallet conectada, THE botón SHALL seguir deshabilitado con texto "No wallet" (sin cambios vs. comportamiento actual) |
| AC-5 | WHEN el creator firma y la tx es exitosa, THE UI SHALL mostrar link al explorador con el txHash de la tx del creator (no del operador) |
| AC-6 | IF `earnings[msg.sender] == 0` on-chain, THEN la tx revertirá en el contrato y THE UI SHALL mostrar el error de revert |
| AC-7 | WHILE se espera confirmación de la tx, THE botón SHALL mostrar estado de carga y no permitir doble-click |

## Scope

**IN:** `WithdrawButton.tsx`, `WITHDRAW_EARNINGS_ABI` en `src/lib/contracts/abis.ts`, `GET /api/creator/withdraw` (solo lectura pending)

**OUT:** `POST /api/creator/withdraw` (desactivar — ya no necesaria), acumulación de earnings, flujo x402, `withdrawFor` en `marketplaceClient.ts`, `creator_profiles` schema, dashboard layout

## Notas
- Contrato ya tiene `withdraw() external nonReentrant` — línea 409 de `WasiAIMarketplace.sol`
- Evento: `Withdrawn(address indexed creator, uint256 amount)` 
- Patrón `writeContract` ya establecido en HU-063 (`WithdrawModal`)
- `WITHDRAW_KEY_ABI` en `abis.ts` es el exemplar a seguir
