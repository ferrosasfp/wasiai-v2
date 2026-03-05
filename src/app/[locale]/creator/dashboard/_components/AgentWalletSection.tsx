'use client'
/**
 * AgentWalletSection.tsx — UI: wallet self-custody del agente en Fuji
 *
 * WAS-71 Fase 1: address + balance + inicializar
 * Patrón: mismo que WebhooksPanel.tsx (client component, fetch directo)
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

interface WalletData {
  address: string | null
  balanceWei: string
  balanceFormatted: string
  balanceUsdcFormatted: string
}

interface AgentWalletSectionProps {
  agentSlug: string
  agentName?: string
  locale?: string
}

export function AgentWalletSection({ agentSlug, agentName, locale = 'es' }: AgentWalletSectionProps) {
  const t = useTranslations('agentWallet')
  const [wallet, setWallet]     = useState<WalletData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [initializing, setInit] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)

  const fetchWallet = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/agents/${agentSlug}/wallet`)
      if (!res.ok) throw new Error('Error cargando wallet')
      const data = await res.json() as WalletData
      setWallet(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [agentSlug])

  useEffect(() => { fetchWallet() }, [fetchWallet])

  async function initWallet() {
    setInit(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/agents/${agentSlug}/wallet`, { method: 'POST' })
      if (!res.ok) throw new Error('Error inicializando wallet')
      await fetchWallet()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setInit(false)
    }
  }

  function copyAddress() {
    if (!wallet?.address) return
    navigator.clipboard.writeText(wallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fujiExplorer = wallet?.address
    ? `https://testnet.snowscan.xyz/address/${wallet.address}`
    : null

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6 animate-pulse">
        <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
        <div className="h-4 w-64 bg-gray-100 rounded" />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">{t('title')}</p>
          <h3 className="text-base font-semibold text-gray-900">{agentName ?? agentSlug}</h3>
        </div>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{t('network')}</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}

      {!wallet?.address ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            {t('noWallet')}
          </p>
          <button
            onClick={initWallet}
            disabled={initializing}
            className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {initializing ? t('initializing') : t('initWallet')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">

          {/* Dirección con tooltip + copiar */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{t('earningsAddress')}</p>
            <div className="flex items-center gap-2">
              <div className="relative group">
                <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded font-mono cursor-default">
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </code>
                {/* Tooltip dirección completa */}
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 font-mono whitespace-nowrap shadow-lg">
                    {wallet.address}
                  </div>
                </div>
              </div>
              <button
                onClick={copyAddress}
                className="text-xs text-avax-600 hover:text-avax-800 font-medium"
              >
                {copied ? t('copied') : t('copyAddress')}
              </button>
              {fujiExplorer && (
                <a
                  href={fujiExplorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  {t('viewExplorer')}
                </a>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm font-semibold text-gray-900">
                {wallet.balanceUsdcFormatted} USDC
              </span>
              <span className="text-xs text-gray-400">
                ({wallet.balanceFormatted} AVAX)
              </span>
            </div>
          </div>

          {/* CTA principal — depositar en Agent Key */}
          <div className="rounded-xl bg-avax-50 border border-avax-100 p-4">
            <p className="text-sm font-semibold text-gray-900 mb-1">
              {t('agentPayTitle')}
            </p>
            <p className="text-xs text-gray-500 mb-3">
              {t('agentKeyNote')}
            </p>
            <a
              href={`/${locale}/agent-keys`}
              className="inline-block rounded-lg bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-400 transition"
            >
              {t('depositCta')}
            </a>
          </div>

        </div>
      )}
    </section>
  )
}
