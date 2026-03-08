# Work Item #067 — Earnings Voucher Architecture

| Campo | Valor |
|-------|-------|
| **#** | 067 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Reemplazar el flujo de earnings x402 por arquitectura voucher: USDC custodiado on-chain, contabilidad off-chain en Supabase, retiro con voucher firmado por el operador. El creator paga gas solo al retirar. |
| **Reglas de negocio** | El operador no puede retener fondos — una vez emitido el voucher, el creator puede cobrarlo siempre. Anti-doble-gasto via nonce único por voucher. El contrato verifica la firma del operador, no confía en el monto declarado por el cliente. |
| **Scope IN** | Nuevo `claimEarnings()` en contrato + redeploy Fuji · Nuevo `POST /api/creator/earnings/voucher` (firma voucher) · `WithdrawButton` actualizado · Supabase: columna `pending_earnings_usdc` en `creator_profiles` · Actualizar `POST /api/v1/models/[slug]/invoke` para sumar earnings off-chain post-settlement |
| **Scope OUT** | Agent Keys (`withdrawKey`, `keyInvoke`, `refundKeyToEarnings`) — sin cambios · `usdcSettler.ts` — sin cambios · `recordInvocation()` — se conserva en contrato (legacy Agent Keys) · Mainnet deploy · Tests automatizados |

---

## Acceptance Criteria (EARS)

| # | Criterio |
|---|----------|
| AC-1 | WHEN una invocación x402 es exitosa (`settlePaymentDirectly` retorna `verified: true`), THE backend SHALL sumar `price_per_call * 0.9` a `creator_profiles.pending_earnings_usdc` del creator del agente |
| AC-2 | WHEN el creator solicita retirar (`POST /api/creator/earnings/voucher`), THE backend SHALL firmar un voucher EIP-712 con `(creator, amount, deadline, nonce)` usando `OPERATOR_PRIVATE_KEY` y retornarlo al frontend |
| AC-3 | WHEN el creator llama `claimEarnings(amount, deadline, nonce, sig)` on-chain, THE contrato SHALL verificar la firma del operador, marcar el nonce como usado, transferir 90% al `msg.sender` y 10% al treasury |
| AC-4 | IF el nonce del voucher ya fue usado, THEN THE contrato SHALL revertir con `"voucher already used"` |
| AC-5 | IF el voucher expiró (`block.timestamp > deadline`), THEN THE contrato SHALL revertir con `"voucher expired"` |
| AC-6 | WHEN la tx `claimEarnings` es confirmada on-chain, THE backend SHALL poner a 0 `pending_earnings_usdc` del creator |
| AC-7 | WHILE `pending_earnings_usdc == 0`, THE botón "Withdraw USDC →" SHALL estar deshabilitado |
| AC-8 | WHEN `claimEarnings` es exitosa, THE UI SHALL mostrar link al explorer con el txHash |

---

## Propuesta de Waves

### W0 — Serial Gate (contrato + redeploy)
- W0.1: Agregar `claimEarnings()` + `EarningsClaimed` event a `WasiAIMarketplace.sol`
- W0.2: `forge build` pasa, `forge test` pasa
- W0.3: `forge script DeployMarketplace --rpc-url fuji --broadcast`
- W0.4: Actualizar `MARKETPLACE_CONTRACT_ADDRESS` + `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` en `.env.local` y Vercel

### W1 — Parallelizable
- W1.1: Supabase — verificar schema `pending_earnings_usdc` (ya existe en `015_onboarding-fields.sql`); adaptar RPC `increment_pending_earnings` si necesario; nueva migración solo si hay delta
- W1.2: `POST /api/creator/earnings/voucher` — genera y firma voucher (monto bruto)
- W1.3: `POST /api/v1/models/[slug]/invoke` — llamar `increment_pending_earnings(creator_user_id, price_per_call)` post-settlement exitoso

### W2 — Depende de W0 + W1
- W2.1: `WithdrawButton.tsx` — solicitar voucher al API, luego llamar `claimEarnings()` on-chain
- W2.2: `POST /api/creator/withdraw` (verificación post-claim, poner earnings a 0)

### W3 — QG
- tsc + lint + build

---

## Dependencias y Paralelismo

```
W0 (redeploy) → serial gate, todo lo demás depende
W1.1 + W1.2 + W1.3 → paralelas entre sí, requieren W0 completo
W2.1 + W2.2 → requieren W0 + W1
W3 → final
```

---

## Decisiones de diseño clave

**D-1: Digest del voucher**
```solidity
bytes32 digest = keccak256(abi.encodePacked(
    "\x19\x01",
    domainSeparator,
    keccak256(abi.encode(
        CLAIM_TYPEHASH,
        msg.sender,   // creator address
        amount,       // USDC atomics
        deadline,     // unix timestamp
        nonce         // bytes32 único
    ))
));
```

**D-2: `pending_earnings_usdc` en Supabase — monto BRUTO**
- `invoke route` suma `price_per_call` (monto bruto, 100%) a `pending_earnings_usdc` después de settlement exitoso
- Usar RPC `increment_pending_earnings(user_id, amount)` ya existente en `015_onboarding-fields.sql` — atómico, sin race condition
- El contrato deduce el split en `claimEarnings`: `platformShare = amount * platformFeeBps / 10_000` → treasury; `creatorShare = amount - platformShare` → creator
- `platformFeeBps = 1000` → creator recibe 90%, treasury 10% — igual que `recordInvocation`
- W1.1 NO crea la columna (ya existe) — solo verifica schema y adapta uso del RPC

**D-3: Protección del balance del contrato**
```solidity
// Asegurar que claimEarnings no drene los keyBalances de Agent Keys
require(
    usdc.balanceOf(address(this)) - totalKeyBalances >= amount,
    "WasiAI: insufficient free balance"
);
```

**D-4: `nonce` del voucher**
- Generado por el backend: `keccak256(abi.encodePacked(creator, block.timestamp, random))`
- Guardado en Supabase junto con `deadline` para auditoría

**D-5: `deadline` del voucher**
- 1 hora desde emisión — suficiente para que el creator firme

---

## Decisiones resueltas (SAR F1)

| # | Decisión | Resolución |
|---|----------|------------|
| B-1 | Split en contrato vs backend | **Opción A** — `claimEarnings` deduce 10% treasury on-chain, voucher es monto bruto |
| M-1 | `pending_earnings_usdc` ya existe en DB | W1.1 adaptado — verificar, no recrear |
| M-2 | $10.01 USDC en contrato `0xA8b463...` tras redeploy | Documentado — tolerable en Fuji testnet; fondos recuperables con `withdrawFor` operador |
| M-3 | Race condition en `pending_earnings_usdc` | Resuelto — usar RPC `increment_pending_earnings` (atómico en PostgreSQL) |

## Missing Inputs
- Ninguno
