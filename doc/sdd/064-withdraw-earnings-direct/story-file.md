# Story File #064 — Withdraw Earnings Directo

## Tu trabajo como dev

Implementar W1→W2→W3→W4 en orden. Luego QG.

---

## W1 — abis.ts: agregar WITHDRAW_EARNINGS_ABI

**Archivo:** `src/lib/contracts/abis.ts`

Agregar después de `WITHDRAW_KEY_ABI`:

```typescript
export const WITHDRAW_EARNINGS_ABI = [
  {
    name:            'withdraw',        // ← debe ser 'withdraw' (nombre real en contrato)
    type:            'function' as const,
    inputs:          [],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
```

---

## W2 — POST /api/creator/withdraw: verificar evento Withdrawn

**Archivo:** `src/app/api/creator/withdraw/route.ts`

Reemplazar el `POST` handler completo:

```typescript
const WITHDRAWN_TOPIC = '0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5'

const BodySchema = z.object({ txHash: z.string().startsWith('0x') })

export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile?.wallet_address) {
    return NextResponse.json({ error: 'No wallet configured' }, { status: 400 })
  }

  const walletAddress = profile.wallet_address
  const chainId       = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const pub           = createPublicClient({
    chain:     chainId === 43114 ? avalanche : avalancheFuji,
    transport: http(chainId === 43114
      ? 'https://api.avax.network/ext/bc/C/rpc'
      : 'https://api.avax-test.network/ext/bc/C/rpc'),
  })

  // Retry 3× con backoff
  let receipt: Awaited<ReturnType<typeof pub.getTransactionReceipt>> | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      receipt = await pub.getTransactionReceipt({ hash: parsed.data.txHash as `0x${string}` })
      break
    } catch {
      if (attempt === 2) return NextResponse.json({ error: 'Transaction not found or not yet mined' }, { status: 400 })
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
    }
  }

  if (!receipt || receipt.status !== 'success') {
    return NextResponse.json({ error: 'Transaction reverted on-chain' }, { status: 400 })
  }

  const marketplaceAddr = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

  const log = receipt!.logs.find(l =>
    l.topics[0] === WITHDRAWN_TOPIC &&
    l.address.toLowerCase() === marketplaceAddr.toLowerCase()
  )

  if (!log) return NextResponse.json({ error: 'Withdrawn event not found in receipt' }, { status: 400 })

  // Verificar que el evento es del creator autenticado
  const eventCreator = '0x' + (log.topics[1]?.slice(-40) ?? '')
  if (eventCreator.toLowerCase() !== walletAddress.toLowerCase()) {
    return NextResponse.json({ error: 'Receipt creator does not match authenticated wallet' }, { status: 403 })
  }

  const realAmount = Number(BigInt(log.data)) / 1_000_000

  return NextResponse.json({ ok: true, txHash: parsed.data.txHash, realAmount })
}
```

Agregar imports necesarios (igual que withdraw route de agent-keys):
```typescript
import { z }                                    from 'zod'
import { createPublicClient, http }             from 'viem'
import { avalancheFuji, avalanche }             from 'viem/chains'
```

El `GET` handler NO se toca.

---

## W3 — WithdrawButton: llamada directa + i18n

**Archivo:** `src/app/[locale]/creator/dashboard/WithdrawButton.tsx`

Reemplazar el archivo completo:

```typescript
'use client'

import { useState }                              from 'react'
import { useTranslations }                       from 'next-intl'
import { createPublicClient, http }              from 'viem'
import { avalancheFuji, avalanche }              from 'viem/chains'
import { useUnifiedWalletClient }                from '@/features/wallet/hooks/useUnifiedWalletClient'
import { WITHDRAW_EARNINGS_ABI }                 from '@/lib/contracts/abis'
import { IS_MAINNET, CHAIN_ID }                  from '@/lib/chain'

const MARKETPLACE_ADDRESS = IS_MAINNET
  ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
  : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI

interface Props {
  pending:       number
  hasWallet:     boolean
  walletAddress: string
}

export function WithdrawButton({ pending, hasWallet, walletAddress }: Props) {
  const t = useTranslations('dashboard')
  const { writeContract } = useUnifiedWalletClient()
  const [status,  setStatus]  = useState<'idle'|'signing'|'confirming'|'success'|'error'>('idle')
  const [txHash,  setTxHash]  = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const isDisabled = status === 'signing' || status === 'confirming'

  async function handleWithdraw() {
    setErrorMsg('')
    try {
      setStatus('signing')
      const hash = await writeContract({
        address:      MARKETPLACE_ADDRESS as `0x${string}`,
        abi:          WITHDRAW_EARNINGS_ABI,
        functionName: 'withdraw',
        chainId:      CHAIN_ID,
      })

      setStatus('confirming')
      const pub = createPublicClient({
        chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
        transport: http(),
      })
      await pub.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1 })

      await fetch('/api/creator/withdraw', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txHash: hash }),
      })

      setTxHash(hash)
      setStatus('success')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  if (!hasWallet || !walletAddress) {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
        {t('withdrawNoWallet')}
      </button>
    )
  }

  if (status === 'success' && txHash) {
    const explorerBase = IS_MAINNET ? 'snowscan.xyz' : 'testnet.snowscan.xyz'
    return (
      <a
        href={`https://${explorerBase}/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-xl bg-green-100 px-5 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-200 transition"
      >
        ✅ {t('withdrawViewTx')} ↗
      </a>
    )
  }

  const label = status === 'signing'    ? t('withdrawSigning')
              : status === 'confirming' ? t('withdrawConfirming')
              : t('withdrawBtn')

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleWithdraw}
        disabled={isDisabled || pending <= 0}
        className="rounded-xl bg-avax-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isDisabled ? <span className="animate-pulse">{label}</span> : label}
      </button>
      {status === 'error' && errorMsg && (
        <p className="text-xs text-red-500">{errorMsg}</p>
      )}
    </div>
  )
}
```

Agregar claves i18n al namespace `dashboard` antes de implementar:

**`messages/en.json`** — dashboard:
```json
"withdrawBtn":        "Withdraw USDC →",
"withdrawSigning":    "Confirm in wallet…",
"withdrawConfirming": "Confirming…",
"withdrawViewTx":     "View tx",
"withdrawNoWallet":   "No wallet"
```

**`messages/es.json`** — dashboard:
```json
"withdrawBtn":        "Retirar USDC →",
"withdrawSigning":    "Confirma en tu wallet…",
"withdrawConfirming": "Confirmando…",
"withdrawViewTx":     "Ver tx",
"withdrawNoWallet":   "Sin wallet"
```

---

## W4 — EarningsSection: pasar walletAddress

**Archivo:** `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx`

```tsx
<WithdrawButton
  pending={pendingOnChain}
  hasWallet={!!profile?.wallet_address}
  walletAddress={profile?.wallet_address ?? ''}
/>
```

---

## QG

```bash
npx tsc --noEmit          # 0 errores
npm run lint -- --max-warnings 0
npm run build
```
