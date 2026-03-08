# Report — HU-067: Earnings Voucher Architecture

**Fecha**: 2026-03-08
**Commit final**: `16deb31`
**Contrato Fuji**: `0xf681E3443518cafC6Fa2ff6122bd97Dc9Bf3D17B`
**Status**: DONE

---

## Resumen

Earnings x402 funcionales. El USDC se acredita en Supabase post-invocación exitosa (sin gas). Al retirar, el backend emite un voucher EIP-712 firmado; el creator llama `claimEarnings()` on-chain — el contrato deduce 10% al treasury y envía 90% al creator.

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `contracts/src/WasiAIMarketplace.sol` | EIP712 + claimEarnings() + redeploy |
| `src/lib/contracts/abis.ts` | CLAIM_EARNINGS_ABI |
| `src/app/api/creator/earnings/voucher/route.ts` | NUEVO — firma voucher |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | increment_pending_earnings post-settlement |
| `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` | Flujo voucher completo |
| `src/app/api/creator/withdraw/route.ts` | Verifica EarningsClaimed + zeroes DB |
| `messages/en.json` + `messages/es.json` | dashboard.withdrawRequesting |

## AC Status — 9/9 PASS

## AR / CR
- **AR**: 1 BLOQUEANTE encontrado y corregido (`p_creator_id` → `p_user_id`)
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
| W1 | `p_creator_id` pasado al RPC `increment_pending_earnings` que espera `p_user_id` | Corregido en AR — `p_user_id: model.creator_id` | Siempre verificar nombres de parámetros RPC contra la migración SQL antes de implementar |

## Pendiente para Vercel
- `MARKETPLACE_CONTRACT_ADDRESS` = `0xf681E3443518cafC6Fa2ff6122bd97Dc9Bf3D17B`
- `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` = `0xf681E3443518cafC6Fa2ff6122bd97Dc9Bf3D17B`
