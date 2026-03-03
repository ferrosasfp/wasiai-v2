# Story File #038 — WAS-131: Freemium publish con listing fee x402 real
> Dev lee SOLO este archivo. No consultar SDD ni Work Item.

## Goal
Primer agente de cada creator = gratis.
Segundo en adelante = paga listing fee en USDC firmando EIP-712 en el browser.
Fee configurable en `system_config` (key `listing_fee_usdc`) — sin redeploy.
Deploy inicial con fee = 0 → nadie se bloquea en producción.

## Acceptance Criteria
- AC1: Agente #1 → flujo actual sin cambios
- AC2: Agente #2+ → UI muestra fee + requiere firma EIP-712
- AC3: fee = 0 → flujo normal sin firma (ni window.ethereum)
- AC4: Sin wallet configurada y fee > 0 → solicitar configurar wallet
- AC5: Tx USDC exitosa → agente activo
- AC6: Tx USDC falla → agente en draft + error claro

## Conteo de agentes
```sql
SELECT COUNT(*) FROM agents 
WHERE creator_id = $1 
AND status IN ('active', 'reviewing')
```

## Payload EIP-712 exacto (NO inventar)

El frontend firma exactamente esto con `window.ethereum.request({ method: 'eth_signTypedData_v4' })`:

```json
{
  "domain": {
    "name": "USD Coin",
    "version": "2",
    "chainId": 43114,
    "verifyingContract": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
  },
  "types": {
    "TransferWithAuthorization": [
      { "name": "from",        "type": "address" },
      { "name": "to",          "type": "address" },
      { "name": "value",       "type": "uint256" },
      { "name": "validAfter",  "type": "uint256" },
      { "name": "validBefore", "type": "uint256" },
      { "name": "nonce",       "type": "bytes32" }
    ]
  },
  "message": {
    "from":        "<creator_wallet_address>",
    "to":          "<WASIAI_TREASURY — leer de /api/creator/publish-gate>",
    "value":       "<listing_fee_usdc * 1_000_000 como string>",
    "validAfter":  "0",
    "validBefore": "<Math.floor(Date.now()/1000) + 300 como string>",
    "nonce":       "<crypto.getRandomValues(new Uint8Array(32)) → 0x hex>"
  }
}
```

Backend recibe: `{ slug, signature: "0x...", authorization: { from, to, value, validAfter, validBefore, nonce } }`

## Archivos a crear/modificar

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/035_listing_fee.sql` | **Crear** |
| `src/app/api/creator/publish-gate/route.ts` | **Crear** |
| `src/app/api/creator/listing-fee-pay/route.ts` | **Crear** |
| `src/app/[locale]/publish/ListingFeeModal.tsx` | **Crear** |
| `src/app/[locale]/publish/PublishForm.tsx` | Modificar — handlePublish() |

**NO tocar:**
- `settlePaymentDirectly()` en usdcSettler.ts — solo consumir
- `invoke/route.ts` — no tocar
- Flujo Agent Key

## Waves

### W0 — Migration 035

Crear `supabase/migrations/035_listing_fee.sql`:

```sql
-- Migration 035: listing_fee_usdc en system_config
-- WAS-131: fee = 0 al deploy — activable desde Supabase sin redeploy

INSERT INTO system_config (key, value)
VALUES ('listing_fee_usdc', '0')
ON CONFLICT (key) DO NOTHING;
```

Aplicar en Supabase:
```bash
npx supabase db push
```

Verificar: `SELECT * FROM system_config WHERE key = 'listing_fee_usdc'`

### W1 — GET /api/creator/publish-gate

Crear `src/app/api/creator/publish-gate/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()

  // Contar agentes del creator con status IN ('active', 'reviewing')
  const { data: profile } = await serviceClient
    .from('creator_profiles')
    .select('id, wallet_address')
    .eq('user_id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { count } = await serviceClient
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', profile.id)
    .in('status', ['active', 'reviewing'])

  // Leer listing_fee_usdc de system_config
  const { data: configRow } = await serviceClient
    .from('system_config')
    .select('value')
    .eq('key', 'listing_fee_usdc')
    .single()

  const listingFee = parseFloat(configRow?.value ?? '0')
  const agentCount = count ?? 0

  return NextResponse.json({
    agentCount,
    listingFee,
    requiresFee:    agentCount >= 1 && listingFee > 0,
    hasWallet:      !!profile.wallet_address,
    treasuryAddress: process.env.WASIAI_TREASURY_ADDRESS ?? '',
  })
}
```

Typecheck: `npx tsc --noEmit`

### W2 — POST /api/creator/listing-fee-pay

Crear `src/app/api/creator/listing-fee-pay/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    slug:          string
    signature:     string
    authorization: {
      from:        string
      to:          string
      value:       string
      validAfter:  string
      validBefore: string
      nonce:       string
    }
  }

  const { slug, signature, authorization } = body
  if (!slug || !signature || !authorization) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // [Adversary-1] Validar que to === TREASURY_ADDRESS
  const treasury = (process.env.WASIAI_TREASURY_ADDRESS ?? '').toLowerCase()
  if (!treasury) {
    logger.error('[listing-fee-pay] WASIAI_TREASURY_ADDRESS not configured')
    return NextResponse.json({ error: 'Payment not configured' }, { status: 500 })
  }
  if (authorization.to.toLowerCase() !== treasury) {
    return NextResponse.json({ error: 'Invalid payment recipient' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // Verificar que el agente pertenece al creator
  const { data: profile } = await serviceClient
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: agent } = await serviceClient
    .from('agents')
    .select('id, status')
    .eq('slug', slug)
    .eq('creator_id', profile.id)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (agent.status === 'active') return NextResponse.json({ error: 'Agent already active' }, { status: 409 })

  // Ejecutar transferWithAuthorization vía settlePaymentDirectly
  const evmPayload: X402EVMPayload = { signature, authorization }

  // Leer fee de system_config para validar amount
  const { data: configRow } = await serviceClient
    .from('system_config')
    .select('value')
    .eq('key', 'listing_fee_usdc')
    .single()

  const feeUsdc   = parseFloat(configRow?.value ?? '0')
  const atomicFee = Math.round(feeUsdc * 1_000_000).toString()

  const result = await settlePaymentDirectly(evmPayload, atomicFee)

  if (!result.settled) {
    logger.error('[listing-fee-pay] settlement failed', { error: result.error, slug })
    return NextResponse.json(
      { error: result.error ?? 'Payment failed — agent not published' },
      { status: 402 },
    )
  }

  // AC5: Tx exitosa → activar agente
  await serviceClient
    .from('agents')
    .update({ status: 'active' })
    .eq('id', agent.id)

  logger.info('[listing-fee-pay] agent activated after fee payment', { slug, txHash: result.transactionHash })

  return NextResponse.json({
    ok:          true,
    txHash:      result.transactionHash,
    agentSlug:   slug,
  })
}
```

Typecheck: `npx tsc --noEmit`

### W3 — ListingFeeModal.tsx

Crear `src/app/[locale]/publish/ListingFeeModal.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  slug:            string
  listingFee:      number
  treasuryAddress: string
  creatorWallet:   string
  locale:          string
  onCancel:        () => void
}

type Step = 'confirm' | 'signing' | 'paying' | 'done' | 'error'

export default function ListingFeeModal({
  slug, listingFee, treasuryAddress, creatorWallet, locale, onCancel
}: Props) {
  const router           = useRouter()
  const [step, setStep]  = useState<Step>('confirm')
  const [error, setError] = useState<string | null>(null)

  async function handleSign() {
    // [Adversary-2] Verificar wallet disponible
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('Necesitas una wallet compatible (Core, MetaMask) para continuar')
      setStep('error')
      return
    }

    setStep('signing')

    try {
      const validBefore = String(Math.floor(Date.now() / 1000) + 300)
      const nonceBytes  = crypto.getRandomValues(new Uint8Array(32))
      const nonce       = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const value       = String(Math.round(listingFee * 1_000_000))

      const authorization = {
        from:        creatorWallet,
        to:          treasuryAddress,
        value,
        validAfter:  '0',
        validBefore,
        nonce,
      }

      // EIP-712 payload exacto — NO modificar estructura
      const typedData = {
        domain: {
          name:              'USD Coin',
          version:           '2',
          chainId:           43114,
          verifyingContract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message:     authorization,
      }

      const signature = await (window.ethereum as { request: (args: { method: string; params: unknown[] }) => Promise<string> }).request({
        method: 'eth_signTypedData_v4',
        params: [creatorWallet, JSON.stringify(typedData)],
      })

      setStep('paying')

      const res = await fetch('/api/creator/listing-fee-pay', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ slug, signature, authorization }),
      })

      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? 'Payment failed')
      }

      setStep('done')
      setTimeout(() => router.push(`/${locale}/creator/dashboard`), 1500)

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      // Firma rechazada por el usuario
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
        setError('Firma rechazada. Intenta de nuevo cuando estés listo.')
      } else {
        setError(msg)
      }
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

        {step === 'confirm' && (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Listing fee requerido</h2>
            <p className="text-sm text-gray-600 mb-4">
              Tu segundo agente (y siguientes) requieren un listing fee para publicarse en WasiAI.
            </p>
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 mb-6">
              <p className="text-xs text-gray-500">Fee de publicación</p>
              <p className="text-2xl font-bold text-gray-900">${listingFee.toFixed(2)} USDC</p>
              <p className="text-xs text-gray-400 mt-1">Pago único · No recurrente</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSign}
                className="flex-1 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-400 transition"
              >
                Firmar y publicar
              </button>
            </div>
          </>
        )}

        {step === 'signing' && (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">✍️</div>
            <p className="font-semibold text-gray-900">Esperando firma...</p>
            <p className="text-sm text-gray-500 mt-1">Confirma la transacción en tu wallet</p>
          </div>
        )}

        {step === 'paying' && (
          <div className="text-center py-6">
            <div className="animate-spin text-3xl mb-3">⏳</div>
            <p className="font-semibold text-gray-900">Procesando pago...</p>
            <p className="text-sm text-gray-500 mt-1">Confirmando en Avalanche</p>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">✅</div>
            <p className="font-semibold text-gray-900">¡Agente publicado!</p>
            <p className="text-sm text-gray-500 mt-1">Redirigiendo al dashboard...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">❌</div>
            <p className="font-semibold text-gray-900">Error</p>
            <p className="text-sm text-gray-500 mt-2">{error}</p>
            <button
              onClick={() => { setStep('confirm'); setError(null) }}
              className="mt-4 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition"
            >
              Intentar de nuevo
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
```

Typecheck: `npx tsc --noEmit`

### W4 — Modificar PublishForm.tsx

Leer `PublishForm.tsx` completo antes de tocar — anti-alucinación.

Agregar import:
```ts
import ListingFeeModal from './ListingFeeModal'
```

Agregar estado:
```ts
const [gateData, setGateData] = useState<{
  agentCount:      number
  listingFee:      number
  requiresFee:     boolean
  hasWallet:       boolean
  treasuryAddress: string
} | null>(null)
const [showFeeModal, setShowFeeModal] = useState(false)
```

Reemplazar inicio de `handlePublish()`:
```ts
async function handlePublish() {
  if (!draftSlug) return
  setPublishing(true)
  try {
    // WAS-131: Verificar gate freemium antes de activar
    const gateRes = await fetch('/api/creator/publish-gate')
    if (gateRes.ok) {
      const gate = await gateRes.json()
      setGateData(gate)
      if (gate.requiresFee) {
        if (!gate.hasWallet) {
          setErrors({ endpoint_url: 'Configura tu wallet antes de publicar este agente.' })
          return
        }
        setPublishing(false)
        setShowFeeModal(true)
        return
      }
    }
    // Sin fee requerido → flujo actual continúa
    // ... resto de handlePublish() sin cambios
```

Agregar modal al JSX (justo antes del return final del componente):
```tsx
{showFeeModal && gateData && (
  <ListingFeeModal
    slug={draftSlug!}
    listingFee={gateData.listingFee}
    treasuryAddress={gateData.treasuryAddress}
    creatorWallet={''}  // TODO: leer de creator_profiles — por ahora vacío, modal pide wallet
    locale={locale}
    onCancel={() => setShowFeeModal(false)}
  />
)}
```

Typecheck: `npx tsc --noEmit`

### W5 — Build + Tests (AB-009)

```bash
npm run build        # AB-009 obligatorio — debe pasar sin errores
npx vitest run       # mismos 10 fallos preexistentes, ninguno nuevo
```

## Constraint Directives

### OBLIGATORIO
- Leer PublishForm.tsx completo antes de W4 — anti-alucinación
- `/listing-fee-pay` DEBE validar `authorization.to === TREASURY_ADDRESS` — rechazar 400 si no coincide
- `ListingFeeModal` DEBE verificar `window.ethereum === undefined` — mensaje claro
- `TREASURY_ADDRESS` solo de `process.env.WASIAI_TREASURY_ADDRESS` en backend
- **AB-009:** `npm run build` como check final antes del commit
- Agente NO se activa sin tx confirmada — atomicidad crítica
- EIP-712 payload: NO inventar estructura — usar EXACTAMENTE el del Story File

### PROHIBIDO
- NO modificar `settlePaymentDirectly()` — solo consumir
- NO tocar `invoke/route.ts`
- NO hardcodear fee ni treasury address
- NO usar ethers.js — solo viem v2 + window.ethereum nativo
- NO exponer `TREASURY_ADDRESS` en `NEXT_PUBLIC_*`
- NO activar agente antes de receipt confirmado

## Escalation Rule
Si algo no está en este Story File → PARAR y preguntar al Architect.
