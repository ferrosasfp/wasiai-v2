import { setRequestLocale, getTranslations } from 'next-intl/server'
import { getPublicClient }    from '@/shared/lib/web3/client'
import { createClient } from '@/lib/supabase/server'
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
  // NG-013: createClient() respeta RLS — página pública no necesita bypass
  const supabase = await createClient()

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
