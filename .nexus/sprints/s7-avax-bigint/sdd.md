# SDD #S7-01: avaxBalance BigInt serialization fix

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/s7-01-avax-bigint

## 1. Resumen
`avaxBalance` muestra `0` en `/api/admin/status` porque `getBalance()` de viem retorna `BigInt` y JSON.stringify serializa BigInt como `0`. La línea `Number(avaxBalanceRaw) / 1e18` ya existe (línea 66) pero el problema es que `avaxBalanceRaw` llega como `0n` desde el `Promise.all` — posiblemente el `.catch(() => 0n)` está disparando.

## 2. Work Item
| Campo | Valor |
|-------|-------|
| **#** | S7-01 |
| **Tipo** | bugfix |
| **Objetivo** | Mostrar balance AVAX real del operator wallet en admin/status |
| **Scope IN** | `src/app/api/admin/status/route.ts` |
| **Scope OUT** | Todo lo demás |

## 3. Reproducción
1. `GET /api/admin/status` con `Authorization: Bearer <ADMIN_SECRET>`
2. Response: `{ "avaxBalance": 0, "avaxBalanceLow": true }`
3. Real: `eth_getBalance(0x46140A86...)` → ~1.0 AVAX

## 4. Context Map
| Archivo | Hallazgo |
|---------|----------|
| `src/app/api/admin/status/route.ts` línea 37 | `.catch(() => 0n)` — si RPC falla, retorna 0n silenciosamente. También posible que OPERATOR_ADDRESS env var no esté seteada en Vercel |

## 5. Análisis de causa raíz
Dos causas posibles:
1. `OPERATOR_ADDRESS` no está en env vars de Vercel → `undefined` → `getBalance({ address: undefined })` → excepción → `.catch(() => 0n)` → 0
2. `NEXT_PUBLIC_RPC_MAINNET` no está en env vars → `http('')` → timeout → catch → 0n

**Fix:** Loguear el error en el catch para saber cuál es, y añadir fallback explícito con mensaje en response.

## 6. Fix propuesto
```typescript
// Línea 37 — cambiar:
? client.getBalance({ address: OPERATOR_ADDRESS }).catch(() => 0n)
// por:
? client.getBalance({ address: OPERATOR_ADDRESS as `0x${string}` }).catch((err) => {
    logger.warn('[admin/status] getBalance failed', { err: String(err).slice(0, 200), address: OPERATOR_ADDRESS })
    return 0n
  })
```
Además añadir al response: `avaxBalanceError: avaxBalanceRaw === 0n && IS_MAINNET ? 'check_rpc_or_address' : null`

## 7. Acceptance Criteria
1. WHEN `GET /api/admin/status` is called with valid auth, THE `avaxBalance` SHALL reflect the real on-chain balance (≥ 0.9 in mainnet).
2. IF `getBalance` fails, THE response SHALL include `avaxBalanceError: 'check_rpc_or_address'` instead of silently showing 0.

## 8. Constraint Directives
### PROHIBIDO
- NO cambiar la lógica de auth
- NO modificar x402_health
- Solo tocar el bloque de avaxBalance

---
*SDD — BUGFIX | Sprint 7*
