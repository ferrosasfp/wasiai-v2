# SDD #064 — Withdraw Earnings Directo desde Wallet del Creator

**Tipo:** improvement · **SDD_MODE:** full
**Status:** SPEC_APPROVED pending
**Fecha:** 2026-03-08

---

## Contexto

`WithdrawButton.tsx` actualmente llama `POST /api/creator/withdraw`, que usa
`withdrawForCreator()` (operador ejecuta `withdrawFor(wallet)` on-chain).
El creator no firma nada — el operador paga el gas.

El contrato ya tiene `withdraw() external nonReentrant` (línea 409) —
el creator puede llamarlo directamente desde su wallet.

**Objetivo:** reemplazar el flujo operador por llamada directa del creator.

---

## Constantes Pre-calculadas

```
WITHDRAWN_TOPIC = keccak256("Withdrawn(address,uint256)")
             = 0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5
```

Evento: `Withdrawn(address indexed creator, uint256 amount)` — línea 152

---

## Decisiones de Diseño

### D-1: WITHDRAW_EARNINGS_ABI en abis.ts
Función `withdraw()` sin inputs. Mismo archivo que `WITHDRAW_KEY_ABI` — sin imports server-only.

### D-2: WithdrawButton reescrito como client component con writeContract
Usa `useUnifiedWalletClient` + `createPublicClient` + `waitForTransactionReceipt`.
Patrón idéntico a `WithdrawModal` (HU-063).

### D-3: POST /api/creator/withdraw eliminado del flujo normal
El creator ya ejecutó la tx. El API solo verifica el evento `Withdrawn` en el
receipt y retorna confirmación. `GET /api/creator/withdraw` sin cambios.

### D-4: POST /api/creator/withdraw recibe { txHash }
Verifica:
1. `receipt.status === 'success'`
2. `log.topics[0] === WITHDRAWN_TOPIC`
3. `log.address === marketplaceAddr`
4. `log.topics[1]?.slice(-40) === walletAddress.toLowerCase()` (owner check)
5. Retorna `{ ok, realAmount }` — no actualiza DB (no hay tabla de earnings en Supabase)

### D-5: Retry en API igual que HU-063
3 intentos con backoff 2s/4s para timing race.

### D-6: `EarningsSection` pasa wallet al `WithdrawButton`
`WithdrawButton` necesita `walletAddress` para verificar el evento on-chain.
Actualmente solo recibe `pending` y `hasWallet`. Agregar `walletAddress: string`.

---

## Waves

### W1 — abis.ts: WITHDRAW_EARNINGS_ABI
```typescript
export const WITHDRAW_EARNINGS_ABI = [
  {
    name:            'withdrawEarnings',
    type:            'function' as const,
    inputs:          [],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
```
⚠️ El nombre en el ABI puede ser cualquiera — `functionName: 'withdraw'` en el call.

### W2 — POST /api/creator/withdraw: recibir txHash, verificar evento
Body schema: `z.object({ txHash: z.string().startsWith('0x') })`

```typescript
const WITHDRAWN_TOPIC = '0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5'
```

Flujo:
1. Auth check
2. `creator_profiles.wallet_address` lookup
3. `getTransactionReceipt` con retry 3×
4. `receipt.status !== 'success'` → 400
5. Buscar log con `topic0 === WITHDRAWN_TOPIC && address === marketplaceAddr`
6. Verificar `topics[1]?.slice(-40) === wallet.toLowerCase()`
7. `realAmount = Number(BigInt(log.data)) / 1_000_000`
8. Return `{ ok, realAmount }`

### W3 — WithdrawButton: llamada directa + estados
Props: `{ pending, hasWallet, walletAddress }`

```typescript
const [status, setStatus] = useState<'idle'|'signing'|'confirming'|'success'|'error'>('idle')

async function handleWithdraw() {
  setStatus('signing')
  const hash = await writeContract({
    address:      MARKETPLACE_ADDRESS as `0x${string}`,
    abi:          WITHDRAW_EARNINGS_ABI,
    functionName: 'withdraw',
    chainId:      CHAIN_ID,
  })
  setStatus('confirming')
  const pub = createPublicClient({ chain: ..., transport: http() })
  await pub.waitForTransactionReceipt({ hash, confirmations: 1 })
  await fetch('/api/creator/withdraw', {
    method: 'POST',
    body: JSON.stringify({ txHash: hash })
  })
  setStatus('success')
  setTxHash(hash)
}
```

Estados UI:
- `idle + pending > 0` → botón "Withdraw USDC →" activo
- `idle + pending = 0` → botón deshabilitado (opacity-40)
- `signing` → "Confirm in wallet…" (animate-pulse)
- `confirming` → "Confirming…" (animate-pulse)
- `success` → link "✅ View tx ↗" al explorer
- `error` → mensaje de error en rojo

### W4 — EarningsSection: pasar walletAddress a WithdrawButton
```tsx
<WithdrawButton
  pending={pendingOnChain}
  hasWallet={!!profile?.wallet_address}
  walletAddress={profile?.wallet_address ?? ''}
/>
```

---

## Acceptance Criteria

| # | Criterio | Wave |
|---|----------|------|
| AC-1 | WHEN click "Withdraw USDC", THE UI solicita firma de `withdraw()` al creator | W3 |
| AC-2 | WHEN tx confirmada, verifica evento `Withdrawn` en receipt antes de mostrar éxito | W2+W3 |
| AC-3 | WHEN `receipt.status !== 'success'`, THE UI muestra error y NO actualiza estado | W2+W3 |
| AC-4 | WHILE no wallet conectada, THE botón muestra "No wallet" deshabilitado | W3 |
| AC-5 | WHEN tx exitosa, THE UI muestra link al explorer con txHash del creator | W3 |
| AC-6 | IF `earnings[msg.sender] == 0`, contrato revierte y THE UI muestra error | W3 |
| AC-7 | WHILE esperando firma/confirmación, THE botón muestra estado de carga, no double-click | W3 |
| AC-8 | `tsc --noEmit` 0 errores + `lint --max-warnings 0` | QG |

## Archivos Modificados
1. `src/lib/contracts/abis.ts` — agregar `WITHDRAW_EARNINGS_ABI`
2. `src/app/api/creator/withdraw/route.ts` — reescribir POST
3. `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` — reescribir completo
4. `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` — agregar `walletAddress` prop

## Archivos Nuevos
- Ninguno

## Scope OUT
- `GET /api/creator/withdraw` — sin cambios
- `withdrawForCreator` en `marketplaceClient.ts` — se conserva (fallback operador)
- Schema DB creator_profiles — sin cambios
- Flujo x402, depósito Agent Keys
