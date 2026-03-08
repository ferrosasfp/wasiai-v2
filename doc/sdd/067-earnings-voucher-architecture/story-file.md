# Story File — #067: Earnings Voucher Architecture

> SDD: doc/sdd/067-earnings-voucher-architecture/sdd.md
> Fecha: 2026-03-08
> Branch: feat/067-earnings-voucher-architecture

---

## Goal

Hacer funcionales los earnings x402: contabilidad off-chain en Supabase (sin gas por invocación) + nueva función `claimEarnings()` en el contrato que verifica un voucher firmado por el operador, deduce 10% al treasury on-chain, y transfiere 90% al creator. El creator paga gas una sola vez al retirar.

## Acceptance Criteria (EARS)

1. WHEN x402 settlement exitoso Y `result.status === 'success'`, THE invoke route SHALL llamar `increment_pending_earnings(model.creator_id, creatorPrice)` via RPC Supabase
2. WHEN creator solicita voucher (`POST /api/creator/earnings/voucher`), THE backend SHALL firmar voucher EIP-712 y retornar `{ grossAmountAtomics, deadline, nonce, signature }`
3. WHEN creator llama `claimEarnings(grossAmount, deadline, nonce, sig)`, THE contrato SHALL verificar firma operador, enviar 90% al `msg.sender`, 10% al treasury, marcar nonce usado
4. IF nonce ya usado, THEN THE contrato SHALL revertir `"WasiAI: voucher already used"`
5. IF `block.timestamp > deadline`, THEN THE contrato SHALL revertir `"WasiAI: voucher expired"`
6. IF `balanceOf(this) - totalKeyBalances < grossAmount`, THEN THE contrato SHALL revertir `"WasiAI: insufficient free balance"`
7. WHEN `claimEarnings` confirmada, THE backend SHALL poner `pending_earnings_usdc = 0` para ese creator
8. WHILE `pending_earnings_usdc == 0`, THE botón "Withdraw USDC →" SHALL estar deshabilitado
9. WHEN `claimEarnings` exitosa, THE UI SHALL mostrar link al explorer con txHash

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `contracts/src/WasiAIMarketplace.sol` | Modificar | Agregar imports ECDSA+EIP712, herencia EIP712, constructor EIP712 init, storage `usedVouchers`, event `EarningsClaimed`, función `claimEarnings()` | Misma función `recordInvocation()` (líneas 360-401) |
| 2 | `src/lib/contracts/abis.ts` | Modificar | Agregar `CLAIM_EARNINGS_ABI` después de `WITHDRAW_EARNINGS_ABI` | `WITHDRAW_EARNINGS_ABI` en mismo archivo |
| 3 | `src/app/api/creator/earnings/voucher/route.ts` | Crear | `POST`: auth + leer pending_earnings_usdc + firmar voucher EIP-712 | `src/app/api/agent-keys/[id]/withdraw/route.ts` |
| 4 | `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Insertar `increment_pending_earnings` post-logCall (línea ~477), solo si `result.status === 'success'` | Patrón `triggerAgentEvent` fire-and-forget línea ~480 |
| 5 | `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` | Modificar | Nuevo flujo: fetch voucher → `writeContract(claimEarnings)` → `waitForTransactionReceipt` → POST withdraw | `WithdrawButton.tsx` actual (HU-064) |
| 6 | `src/app/api/creator/withdraw/route.ts` | Modificar | `POST`: recibir `{ txHash }`, verificar evento `EarningsClaimed` on-chain, poner `pending_earnings_usdc = 0` | Mismo archivo (patrón verificación receipt existente) |
| 7 | `messages/en.json` | Modificar | Agregar clave `dashboard.withdrawRequesting` | Claves `dashboard.withdraw*` existentes |
| 8 | `messages/es.json` | Modificar | Agregar clave `dashboard.withdrawRequesting` | Claves `dashboard.withdraw*` existentes |

## Exemplars

### Exemplar 1: `recordInvocation()` — patrón para `claimEarnings()` en Solidity
**Archivo**: `contracts/src/WasiAIMarketplace.sol` líneas 360–401
**Usar para**: Archivo #1
**Patrón clave**:
```solidity
// Anti-replay
require(!usedPaymentIds[paymentId], "WasiAI: payment already recorded");
usedPaymentIds[paymentId] = true;

// Split
uint256 platformShare = (amount * platformFeeBps) / 10_000;
uint256 creatorShare  = amount - platformShare;

// Transfers
usdc.safeTransfer(msg.sender, creatorShare);
if (platformShare > 0) usdc.safeTransfer(treasury, platformShare);

emit AgentInvoked(...);
```

### Exemplar 2: `WITHDRAW_EARNINGS_ABI` — patrón para `CLAIM_EARNINGS_ABI`
**Archivo**: `src/lib/contracts/abis.ts`
**Usar para**: Archivo #2
**Patrón clave**:
```typescript
export const WITHDRAW_EARNINGS_ABI = [
  {
    name:            'withdraw',
    type:            'function' as const,
    inputs:          [],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
```
`CLAIM_EARNINGS_ABI` tiene 4 inputs: `grossAmount uint256`, `deadline uint256`, `nonce bytes32`, `sig bytes`.

### Exemplar 3: `agent-keys/[id]/withdraw/route.ts` — patrón para voucher route
**Archivo**: `src/app/api/agent-keys/[id]/withdraw/route.ts`
**Usar para**: Archivo #3
**Patrón clave**:
- `validateCsrf(req)` → auth → Supabase profile
- `createPublicClient({ chain, transport: http(rpcUrl) })`
- Retry 3× con `await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))`
- `receipt.logs.find(l => l.topics[0] === TOPIC && l.address === contract)`
- `log.topics[N]?.slice(-40)` para address indexada

### Exemplar 4: `triggerAgentEvent` — patrón fire-and-forget para `increment_pending_earnings`
**Archivo**: `src/app/api/v1/models/[slug]/invoke/route.ts` línea ~480
**Usar para**: Archivo #4
**Patrón clave**:
```typescript
// Fire-and-forget — never await, never blocks TTFB
if (model.creator_id) {
  void triggerAgentEvent(...).catch(() => { /* non-fatal */ })
}
```
Para earnings usar mismo patrón: `void supabase.rpc(...).catch(err => logger.error(...))`

### Exemplar 5: `WithdrawButton.tsx` (HU-064) — patrón para flujo voucher
**Archivo**: `src/app/[locale]/creator/dashboard/WithdrawButton.tsx`
**Usar para**: Archivo #5
**Patrón clave**:
```typescript
const { writeContract } = useUnifiedWalletClient()
const [status, setStatus] = useState<'idle'|'signing'|'confirming'|'success'|'error'>('idle')

// Agregar estado nuevo: 'requesting' (antes de 'signing')
// Flujo: idle → requesting → signing → confirming → success/error

const hash = await writeContract({
  address: MARKETPLACE_ADDRESS as `0x${string}`,
  abi:     CLAIM_EARNINGS_ABI,
  functionName: 'claimEarnings',
  args: [BigInt(grossAmountAtomics), BigInt(deadline), nonce as `0x${string}`, sig as `0x${string}`],
  chainId: CHAIN_ID,
})
```

## Contrato de Integración ⚠️ BLOQUEANTE

### WithdrawButton → POST /api/creator/earnings/voucher

**Request:** `{}` (body vacío — amount viene de Supabase)

**Response exitoso (200):**
```json
{
  "grossAmountAtomics": 10000,
  "grossAmountUsdc":    0.01,
  "deadline":           1741440000,
  "nonce":              "0xabc123...32bytes",
  "signature":          "0xdef456...65bytes"
}
```

**Errores:**
| HTTP | Cuándo |
|------|--------|
| 401 | No autenticado |
| 400 | `pending_earnings_usdc <= 0` |
| 400 | `wallet_address` no configurada |
| 500 | Fallo al firmar |

---

### WithdrawButton → POST /api/creator/withdraw

**Request:** `{ "txHash": "0x..." }`

**Response exitoso (200):** `{ "ok": true, "realAmount": 0.009 }`

**Errores:**
| HTTP | Cuándo |
|------|--------|
| 400 | Tx no encontrada / revertida / evento no encontrado |
| 403 | Creator en evento ≠ wallet_address autenticada |

## Constraint Directives

### OBLIGATORIO
- `claimEarnings()` usa `require(operators[signer])` — NO `require(signer == operator)` (patrón del contrato)
- Constructor: `EIP712("WasiAIMarketplace", "1")` en la lista de initializers (después de `Ownable(msg.sender)`)
- `CLAIM_EARNINGS_ABI` en `src/lib/contracts/abis.ts` — nunca inline
- `increment_pending_earnings` solo si `result.status === 'success'` — verificar condición explícita
- `p_amount` en `increment_pending_earnings` = `creatorPrice` (USDC humanos, ej: `0.01`) — NO `atomicPrice` (10000)
- Voucher firma `grossAmountAtomics` (uint256 atomics) = `Math.round(pending_earnings_usdc * 1_000_000)`
- Guard en voucher route: `!wallet_address → 400` antes de firmar
- `usedVouchers[nonce]` mapping en contrato — mismo patrón que `usedPaymentIds`
- `totalKeyBalances` en guard de balance — proteger Agent Keys
- `EARNINGS_CLAIMED_TOPIC` hardcodeado en `POST /api/creator/withdraw` (calcular con `keccak256("EarningsClaimed(address,uint256,uint256,uint256,bytes32)")`)
- Nuevo estado `'requesting'` en `WithdrawButton` para mientras se fetcha el voucher
- `forge build` + `forge test` antes de `forge script --broadcast`

### PROHIBIDO
- NO modificar `usdcSettler.ts`
- NO modificar Agent Keys (`withdrawKey`, `keyInvoke`, `refundKeyToEarnings`, `withdrawKey`)
- NO eliminar `recordInvocation()` del contrato
- NO hardcodear `domainSeparator` — usar `_hashTypedDataV4` de OZ EIP712
- NO confiar en `grossAmount` del cliente — el voucher route lee `pending_earnings_usdc` de Supabase
- NO pasar atomics a `increment_pending_earnings` (rompería la contabilidad por factor 1,000,000)
- NO deployar a mainnet
- NO agregar dependencias npm nuevas
- NO tocar archivos fuera de la tabla "Files to Modify/Create"

## Test Expectations

| Test | ACs | Framework | Tipo |
|------|-----|-----------|------|
| N/A | — | — | — |

> Justificación: lógica crítica depende de firma on-chain y Fuji testnet. Cobertura via F4 manual.

## Waves

### Wave 0 (Serial Gate — contrato primero)
- [ ] W0.1: Modificar `contracts/src/WasiAIMarketplace.sol`:
  - Agregar `import ECDSA.sol` + `import EIP712.sol`
  - Agregar `EIP712` a la lista de herencia
  - Actualizar constructor: agregar `EIP712("WasiAIMarketplace", "1")`
  - Agregar `mapping(bytes32 => bool) public usedVouchers`
  - Agregar `bytes32 private constant CLAIM_TYPEHASH = keccak256("ClaimEarnings(address creator,uint256 grossAmount,uint256 deadline,bytes32 nonce)")`
  - Agregar `event EarningsClaimed(address indexed creator, uint256 grossAmount, uint256 creatorShare, uint256 platformShare, bytes32 nonce)`
  - Agregar función `claimEarnings()` → Exemplar 1
- [ ] W0.2: `cd contracts && forge build` — 0 errores
- [ ] W0.3: `forge test` — todos pasan
- [ ] W0.4: `forge script script/DeployMarketplace.s.sol --rpc-url fuji --broadcast -vvv`
- [ ] W0.5: Actualizar `MARKETPLACE_CONTRACT_ADDRESS` y `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` en `.env.local`
- [ ] W0.6: Anotar nueva dirección del contrato para Vercel (W0 verify: dev reporta dirección)

### Wave 1 (Parallelizable — requiere W0 completo)
- [ ] W1.1: Calcular y anotar `EARNINGS_CLAIMED_TOPIC`:
  ```
  keccak256("EarningsClaimed(address,uint256,uint256,uint256,bytes32)")
  ```
  Usar: `node -e "const {keccak256,toBytes}=require('viem'); console.log(keccak256(toBytes('EarningsClaimed(address,uint256,uint256,uint256,bytes32)')))"` en el proyecto
- [ ] W1.2: `src/lib/contracts/abis.ts` — agregar `CLAIM_EARNINGS_ABI` → Exemplar 2
- [ ] W1.3: Crear `src/app/api/creator/earnings/voucher/route.ts` → Exemplar 3
- [ ] W1.4: `src/app/api/v1/models/[slug]/invoke/route.ts` — insertar `increment_pending_earnings` post-logCall → Exemplar 4
- [ ] W1.5: `messages/en.json` + `messages/es.json` — agregar `dashboard.withdrawRequesting`

### Wave 2 (Depende de W0 + W1)
- [ ] W2.1: `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` — flujo voucher → Exemplar 5
- [ ] W2.2: `src/app/api/creator/withdraw/route.ts` — reemplazar POST para verificar evento `EarningsClaimed` con `EARNINGS_CLAIMED_TOPIC`

### Wave 3 (QG)
- [ ] W3.1: `npx tsc --noEmit` — 0 errores
- [ ] W3.2: `npm run lint -- --max-warnings 0`
- [ ] W3.3: `npm run build`
- [ ] W3.4: Commit + push

### Verificación Incremental

| Wave | Verificación |
|------|-------------|
| W0 | `forge build` 0 errores + `forge test` pasan + nueva dirección anotada |
| W1 | `npx tsc --noEmit` pasa |
| W2 | `npx tsc --noEmit` pasa |
| W3 | `tsc` + `lint` + `build` todos pasan |

## Out of Scope

- Agent Keys — sin tocar
- `usdcSettler.ts` — sin tocar
- `recordInvocation()` — se conserva
- Mainnet deploy
- Tests automáticos
- Dashboard page.tsx — usa `pending_earnings_usdc` de Supabase, que ya se actualiza automáticamente
- NO refactorizar código adyacente

## Escalation Rule

> **Si algo no está en este Story File, Dev PARA y escala a Architect.**

Situaciones de escalation:
- `operators` mapping no tiene el patrón esperado en el contrato
- `CLAIM_TYPEHASH` string exacto — cualquier duda → escalar
- `increment_pending_earnings` RPC tiene firma diferente a la documentada
- `model.creator_id` no disponible en el punto de inserción del invoke route
- El contrato Fuji nuevo no tiene `claimEarnings` verificable después del deploy

---

*Story File generado por NexusAgil — F2.5*
