'use client'

import { useTranslations } from 'next-intl'

interface AnalyticsSummary {
  totalCalls: number
  calls24h: number
  avgLatencyMs: number
  errorRate: number | null
  uptime24h: number | null
  pendingEarningsUsdc: string
  onchainEarningsUsdc: string | null
}

interface Props {
  summary: AnalyticsSummary
}

function latencyColor(ms: number): string {
  if (ms < 500)  return 'text-green-600'
  if (ms < 2000) return 'text-yellow-600'
  return 'text-red-600'
}

function uptimeColor(uptime: number): string {
  if (uptime >= 0.95) return 'text-green-600'
  if (uptime >= 0.80) return 'text-yellow-600'
  return 'text-red-600'
}

function totalEarnings(pending: string, onchain: string | null): string {
  const p = parseFloat(pending) || 0
  const o = parseFloat(onchain ?? '0') || 0
  return (p + o).toFixed(2)
}

export function SummaryCards({ summary }: Props) {
  const t = useTranslations('analytics')
  const {
    totalCalls, calls24h, avgLatencyMs,
    uptime24h, pendingEarningsUsdc, onchainEarningsUsdc,
  } = summary

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {/* Calls 24h */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-xs text-gray-500 font-medium">{t('calls_24h')}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{calls24h.toLocaleString()}</p>
      </div>

      {/* Total Calls */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-xs text-gray-500 font-medium">{t('total_calls')}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{totalCalls.toLocaleString()}</p>
      </div>

      {/* Avg Latency */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-xs text-gray-500 font-medium">{t('avg_latency')}</p>
        <p className={`mt-1 text-2xl font-bold ${latencyColor(avgLatencyMs)}`}>
          {avgLatencyMs > 0 ? `${avgLatencyMs}ms` : '—'}
        </p>
      </div>

      {/* Uptime 24h */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-xs text-gray-500 font-medium">{t('uptime')}</p>
        <p className={`mt-1 text-2xl font-bold ${uptime24h !== null ? uptimeColor(uptime24h) : 'text-gray-400'}`}>
          {uptime24h !== null ? `${(uptime24h * 100).toFixed(1)}%` : '—'}
        </p>
      </div>

      {/* Earnings */}
      <div className="rounded-xl border border-[#E84142]/20 bg-[#E84142]/5 p-4 shadow-sm">
        <p className="text-xs text-gray-500 font-medium">{t('earnings')} USDC</p>
        <p className="mt-1 text-2xl font-bold text-[#E84142]">
          ${totalEarnings(pendingEarningsUsdc, onchainEarningsUsdc)}
        </p>
        {onchainEarningsUsdc === null && parseFloat(pendingEarningsUsdc) > 0 && (
          <p className="mt-0.5 text-xs text-gray-400">(on-chain pendiente)</p>
        )}
      </div>
    </div>
  )
}
