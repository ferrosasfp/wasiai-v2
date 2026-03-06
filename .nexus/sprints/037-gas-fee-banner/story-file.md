# Story File #037 — WAS-133: Gas fee dinámico x402 + banner WasiAI Key
> Dev lee SOLO este archivo. No consultar SDD ni Work Item.

## Goal
El usuario que va a invocar un agente vía x402 debe ver el costo real ANTES de pagar:
- precio del creator + gas fee estimado (Chainlink) = total
- Si no tiene WasiAI Key → banner que le explica la alternativa sin gas fee

## Acceptance Criteria
- AC1: Detail page muestra precio total estimado = creator price + gas fee Chainlink
- AC2: Si Chainlink falla → muestra creator price base, sin bloquear nada
- AC3: Sin WasiAI Key activa → banner visible con copy exacto aprobado
- AC4: Con WasiAI Key activa → banner oculto

## Archivos a crear/modificar

| Archivo | Acción |
|---------|--------|
| `src/app/api/v1/models/[slug]/pricing/route.ts` | **Crear** — endpoint GET público |
| `src/features/agents/components/PricingBadge.tsx` | **Crear** — componente cliente |
| `src/features/agents/components/WasiKeyBanner.tsx` | **Crear** — componente cliente |
| `src/app/[locale]/models/[slug]/page.tsx` | Modificar — importar y montar ambos componentes |
| `messages/en.json` | Modificar — i18n del banner |
| `messages/es.json` | Modificar — i18n del banner |

**NO tocar:**
- `src/lib/pricing/overhead.ts` — solo consumir
- `src/lib/defi-risk/chainlink.ts` — solo consumir
- `src/app/api/v1/models/[slug]/invoke/route.ts` — no tocar
- Flujo Agent Key ni flujo de pagos

## Waves

### W1 — Endpoint GET /api/v1/models/[slug]/pricing

Crear `src/app/api/v1/models/[slug]/pricing/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { calcPlatformOverhead } from '@/lib/pricing/overhead'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = createServiceClient()

  const { data: model } = await supabase
    .from('agents')
    .select('price_per_call, creator_price')
    .eq('slug', slug)
    .single()

  if (!model) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const creatorPrice = Number(model.creator_price ?? model.price_per_call)
  const result = await calcPlatformOverhead(creatorPrice)

  return NextResponse.json({
    creatorPrice,
    gasFee:     result.breakdown.gas,
    totalPrice: creatorPrice + result.overhead,
    breakdown:  result.breakdown,
    cached:     result.cached,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
  })
}
```

Verificar con `npx tsc --noEmit` antes de continuar.

### W2 — PricingBadge.tsx

Crear `src/features/agents/components/PricingBadge.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface PricingData {
  creatorPrice: number
  gasFee:       number
  totalPrice:   number
}

interface Props {
  slug:        string
  basePrice:   number  // price_per_call del modelo — fallback si fetch falla
}

export function PricingBadge({ slug, basePrice }: Props) {
  const [data, setData]       = useState<PricingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/models/${slug}/pricing`)
      .then(r => r.ok ? r.json() : null)
      .then((d: PricingData | null) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
  }

  if (!data) {
    // AC2: fail-open — mostrar precio base
    return (
      <span className="text-sm text-gray-600">
        ~${basePrice.toFixed(4)} USDC
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-gray-900">
        ~${data.totalPrice.toFixed(4)} USDC
      </span>
      <span className="text-xs text-gray-500">
        ${data.creatorPrice.toFixed(4)} agente + ${data.gasFee.toFixed(4)} gas
      </span>
    </div>
  )
}
```

### W3 — WasiKeyBanner.tsx

Crear `src/features/agents/components/WasiKeyBanner.tsx`:

Copy EXACTO aprobado (no cambiar palabras):
- ES: "Con una WasiAI Key pagas solo $X / Sin gas fee · Deposita una vez · Úsala cuando quieras"
- EN: "With a WasiAI Key you only pay $X / No gas fee · Deposit once · Use anytime"

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Props {
  locale:      string
  creatorPrice: number  // precio base sin gas — para el $X del copy
}

export function WasiKeyBanner({ locale, creatorPrice }: Props) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    fetch('/api/agent-keys')
      .then(r => {
        if (!r.ok) { setShow(true); return [] }
        return r.json()
      })
      .then((keys: Array<{ status: string }>) => {
        const hasActive = keys.some((k) => k.status === 'active')
        setShow(!hasActive)
      })
      .catch(() => setShow(true)) // sin sesión → mostrar banner
  }, [])

  if (!show) return null

  const isEs = locale === 'es'
  const priceStr = `$${creatorPrice.toFixed(4)}`

  return (
    <div className="rounded-2xl border border-avax-200 bg-avax-50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {isEs
            ? `Con una WasiAI Key pagas solo ${priceStr}`
            : `With a WasiAI Key you only pay ${priceStr}`}
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          {isEs
            ? 'Sin gas fee · Deposita una vez · Úsala cuando quieras'
            : 'No gas fee · Deposit once · Use anytime'}
        </p>
      </div>
      <Link
        href={`/${locale}/agent-keys`}
        className="shrink-0 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-400 transition text-center"
      >
        {isEs ? 'Crear WasiAI Key →' : 'Create WasiAI Key →'}
      </Link>
    </div>
  )
}
```

### W4 — Integrar en detail page

Leer `src/app/[locale]/models/[slug]/page.tsx` completo antes de tocar.

Agregar imports:
```ts
import { PricingBadge }   from '@/features/agents/components/PricingBadge'
import { WasiKeyBanner }  from '@/features/agents/components/WasiKeyBanner'
```

Montar en la sidebar o justo antes del bloque "Agent API":
1. `<PricingBadge slug={model.slug} basePrice={model.price_per_call} />` — solo si `model.price_per_call > 0`
2. `<WasiKeyBanner locale={locale} creatorPrice={model.creator_price ?? model.price_per_call} />` — siempre (se autogestiona)

### W5 — Typecheck + Tests
1. `npx tsc --noEmit` — sin errores
2. `npx vitest run` — mismos 10 fallos preexistentes, ninguno nuevo

## Constraint Directives

### OBLIGATORIO
- Leer detail page completo antes de W4 — anti-alucinación
- PricingBadge: SIEMPRE fail-open si fetch falla — mostrar basePrice, nunca error
- WasiKeyBanner: copy EXACTO como en el Story File — sin parafrasear
- `'use client'` en ambos componentes nuevos
- Typecheck después de cada wave

### PROHIBIDO
- NO modificar overhead.ts ni chainlink.ts
- NO bloquear SSR del detail page
- NO mostrar key_hash ni datos de sesión en el banner
- NO tocar invoke/route.ts
- NO inventar nada fuera de este Story File

## Escalation Rule
Si algo no está en este Story File → PARAR y preguntar al Architect.
