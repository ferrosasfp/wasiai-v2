'use client'

import { useState, useEffect, useRef } from 'react'
import { SummaryCards } from './analytics/SummaryCards'
import { CallsChart } from './analytics/CallsChart'
import { AlertBanner } from './analytics/AlertBanner'

interface Agent {
  id: string
  name: string
}

interface AnalyticsSummary {
  totalCalls: number
  calls24h: number
  avgLatencyMs: number
  errorRate: number | null
  uptime24h: number | null
  pendingEarningsUsdc: string
  onchainEarningsUsdc: string | null
}

interface DayData {
  date: string
  calls: number
}

interface Alert {
  type: string
  agentId: string
  agentName: string
  message: string
}

interface AnalyticsData {
  summary: AnalyticsSummary
  dailySeries: DayData[]
  alerts: Alert[]
}

type Status = 'loading' | 'success' | 'error'

interface State {
  status: Status
  data: AnalyticsData | null
}

interface Props {
  agents: Agent[]
}

export function CreatorAnalytics({ agents }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [state, setState] = useState<State>({ status: 'loading', data: null })
  // Ref to track active fetch — avoids setState on unmounted component
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    const url = selectedAgentId
      ? `/api/creator/analytics?agent_id=${selectedAgentId}`
      : '/api/creator/analytics'

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<AnalyticsData>
      })
      .then(d => {
        if (activeRef.current) setState({ status: 'success', data: d })
      })
      .catch(() => {
        if (activeRef.current) setState({ status: 'error', data: null })
      })

    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      fetch(url)
        .then(r => r.json() as Promise<AnalyticsData>)
        .then(d => {
          if (activeRef.current) setState({ status: 'success', data: d })
        })
        .catch(() => null)
    }, 5 * 60 * 1000)

    return () => {
      activeRef.current = false
      clearInterval(interval)
      activeRef.current = true
    }
  }, [selectedAgentId])

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-gray-900">Analytics</h2>

        {/* Agent dropdown — only show if 2+ agents */}
        {agents.length > 1 && (
          <select
            value={selectedAgentId}
            onChange={e => setSelectedAgentId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#E84142]/30"
          >
            <option value="">Todos los agentes</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>

      {state.status === 'loading' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 h-20 animate-pulse" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          Error cargando analytics. Intenta recargar la página.
        </div>
      )}

      {state.status === 'success' && state.data && (
        <>
          {/* Alertas */}
          {state.data.alerts.length > 0 && <AlertBanner alerts={state.data.alerts} />}

          {/* Summary cards */}
          <SummaryCards summary={state.data.summary} />

          {/* Daily chart */}
          <CallsChart series={state.data.dailySeries} />

          {/* Empty state */}
          {state.data.summary.totalCalls === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
              <p className="text-sm text-gray-500">
                Aún no hay llamadas. Comparte tu agente o intégralo via API.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
