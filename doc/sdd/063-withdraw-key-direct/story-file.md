# Story File — #063: withdrawKey directo + redeploy WasiAIMarketplace

> SDD: doc/sdd/063-withdraw-key-direct/sdd.md
> Fecha: 2026-03-07 · Branch: feat/063-withdraw-key-direct
> SPEC_APPROVED: 2026-03-07

---

## Goal

El contrato desplegado en Fuji es una versión antigua sin `withdrawKey`. El código fuente ya
tiene la función. Esta HU redespliega el contrato y migra `WithdrawModal` para que el usuario
llame `withdrawKey(keyId, amount)` directamente desde su wallet — habilitando retiros parciales
y eliminando la dependencia del operador para retirar.

---

## Acceptance Criteria

AC-1: WHEN el usuario abre WithdrawModal, THEN puede ingresar monto entre 0.01 y balance disponible.
AC-2: WHEN confirma el retiro, THEN su wallet firma `withdrawKey(keyId, amount)` — USDC llega en la misma tx.
AC-3: WHEN la tx es confirmada, THEN el servidor lee evento `KeyWithdrawn` del receipt para obtener monto real. NO confía en `amount` del body.
AC-4: WHEN balance post-retiro > 0, THEN `is_active` permanece `true`.
AC-5: WHEN balance post-retiro = 0, THEN `is_active = false`.
AC-6: IF usuario intenta retirar más del balance, THEN contrato revierte y UI muestra error claro.
AC-7: WHEN contrato redesplegado, THEN flujos existentes (depositKey, x402) siguen funcionando sin cambios.
AC-8: WHEN usuario abre WithdrawModal, THEN UI muestra aviso: "Necesitas AVAX en tu wallet para pagar el gas (~0.001 AVAX)".

---

## Files to Modify/Create

| # | Archivo | Acción | Qué |
|---|---------|--------|-----|
| 0a | `contracts/script/DeployMarketplace.s.sol` | Modificar | Fix typo USDC mainnet address |
| 0b | `.env.local` + Vercel | Actualizar | `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` = nueva address |
| 1 | `src/lib/contracts/abis.ts` | **Crear** | `WITHDRAW_KEY_ABI` — compartido client+server |
| 2 | `src/app/api/agent-keys/[id]/withdraw/route.ts` | Reescribir | Nuevo schema, leer `KeyWithdrawn`, verificar owner/keyId |
| 3 | `src/app/[locale]/agent-keys/page.tsx` | Modificar | `WithdrawModal`: props, estado, input, aviso gas, `writeContract` |

---

## Exemplars

### Exemplar 1 — writeContract (para Archivo #3)
**Fuente**: `src/app/[locale]/agent-keys/page.tsx` líneas 110-120
```typescript
const transferHash = await writeContract({
  address:      USDC_ADDRESS as `0x${string}`,
  abi:          USDC_TRANSFER_ABI as unknown as import('viem').Abi,
  functionName: 'transfer',
  args:         [MARKETPLACE_ADDRESS as `0x${string}`, atomicAmount],
  chainId:      CHAIN_ID,
})
```
**Adaptar para**: usar `MARKETPLACE_ADDRESS`, `WITHDRAW_KEY_ABI`, `'withdrawKey'`, `[bytes32KeyId, atomicAmount]`

### Exemplar 2 — createPublicClient en route (para Archivo #2)
**Fuente**: `src/lib/contracts/marketplaceClient.ts` líneas ~25-35
```typescript
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const pub = createPublicClient({
  chain:     chainId === 43114 ? avalanche : avalancheFuji,
  transport: http(chainId === 43114
    ? 'https://api.avax.network/ext/bc/C/rpc'
    : 'https://api.avax-test.network/ext/bc/C/rpc'),
})
```

### Exemplar 3 — Zod schema + auth en route (para Archivo #2)
**Fuente**: `src/app/api/agent-keys/[id]/withdraw/route.ts` líneas 1-40
Seguir el mismo patrón de: CSRF, auth, Zod parse, supabase select con `.eq('owner_id', user.id)`.

### Exemplar 4 — keyHashToBytes32 (para Archivo #3)
**Fuente**: `src/lib/contracts/marketplaceClient.ts:242-246`
```typescript
export function keyHashToBytes32(keyHash: string): `0x${string}` {
  const hex    = keyHash.replace(/^0x/i, '').toLowerCase()
  const padded = hex.padEnd(64, '0').slice(0, 64)
  return `0x${padded}`
}
```
Importar directamente — NO reimplementar.

### Exemplar 5 — Warning amber + Info blue (para Archivo #3)
**Fuente**: `src/app/[locale]/agent-keys/page.tsx` — patrón existente en `DepositModal`
```tsx
{/* Aviso gas */}
<div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2 text-xs text-blue-800">
  <Info size={13} className="shrink-0 mt-0.5" />
  <span>Necesitas AVAX en tu wallet para pagar el gas del retiro (~0.001 AVAX).</span>
</div>
```

---

## Implementación por Archivo

### Archivo 0a — `contracts/script/DeployMarketplace.s.sol`
Buscar y reemplazar:
```solidity
// Antes:
address constant USDC_MAINNET = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
// Después:
address constant USDC_MAINNET = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6;
```

### Archivo 1 — `src/lib/contracts/abis.ts` (CREAR)
```typescript
/**
 * ABI constants shared between frontend (client) and backend (server).
 * MUST NOT import any server-only modules.
 */

export const WITHDRAW_KEY_ABI = [
  {
    name:            'withdrawKey',
    type:            'function' as const,
    inputs:          [
      { name: 'keyId',  type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
```

### Archivo 2 — `src/app/api/agent-keys/[id]/withdraw/route.ts` (REESCRIBIR)

```typescript
/**
 * POST /api/agent-keys/[id]/withdraw
 *
 * HU-063: Retiro directo desde wallet del usuario via withdrawKey(bytes32,uint256).
 * El usuario ya ejecutó la tx on-chain — este endpoint solo sincroniza la DB.
 *
 * HAL-025: DB se actualiza SOLO tras verificar el evento KeyWithdrawn en el receipt.
 */
import { NextRequest, NextResponse }        from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf }                      from '@/lib/security/csrf'
import { logger }                            from '@/lib/logger'
import { z }                                 from 'zod'
import { createPublicClient, http }          from 'viem'
import { avalancheFuji, avalanche }          from 'viem/chains'
import { getKeyOwnerOnChain }                from '@/lib/contracts/marketplaceClient'

// topic0 = keccak256("KeyWithdrawn(bytes32,address,uint256)")
const KEY_WITHDRAWN_TOPIC = '0xf968df119e62b53960f5b7aaa847537e4b933ffd14eaba1e7ea5fb99bffb2632'

const BodySchema = z.object({
  txHash: z.string().startsWith('0x'),
  amount: z.number().positive(),   // hint only — monto real viene del evento on-chain
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const { id } = await params

  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Validate body
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 })
  }

  // 3. Ownership check
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, key_hash, is_active, owner_id, owner_wallet_address, budget_usdc')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!keyRow)           return NextResponse.json({ error: 'Key not found' },       { status: 404 })
  if (!keyRow.is_active) return NextResponse.json({ error: 'Key already revoked' }, { status: 400 })
  if (!keyRow.key_hash)  return NextResponse.json({ error: 'Key has no hash' },     { status: 500 })

  // 4. Resolver owner wallet — DB primero, fallback on-chain
  const ownerAddress = (keyRow as { owner_wallet_address?: string | null }).owner_wallet_address
    ?? await getKeyOwnerOnChain(keyRow.key_hash)

  if (!ownerAddress) {
    return NextResponse.json(
      { error: 'Key owner not found. Key may not have been deposited yet.' },
      { status: 400 },
    )
  }

  // 5. Public client para leer receipt (Exemplar 2)
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const pub = createPublicClient({
    chain:     chainId === 43114 ? avalanche : avalancheFuji,
    transport: http(chainId === 43114
      ? 'https://api.avax.network/ext/bc/C/rpc'
      : 'https://api.avax-test.network/ext/bc/C/rpc'),
  })

  // 6. Leer receipt + verificar status
  let receipt
  try {
    receipt = await pub.getTransactionReceipt({
      hash: parsed.data.txHash as `0x${string}`,
    })
  } catch {
    return NextResponse.json({ error: 'Transaction not found or not yet mined' }, { status: 400 })
  }

  if (receipt.status !== 'success') {
    return NextResponse.json({ error: 'Transaction reverted on-chain' }, { status: 400 })
  }

  // 7. Extraer evento KeyWithdrawn
  const marketplaceAddr = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

  const log = receipt.logs.find(l =>
    l.topics[0] === KEY_WITHDRAWN_TOPIC &&
    l.address.toLowerCase() === marketplaceAddr.toLowerCase()
  )

  if (!log) {
    return NextResponse.json({ error: 'KeyWithdrawn event not found in receipt' }, { status: 400 })
  }

  // 8. Verificar keyId del evento == keyRow.key_hash (OBS-4)
  // topics[1] = bytes32 con 0x prefix → slice(2) para 64 hex chars
  const eventKeyId = log.topics[1]?.slice(2).toLowerCase()
  if (eventKeyId !== keyRow.key_hash.toLowerCase()) {
    logger.error('[withdraw] keyId mismatch', { eventKeyId, keyHash: keyRow.key_hash })
    return NextResponse.json({ error: 'Receipt keyId does not match this key' }, { status: 400 })
  }

  // 9. Verificar owner del evento == owner registrado (OBS-2)
  // topics[2] = address padded a 32 bytes → tomar últimos 40 chars
  const eventOwner = '0x' + (log.topics[2]?.slice(-40) ?? '')
  if (eventOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    logger.error('[withdraw] owner mismatch', { eventOwner, ownerAddress })
    return NextResponse.json({ error: 'Receipt owner does not match key owner' }, { status: 403 })
  }

  // 10. Extraer monto real del evento (log.data = ABI-encoded uint256)
  const realAmount = Number(BigInt(log.data)) / 1_000_000

  // 11. Actualizar DB — HAL-025: solo tras receipt verificado
  const newBudget = Math.max(0, Number(keyRow.budget_usdc) - realAmount)
  const serviceClient = createServiceClient()

  const { error: updateError } = await serviceClient
    .from('agent_keys')
    .update({
      budget_usdc: newBudget,
      is_active:   newBudget > 0,
    })
    .eq('id', id)

  if (updateError) {
    logger.error('[withdraw] DB update failed after verified on-chain withdrawal', {
      keyId: id, txHash: parsed.data.txHash, updateError,
    })
    return NextResponse.json({
      ok:      true,
      txHash:  parsed.data.txHash,
      realAmount,
      warning: 'DB sync failed — contact support if balance shows incorrectly.',
    })
  }

  logger.info('[withdraw] completed', { keyId: id, realAmount, newBudget, isActive: newBudget > 0 })
  return NextResponse.json({ ok: true, txHash: parsed.data.txHash, realAmount })
}
```

### Archivo 3 — `page.tsx` — cambios en `WithdrawModal`

**Imports nuevos** (al inicio del archivo, junto a los existentes):
```typescript
import { WITHDRAW_KEY_ABI } from '@/lib/contracts/abis'
import { keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'
```

**Props — agregar `keyHash`**:
```typescript
function WithdrawModal({ keyId, keyName, balance, keyHash, onClose, onSuccess }: {
  keyId: string; keyName: string; balance: number; keyHash: string
  onClose: () => void; onSuccess: () => void
})
```

**Hook al inicio del componente**:
```typescript
const { writeContract }      = useUnifiedWalletClient()
const [amount, setAmount]    = useState(balance)
const [status, setStatus]    = useState<'idle'|'signing'|'submitting'|'success'|'error'>('idle')
const [txHash, setTxHash]    = useState('')
const [errorMsg, setErrorMsg] = useState('')
// Eliminar: const { address } = useWallet()  (ya no se usa en WithdrawModal)
```

**`handleWithdraw` completo**:
```typescript
async function handleWithdraw() {
  setErrorMsg('')
  try {
    setStatus('signing')
    const bytes32KeyId = keyHashToBytes32(keyHash)
    const atomicAmount = BigInt(Math.round(amount * 1_000_000))

    const hash = await writeContract({
      address:      MARKETPLACE_ADDRESS as `0x${string}`,
      abi:          WITHDRAW_KEY_ABI,
      functionName: 'withdrawKey',
      args:         [bytes32KeyId, atomicAmount],
      chainId:      CHAIN_ID,
    })

    setStatus('submitting')
    const res = await fetch(`/api/agent-keys/${keyId}/withdraw`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ txHash: hash, amount }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

    setTxHash(hash)
    setStatus('success')
    onSuccess()
  } catch (err: unknown) {
    setErrorMsg(err instanceof Error ? err.message : String(err))
    setStatus('error')
  }
}
```

**Render — estados signing/submitting** (reemplazar bloque del spinner actual):
```tsx
{status === 'signing' && (
  <p className="text-center text-sm text-gray-500 animate-pulse py-2">
    Confirma en tu wallet...
  </p>
)}
{status === 'submitting' && (
  <p className="text-center text-sm text-gray-500 animate-pulse py-2">
    Sincronizando...
  </p>
)}
```

**Input de monto** (reemplazar bloque estático del balance):
```tsx
{/* Monto a retirar */}
<div className="space-y-1">
  <label className="text-xs text-gray-500">{t('withdraw.amountLabel')}</label>
  <input
    type="number"
    min={0.01}
    max={balance}
    step={0.01}
    value={amount}
    onChange={e => setAmount(Math.min(balance, Math.max(0.01, Number(e.target.value))))}
    disabled={status !== 'idle'}
    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-avax-400 disabled:opacity-50"
  />
  <p className="text-xs text-gray-400 text-right">Máx: ${balance.toFixed(2)} USDC</p>
</div>
```

**Aviso gas AVAX** (agregar debajo del input):
```tsx
<div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2 text-xs text-blue-800">
  <Info size={13} className="shrink-0 mt-0.5" />
  <span>Necesitas AVAX en tu wallet para pagar el gas del retiro (~0.001 AVAX).</span>
</div>
```

**Eliminar** bloque amber de "retiro total — key quedará cerrada" (ya no aplica con retiros parciales).

**Success** — usar `amount` retirado, no `balance` completo:
```tsx
<p className="text-sm text-gray-500">
  ${amount.toFixed(2)} USDC enviados a tu wallet.
</p>
```

**Render del modal en página** — pasar `keyHash`:
```tsx
<WithdrawModal
  keyId={withdrawKey.id}
  keyName={withdrawKey.name}
  balance={withdrawKey.balance}
  keyHash={withdrawKey.keyHash}
  onClose={() => setWithdrawKey(null)}
  onSuccess={() => { setWithdrawKey(null); setTimeout(loadKeys, 1500) }}
/>
```

---

## Constraint Directives

### OBLIGATORIO
- W0 redeploy es **Serial Gate** — nueva address en `.env.local` antes de W1/W2
- `KEY_WITHDRAWN_TOPIC = '0xf968df119e62b53960f5b7aaa847537e4b933ffd14eaba1e7ea5fb99bffb2632'` — hardcodeado, no recalcular
- Verificar `log.topics[1].slice(2).toLowerCase() === keyRow.key_hash.toLowerCase()` (normalización bytes32)
- Verificar `('0x' + log.topics[2].slice(-40)).toLowerCase() === ownerAddress.toLowerCase()` (owner check)
- `is_active = newBudget > 0` — AC-4/AC-5
- `WITHDRAW_KEY_ABI` en `src/lib/contracts/abis.ts` — NO en `marketplaceClient.ts`
- `keyHashToBytes32` importado de `marketplaceClient.ts` — NO reimplementar

### PROHIBIDO
- NO eliminar `refundKeyToEarningsOnChain` / `withdrawForCreator` de `marketplaceClient.ts`
- NO confiar en `amount` del body para actualizar DB — siempre `log.data` del evento
- NO importar `abis.ts` desde código con `'use server'` explícito
- NO modificar flujo de depósito ni x402
- NO desplegar a mainnet en esta HU

---

## Waves

### Wave 0 — Serial Gate (ANTES de cualquier código)
- [ ] W0.1: Fix `contracts/script/DeployMarketplace.s.sol` — typo USDC mainnet
- [ ] W0.2: `forge script ... --broadcast -vvv` → anotar nueva address del output
- [ ] W0.3: Actualizar `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` en `.env.local`
- [ ] W0.4: Actualizar misma variable en Vercel (Settings → Environment Variables)
- [ ] W0.5: Verificar que `withdrawKey` existe en nuevo contrato:
  ```bash
  cast sig "withdrawKey(bytes32,uint256)"
  # debe devolver 0x55665727
  cast call <NUEVA_ADDRESS> "withdrawKey(bytes32,uint256)" <bytes32> <uint256> --rpc-url fuji
  # debe revertir "WasiAI: not key owner" (no "function not found")
  ```

### Wave 1 — Backend (paralelo)
- [ ] W1.1: Crear `src/lib/contracts/abis.ts` con `WITHDRAW_KEY_ABI` → Implementación Archivo 1
- [ ] W1.2: Reescribir `src/app/api/agent-keys/[id]/withdraw/route.ts` → Implementación Archivo 2
- [ ] W1.3: `npx tsc --noEmit` pasa

### Wave 2 — Frontend
- [ ] W2.1: Agregar imports `WITHDRAW_KEY_ABI`, `keyHashToBytes32` en `page.tsx`
- [ ] W2.2: Actualizar `WithdrawModal` props, estado, `handleWithdraw` → Implementación Archivo 3
- [ ] W2.3: Input de monto + aviso gas AVAX
- [ ] W2.4: Estados `signing`/`submitting` en render
- [ ] W2.5: Pasar `keyHash` al render del modal
- [ ] W2.6: `npx tsc --noEmit` pasa

### Wave 3 — Quality Gate
- [ ] W3.1: `npm run lint -- --max-warnings 0` → 0 warnings
- [ ] W3.2: `npx tsc --noEmit` → 0 errores
- [ ] W3.3: `npm run build` → pasa

### Verificación Incremental
| Wave | Verificar al completar |
|------|----------------------|
| W0 | `cast call` retorna "not key owner" (función existe) |
| W1 | typecheck pasa |
| W2 | typecheck pasa |
| W3 | lint + typecheck + build limpios |

---

## Out of Scope
- Deploy a mainnet
- UI para `emergencyWithdrawKey`
- Cambios al flujo de depósito
- Cambios al flujo x402
- Eliminar `refundKeyToEarnings`/`withdrawFor` del cliente
- Migración de keys existentes (siguen usando fallback `getKeyOwnerOnChain`)

---

## Escalation Rule

**Si algo no está en este Story File, Dev PARA y pregunta a Architect.**

Situaciones de escalation obligatoria:
- W0: `forge script` falla con error distinto al esperado → Architect revisa
- W0.5: `cast call` retorna "function not found" en lugar de "not key owner" → ABI no deployado, Architect investiga
- `log.data` del evento tiene formato inesperado → Architect verifica ABI del evento en el contrato
- `keyHashToBytes32` importado desde `marketplaceClient.ts` genera error de bundle → Architect mueve a `abis.ts`
- Cualquier archivo fuera de la tabla necesita cambio → Architect actualiza Story File

---

*Story File generado por NexusAgil — F2.5 | HU-063 | SPEC_APPROVED: 2026-03-07*
