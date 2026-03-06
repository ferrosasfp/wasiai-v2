# SDD #049 — WAS-162: Transparency Dashboard — On-chain Economics

> SPEC_APPROVED: yes (2026-03-05)

---

## 1. Resumen

Dashboard de transparencia económica que lee datos directamente del contrato WasiAIMarketplace y los muestra en la web. Footer compacto en todas las páginas + página dedicada `/transparency`.

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────┐
│  Browser (wagmi useReadContracts)            │
│                                              │
│  Footer: totalVolume, totalInvocations,      │
│          platformFeeBps                      │
│                                              │
│  /transparency: above + agents on-chain list │
│          (from Supabase: on_chain slugs)     │
│          → getAgent(slug) per agent          │
└──────────────┬──────────────────────┬────────┘
               │ RPC (view)          │ REST
               ▼                     ▼
        Avalanche Fuji          Supabase
        (contract)              (agent slugs)
```

**Flujo**:
1. Footer component: `useReadContracts` batch → `totalVolume()`, `totalInvocations()`, `platformFeeBps()`
2. `/transparency` page: lo anterior + query Supabase para slugs `registration_type = 'on_chain'` → `getAgent(slug)` per agent

---

## 3. Archivos a crear

### 3.1 `src/app/api/transparency/stats/route.ts`

API route server-side que lee del contrato y cachea (revalidate 60s). Evita que cada visitante haga RPC calls directos.

```typescript
import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, fromUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
import { getContractAddress } from '@/lib/contracts/config'

export const revalidate = 60 // ISR: cache 60 seconds

export async function GET() {
  try {
    const contractAddress = getContractAddress()
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
    const chain = chainId === 43114 ? avalanche : avalancheFuji

    const client = createPublicClient({ chain, transport: http() })

    const [totalVolume, totalInvocations, platformFeeBps] = await Promise.all([
      client.readContract({ address: contractAddress, abi: WASIAI_MARKETPLACE_ABI, functionName: 'totalVolume' }),
      client.readContract({ address: contractAddress, abi: WASIAI_MARKETPLACE_ABI, functionName: 'totalInvocations' }),
      client.readContract({ address: contractAddress, abi: WASIAI_MARKETPLACE_ABI, functionName: 'platformFeeBps' }),
    ])

    return NextResponse.json({
      volume: fromUSDCAtomics(totalVolume as bigint),
      invocations: Number(totalInvocations),
      feePercent: Number(platformFeeBps) / 100,
    })
  } catch {
    return NextResponse.json({ volume: null, invocations: null, feePercent: null })
  }
}
```

### 3.2 `src/components/transparency/OnChainStats.tsx`

Componente cliente que consume la API cacheada (no hace RPC directo).

```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'

interface Stats {
  volume: number | null
  invocations: number | null
  feePercent: number | null
}

export function OnChainStats() {
  const [stats, setStats] = useState<Stats>({ volume: null, invocations: null, feePercent: null })

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/transparency/stats')
      const data = await res.json()
      setStats(data)
    } catch {
      // graceful fallback — show "—"
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  return (
    <div className="flex items-center gap-6 text-sm text-gray-500">
      <Stat label="Volume" value={stats.volume !== null ? `$${stats.volume.toFixed(2)}` : '—'} />
      <Stat label="Invocations" value={stats.invocations !== null ? stats.invocations.toLocaleString() : '—'} />
      <Stat label="Platform Fee" value={stats.feePercent !== null ? `${stats.feePercent}%` : '—'} />
      <button onClick={fetchStats} className="text-xs text-indigo-500 hover:text-indigo-700">
        ↻
      </button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-medium text-gray-400">{label}:</span>
      <span className="font-semibold text-gray-700">{value}</span>
    </div>
  )
}
```

### 3.3 `src/app/[locale]/transparency/page.tsx`

Página dedicada con stats globales + tabla de agentes on-chain.

```typescript
import { createClient } from '@/lib/supabase/server'
import { TransparencyDashboard } from './TransparencyDashboard'

export default async function TransparencyPage() {
  const supabase = await createClient()

  // Fetch on-chain agent slugs + names from Supabase
  const { data: agents } = await supabase
    .from('agents')
    .select('slug, name, price_per_call')
    .eq('registration_type', 'on_chain')
    .order('name')

  return <TransparencyDashboard agents={agents ?? []} />
}
```

### 3.4 `src/app/[locale]/transparency/TransparencyDashboard.tsx`

```typescript
'use client'

import { OnChainStats } from '@/components/transparency/OnChainStats'
import { useReadContract } from 'wagmi'
import { WASIAI_MARKETPLACE_ABI, fromUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
import { getContractAddress } from '@/lib/contracts/config'

interface Agent {
  slug: string
  name: string
  price_per_call: number
}

export function TransparencyDashboard({ agents }: { agents: Agent[] }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-10">
      <header>
        <h1 className="text-3xl font-bold">Transparency</h1>
        <p className="text-gray-500 mt-2">
          All data read directly from the smart contract. Verifiable on-chain.
        </p>
      </header>

      {/* Global stats */}
      <section className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">Marketplace Stats</h2>
        <OnChainStats />
      </section>

      {/* On-chain agents */}
      <section className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">On-Chain Agents ({agents.length})</h2>
        <div className="space-y-3">
          {agents.map(agent => (
            <AgentRow key={agent.slug} agent={agent} />
          ))}
          {agents.length === 0 && (
            <p className="text-gray-400 text-sm">No on-chain agents yet.</p>
          )}
        </div>
      </section>

      <footer className="text-xs text-gray-400 text-center">
        Contract: {getContractAddress()} · Avalanche Fuji
      </footer>
    </div>
  )
}

function AgentRow({ agent }: { agent: Agent }) {
  const contractAddress = getContractAddress()

  const { data } = useReadContract({
    address: contractAddress,
    abi: WASIAI_MARKETPLACE_ABI,
    functionName: 'getAgent',
    args: [agent.slug],
  })

  const result = data as [string, bigint, bigint] | undefined
  const onChainAtomics = result ? result[1] : null
  const onChainPrice = onChainAtomics !== null ? fromUSDCAtomics(onChainAtomics) : null
  // Compare in atomics to avoid floating point issues
  const dbAtomics = BigInt(Math.round(agent.price_per_call * 1_000_000))
  const isSynced = onChainAtomics !== null && dbAtomics === onChainAtomics

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="font-medium">{agent.name}</span>
      <div className="flex gap-4 text-sm text-gray-500">
        <span>DB: ${agent.price_per_call.toFixed(4)}</span>
        <span>Chain: {onChainPrice !== null ? `$${onChainPrice.toFixed(4)}` : '—'}</span>
        {onChainAtomics !== null && !isSynced && (
          <span className="text-amber-500 text-xs">⚠ desync</span>
        )}
      </div>
    </div>
  )
}
```

---

## 4. Archivos a modificar

### 4.1 Footer — agregar `OnChainStats`

Archivo: el layout footer (probablemente `src/components/layout/Footer.tsx` o similar).

```typescript
import { OnChainStats } from '@/components/transparency/OnChainStats'

// Inside footer JSX, add:
<div className="border-t border-gray-100 pt-4 mt-4">
  <OnChainStats />
</div>
```

### 4.2 `src/lib/contracts/config.ts` (crear si no existe)

Helper para obtener contract address:

```typescript
import type { Address } from 'viem'

export function getContractAddress(): Address {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const addr = chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI
  return (addr ?? '0x') as Address
}
```

### 4.3 `src/lib/contracts/WasiAIMarketplace.ts` — agregar `fromUSDCAtomics`

```typescript
/** Convert USDC atomic units (6 decimals) to human-readable number */
export function fromUSDCAtomics(atomics: bigint): number {
  return Number(atomics) / 1_000_000
}
```

---

## 5. Constraint Directives

- **CD-01**: No nuevas dependencias — usar wagmi (ya en proyecto)
- **CD-02**: No gas — todas las llamadas son `view` (read-only)
- **CD-03**: Si el contrato no responde, mostrar "—" sin romper la página (AC3)
- **CD-04**: No mostrar `getPendingEarnings` por creator — es dato privado
- **CD-05**: Contract address desde env var, no hardcodeado

---

> SPEC_APPROVED: yes (2026-03-05)
