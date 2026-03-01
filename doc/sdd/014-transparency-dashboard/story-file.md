# Story File #014 — WAS-25: Transparency Dashboard
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Página pública `/en/transparency` con métricas reales del protocolo: volumen on-chain, invocaciones, platformFeeBps y top 5 agentes. Link en footer del sitio. ISR 60s.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN cualquier visitante accede a `/en/transparency`, THE página SHALL mostrar totalVolume USDC, totalInvocations y platformFeeBps leídos del contrato on-chain |
| AC2 | WHEN se muestran los datos on-chain, THE página SHALL usar ISR con `revalidate = 60` |
| AC3 | WHEN se muestra el top de agentes, THE lista SHALL mostrar los 5 agentes con más calls con su revenue estimado |
| AC4 | WHEN la página carga, THE tiempo de respuesta SHALL ser < 2s |
| AC5 | WHEN se muestra el volumen, THE valor SHALL estar en USDC legible (dividir atomic / 1_000_000) |
| AC6 | WHEN un visitante está en cualquier página del sitio, THE footer SHALL mostrar link a /transparency |

---

## Archivos a crear / modificar

| Archivo | Acción |
|---|---|
| `src/app/[locale]/transparency/page.tsx` | CREAR — Server Component ISR |
| `src/components/WasiFooter.tsx` | CREAR — footer con link a /transparency |
| `src/app/[locale]/layout.tsx` | MODIFICAR — agregar `<WasiFooter locale={locale} />` antes de `</body>` |
| `messages/en.json` | MODIFICAR — agregar key `transparency` |
| `messages/es.json` | MODIFICAR — agregar key `transparency` en español |

---

## Wave 1 — i18n keys (primero, para poder usarlas en la página)

### messages/en.json — agregar al final del objeto JSON:
```json
"transparency": {
  "title": "Protocol Transparency",
  "subtitle": "Real-time on-chain metrics from the WasiAI marketplace contract on Avalanche",
  "totalVolume": "Total Volume",
  "totalInvocations": "Total Invocations",
  "platformFee": "Platform Fee",
  "topAgents": "Top Agents",
  "rank": "Rank",
  "agent": "Agent",
  "calls": "Calls",
  "estimatedRevenue": "Est. Revenue",
  "footerLink": "Transparency",
  "contractAddress": "Contract",
  "dataSource": "Data sourced directly from the WasiAI Marketplace smart contract on Avalanche Fuji testnet."
}
```

### messages/es.json — agregar la misma key en español:
```json
"transparency": {
  "title": "Transparencia del Protocolo",
  "subtitle": "Métricas en tiempo real del contrato WasiAI en Avalanche",
  "totalVolume": "Volumen Total",
  "totalInvocations": "Invocaciones Totales",
  "platformFee": "Comisión del Protocolo",
  "topAgents": "Top Agentes",
  "rank": "Posición",
  "agent": "Agente",
  "calls": "Llamadas",
  "estimatedRevenue": "Revenue Estimado",
  "footerLink": "Transparencia",
  "contractAddress": "Contrato",
  "dataSource": "Datos obtenidos directamente del contrato WasiAI Marketplace en Avalanche Fuji testnet."
}
```

---

## Wave 2 — Transparency page

### src/app/[locale]/transparency/page.tsx

```typescript
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { getPublicClient }    from '@/shared/lib/web3/client'
import { createServiceClient } from '@/lib/supabase/server'
import { WASIAI_MARKETPLACE_ABI, getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string }>
}

export default async function TransparencyPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('transparency')

  const CONTRACT_ADDRESS = getMarketplaceAddress(
    process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : 43113
  )
  const client  = getPublicClient()
  const supabase = createServiceClient()

  // ── On-chain stats ────────────────────────────────────────────────────────
  // getStats() returns (volume: uint256, invocations: uint256, feeBps: uint16)
  let totalVolumeAtomic = 0n
  let totalInvocations  = 0n
  let platformFeeBps    = 0

  try {
    const stats = await client.readContract({
      address:      CONTRACT_ADDRESS,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'getStats',
    }) as [bigint, bigint, number]

    totalVolumeAtomic = stats[0]
    totalInvocations  = stats[1]
    platformFeeBps    = stats[2]
  } catch {
    // ISR fallback — si el RPC falla, Next.js sirve la última build cacheada
  }

  const totalVolumeUsdc = Number(totalVolumeAtomic) / 1_000_000

  // ── Top 5 agentes desde DB ────────────────────────────────────────────────
  const { data: topAgents } = await supabase
    .from('agents')
    .select('slug, name, total_calls, price_per_call')
    .order('total_calls', { ascending: false })
    .limit(5)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">{t('title')}</h1>
      <p className="text-gray-500 mb-10 text-sm">{t('subtitle')}</p>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
        <StatCard
          label={t('totalVolume')}
          value={`$${totalVolumeUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`}
        />
        <StatCard
          label={t('totalInvocations')}
          value={totalInvocations.toLocaleString()}
        />
        <StatCard
          label={t('platformFee')}
          value={`${(platformFeeBps / 100).toFixed(1)}%`}
        />
      </div>

      {/* Top Agents */}
      <h2 className="text-xl font-semibold mb-4">{t('topAgents')}</h2>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">{t('rank')}</th>
              <th className="px-4 py-3 text-left">{t('agent')}</th>
              <th className="px-4 py-3 text-right">{t('calls')}</th>
              <th className="px-4 py-3 text-right">{t('estimatedRevenue')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(topAgents ?? []).map((agent, i) => (
              <tr key={agent.slug} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-400 font-mono">#{i + 1}</td>
                <td className="px-4 py-3 font-medium">{agent.name}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(agent.total_calls ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-green-600">
                  ${((agent.total_calls ?? 0) * Number(agent.price_per_call)).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Contract reference */}
      <p className="mt-8 text-xs text-gray-400">
        {t('dataSource')}{' '}
        <a
          href={`https://testnet.snowtrace.io/address/${CONTRACT_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600 font-mono"
        >
          {CONTRACT_ADDRESS.slice(0, 10)}…
        </a>
      </p>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-6">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
```

---

## Wave 3 — Footer

### src/components/WasiFooter.tsx

```typescript
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

interface Props {
  locale: string
}

export async function WasiFooter({ locale }: Props) {
  const t = await getTranslations('transparency')

  return (
    <footer className="border-t mt-auto py-6 px-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-gray-400">
        <span>© {new Date().getFullYear()} WasiAI</span>
        <Link
          href={`/${locale}/transparency`}
          className="hover:text-gray-600 transition-colors"
        >
          {t('footerLink')}
        </Link>
      </div>
    </footer>
  )
}
```

---

## Wave 4 — Layout update

### src/app/[locale]/layout.tsx — agregar import y componente

Agregar import al top (junto a los otros imports de componentes):
```typescript
import { WasiFooter } from '@/components/WasiFooter'
```

En el JSX, agregar `<WasiFooter locale={locale} />` justo ANTES del cierre `</NextIntlClientProvider>`:

```tsx
// ANTES:
        <MobileBottomNav locale={locale} userRole={userRole} />
      </Web3Provider>
    </NextIntlClientProvider>

// DESPUÉS:
        <MobileBottomNav locale={locale} userRole={userRole} />
      </Web3Provider>
      <WasiFooter locale={locale} />
    </NextIntlClientProvider>
```

⚠️ WasiFooter va FUERA de Web3Provider (no necesita wagmi). Va DENTRO de NextIntlClientProvider (necesita i18n).

---

## Wave 5 — Typecheck + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit
# 0 errores — si hay errores, corregir antes de continuar

git add -A
git commit -m "feat(WAS-25): transparency dashboard + footer link"
git push origin master master:main
```

---

## Constraint Directives

**OBLIGATORIO:**
- `revalidate = 60` — no SSR por request
- `totalVolumeAtomic / 1_000_000` para convertir a USDC legible
- ABI function name: `getStats` (NO `getMarketplaceStats`)
- `createServiceClient()` de `@/lib/supabase/server` (no `createClient`)
- `getMarketplaceAddress(chainId)` para obtener la dirección del contrato
- Página accesible sin auth — no agregar middleware de protección
- WasiFooter FUERA de Web3Provider, DENTRO de NextIntlClientProvider

**PROHIBIDO:**
- NO crear ruta API `/api/transparency/stats` — datos directo en Server Component
- NO modificar WasiNavBar
- NO agregar gráficas históricas
- NO mostrar datos de creators individuales
- NO agregar auth a la ruta

---

## Escalation Rule
Si `getMarketplaceAddress()` no existe en `WasiAIMarketplace.ts` — usar directamente `process.env.MARKETPLACE_CONTRACT_ADDRESS as \`0x\${string}\``.

Si `createServiceClient()` no exporta desde `@/lib/supabase/server` — verificar el export correcto en ese archivo antes de asumir el nombre.
