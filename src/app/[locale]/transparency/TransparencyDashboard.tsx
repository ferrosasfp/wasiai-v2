'use client'

import { OnChainStats } from '@/components/transparency/OnChainStats'
import { useReadContract } from 'wagmi'
import { WASIAI_MARKETPLACE_ABI, fromUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
import { getContractAddress } from '@/lib/contracts/config'
import { useTranslations } from 'next-intl'

interface Agent {
  slug: string
  name: string
  price_per_call: number
}

export function TransparencyDashboard({ agents }: { agents: Agent[] }) {
  const t = useTranslations('transparency')
  const contractAddress = getContractAddress()

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-10">
      <header>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-gray-500 mt-2">{t('subtitle')}</p>
      </header>

      {/* Global stats */}
      <section className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">{t('marketplaceStats')}</h2>
        <OnChainStats />
      </section>

      {/* On-chain agents */}
      <section className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">
          {t('onChainAgents')} ({agents.length})
        </h2>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400 font-medium px-2 pb-2">
            <span>{t('agent')}</span>
            <div className="flex gap-8">
              <span>{t('priceDb')}</span>
              <span>{t('priceChain')}</span>
              <span className="w-16" />
            </div>
          </div>
          {agents.map(agent => (
            <AgentRow key={agent.slug} agent={agent} contractAddress={contractAddress} />
          ))}
          {agents.length === 0 && (
            <p className="text-gray-400 text-sm">{t('noAgents')}</p>
          )}
        </div>
      </section>

      <footer className="text-xs text-gray-400 text-center">
        Contract: <code className="bg-gray-50 px-1 rounded">{contractAddress}</code> · Avalanche Fuji
      </footer>
    </div>
  )
}

function AgentRow({ agent, contractAddress }: { agent: Agent; contractAddress: `0x${string}` }) {
  const { data } = useReadContract({
    address: contractAddress,
    abi: WASIAI_MARKETPLACE_ABI,
    functionName: 'getAgent',
    args: [agent.slug],
  })

  const result = data as [string, bigint, bigint] | undefined
  const onChainAtomics = result ? result[1] : null
  const onChainPrice = onChainAtomics !== null ? fromUSDCAtomics(onChainAtomics) : null
  const dbAtomics = BigInt(Math.round(agent.price_per_call * 1_000_000))
  const isSynced = onChainAtomics !== null && dbAtomics === onChainAtomics

  return (
    <div className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-50 border-b border-gray-50 last:border-0">
      <span className="font-medium">{agent.name}</span>
      <div className="flex gap-8 text-sm text-gray-500">
        <span>${agent.price_per_call.toFixed(4)}</span>
        <span>{onChainPrice !== null ? `$${onChainPrice.toFixed(4)}` : '—'}</span>
        <span className="w-16 text-center">
          {onChainAtomics !== null && !isSynced && (
            <span className="text-amber-500 text-xs">⚠ desync</span>
          )}
          {onChainAtomics !== null && isSynced && (
            <span className="text-green-500 text-xs">✓ synced</span>
          )}
        </span>
      </div>
    </div>
  )
}
