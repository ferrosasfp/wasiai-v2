# Report — HU-064: Withdraw Earnings Directo desde Wallet del Creator

**Fecha**: 2026-03-08
**Commit**: `c15b0b8`
**Branch**: `main`
**Status**: DONE

---

## Resumen

Reemplazado el flujo de retiro de earnings del creator: el operador ya no interviene. El creator firma directamente `withdraw()` en `WasiAIMarketplace.sol` desde su wallet. El API solo verifica el evento `Withdrawn` on-chain antes de confirmar.

## Archivos Modificados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/lib/contracts/abis.ts` | Modificado | `WITHDRAW_EARNINGS_ABI` agregado |
| `src/app/api/creator/withdraw/route.ts` | Modificado | POST reescrito: recibe `txHash`, verifica evento `Withdrawn` |
| `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` | Modificado | Reescrito: `writeContract` + estados + i18n |
| `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Modificado | Prop `walletAddress` agregada |
| `messages/en.json` | Modificado | 5 claves `dashboard.withdraw*` |
| `messages/es.json` | Modificado | 5 claves `dashboard.withdraw*` |

## AC Status

| AC | Resultado | Evidencia |
|----|-----------|-----------|
| AC1 | ✅ PASS | `WithdrawButton.tsx:54` |
| AC2 | ✅ PASS | `route.ts:87-101` |
| AC3 | ✅ PASS | `route.ts:77-80` |
| AC4 | ✅ PASS | `WithdrawButton.tsx:37-45` |
| AC5 | ✅ PASS | `WithdrawButton.tsx:83-92` |
| AC6 | ✅ PASS | `handleWithdraw` catch block |
| AC7 | ✅ PASS | `isDisabled` + `animate-pulse` |

## AR / CR

- **AR**: 0 BLOCKERs · 1 MENOR cosmético (orden de constantes en abis.ts)
- **CR**: APPROVED

## Quality Gates

| Gate | Resultado |
|------|-----------|
| `tsc --noEmit` | ✅ |
| `lint --max-warnings 0` | ✅ |
| `npm run build` | ✅ |

## Auto-Blindaje

| Wave | Error | Fix | Aplicar en |
|------|-------|-----|-----------|
| W1 | `snowscanTx` importado en API route pero no usado en POST (solo en GET) | Eliminado del import del POST — permanece en GET via `marketplaceClient` | Verificar imports no usados antes de lint en futuros routes |

## Decisiones Clave

- `WITHDRAWN_TOPIC` hardcodeado (mismo patrón que `KEY_WITHDRAWN_TOPIC`)
- Ownership check: `topics[1]?.slice(-40)` vs `walletAddress.toLowerCase().slice(-40)` — equivalente a prefijo `0x`
- `realAmount` extraído de `log.data` — no se confía en el cliente
- `snowscanTx()` de `@/lib/chain` — no se construye URL a mano
