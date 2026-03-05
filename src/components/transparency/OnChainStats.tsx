'use client'

import { useEffect, useState, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface Stats {
  volume: number | null
  invocations: number | null
  feePercent: number | null
}

async function loadStats(): Promise<Stats> {
  try {
    const res = await fetch('/api/transparency/stats')
    return await res.json()
  } catch {
    return { volume: null, invocations: null, feePercent: null }
  }
}

export function OnChainStats({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('transparency')
  const [stats, setStats] = useState<Stats>({ volume: null, invocations: null, feePercent: null })
  const didFetch = useRef(false)

  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    loadStats().then(setStats)
  }, [])

  if (compact) {
    return (
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span>{t('volume')}: {stats.volume !== null ? `$${stats.volume.toFixed(2)}` : '—'}</span>
        <span>·</span>
        <span>{t('invocations')}: {stats.invocations !== null ? stats.invocations.toLocaleString() : '—'}</span>
        <span>·</span>
        <span>{t('fee')}: {stats.feePercent !== null ? `${stats.feePercent}%` : '—'}</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      <StatCard
        label={t('volume')}
        value={stats.volume !== null ? `$${stats.volume.toFixed(2)}` : '—'}
        icon="💰"
      />
      <StatCard
        label={t('invocations')}
        value={stats.invocations !== null ? stats.invocations.toLocaleString() : '—'}
        icon="📊"
      />
      <StatCard
        label={t('fee')}
        value={stats.feePercent !== null ? `${stats.feePercent}%` : '—'}
        icon="🏷️"
      />
      <button
        onClick={() => loadStats().then(setStats)}
        className="col-span-3 text-xs text-indigo-500 hover:text-indigo-700 text-center"
      >
        ↻ {t('refresh')}
      </button>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="text-center p-4 rounded-xl bg-gray-50">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  )
}
