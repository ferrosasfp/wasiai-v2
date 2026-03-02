'use client'
/**
 * AgentWalletSection.tsx — UI: wallet self-custody del agente en Fuji
 *
 * WAS-71 Fase 1: address + balance + inicializar
 * Patrón: mismo que WebhooksPanel.tsx (client component, fetch directo)
 */
import { useState, useEffect, useCallback } from 'react'

interface WalletData {
  address: string | null
  balanceWei: string
  balanceFormatted: string
}

interface AgentWalletSectionProps {
  agentSlug: string
}

export function AgentWalletSection({ agentSlug }: AgentWalletSectionProps) {
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
        <h3 className="text-base font-semibold text-gray-900">Wallet del Agente</h3>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Fuji Testnet</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}

      {!wallet?.address ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            Este agente no tiene wallet propia. Inicializa una para habilitar pagos autónomos en el futuro.
          </p>
          <button
            onClick={initWallet}
            disabled={initializing}
            className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {initializing ? 'Inicializando…' : 'Inicializar wallet'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded font-mono">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </code>
            <button
              onClick={copyAddress}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
            {fujiExplorer && (
              <a
                href={fujiExplorer}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Ver en explorer ↗
              </a>
            )}
          </div>
          <p className="text-sm text-gray-600">
            Balance (Fuji AVAX): <span className="font-medium">{wallet.balanceFormatted} AVAX</span>
          </p>
          <p className="text-xs text-gray-400">
            Los pagos agente→agente estarán disponibles en Sprint 16.
          </p>
        </div>
      )}
    </section>
  )
}
