'use client'

/**
 * SandboxClient — UI interactiva del sandbox (Client Component)
 * Recibe userId desde el Server Component (page.tsx) que ya verificó auth
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface AgentOption {
  id: string
  slug: string
  name: string
  price_per_call: number
  status: string
}

interface SandboxInvokeResponse {
  result: unknown
  cost_usdc: string
  balance_remaining: string
  call_id: string
}

interface SandboxErrorResponse {
  error: string
  code?: string
  balance_usdc?: string
  required_usdc?: string
  limit?: number
  reset_at?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUsdc(value: number | string): string {
  return `$${parseFloat(String(value)).toFixed(4)}`
}

// ── Componente principal ──────────────────────────────────────────────────────
// userId recibido del Server Component (auth ya verificada allá)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SandboxClient({ userId }: { userId: string | null }) {
  const t = useTranslations('sandbox')
  const [agents, setAgents]               = useState<AgentOption[]>([])
  const [selectedSlug, setSelectedSlug]   = useState<string>('')
  const [inputText, setInputText]         = useState<string>('')
  const [balance, setBalance]             = useState<number | null>(null)
  const [totalCalls, setTotalCalls]       = useState<number>(0)
  const [loading, setLoading]             = useState(false)
  const [result, setResult]               = useState<SandboxInvokeResponse | null>(null)
  const [errorMsg, setErrorMsg]           = useState<string | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(true)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/agents?status=active&limit=50')
      if (res.ok) {
        const data = await res.json() as { agents?: AgentOption[]; data?: AgentOption[] }
        const list: AgentOption[] = data.agents ?? data.data ?? []
        setAgents(list)
        if (list.length > 0 && !selectedSlug) setSelectedSlug(list[0].slug)
      }
    } catch { /* fail silently */ }
  }, [selectedSlug])

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/sandbox/balance')
      if (res.ok) {
        const data = await res.json() as { balance_usdc: number; total_calls: number }
        setBalance(data.balance_usdc ?? 0.5)
        setTotalCalls(data.total_calls ?? 0)
      }
    } catch {
      setBalance(0.5)
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchAgents(), fetchBalance()]).finally(() => setLoadingInitial(false))
  }, [fetchAgents, fetchBalance])

  const handleInvoke = async () => {
    if (!selectedSlug) return
    setLoading(true)
    setResult(null)
    setErrorMsg(null)

    let parsedInput: Record<string, unknown> | string = inputText
    try { parsedInput = JSON.parse(inputText) as Record<string, unknown> } catch { /* use string */ }

    try {
      const res = await fetch(`/api/v1/sandbox/invoke/${selectedSlug}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input: parsedInput }),
      })

      if (res.ok) {
        const data = await res.json() as SandboxInvokeResponse
        setResult(data)
        setBalance(parseFloat(data.balance_remaining))
        setTotalCalls(c => c + 1)
      } else {
        const errData = await res.json() as SandboxErrorResponse
        if (res.status === 402) {
          setErrorMsg(`Créditos insuficientes. Balance: ${formatUsdc(errData.balance_usdc ?? 0)} | Requerido: ${formatUsdc(errData.required_usdc ?? 0)}`)
        } else if (res.status === 429) {
          setErrorMsg(`Límite alcanzado (${errData.limit ?? 10} llamadas/hora). Reintentar en: ${errData.reset_at ?? 'pronto'}`)
        } else if (res.status === 422) {
          setErrorMsg('El agente falló. Se reembolsó el costo. Intenta de nuevo.')
        } else if (res.status === 401) {
          setErrorMsg('Debes iniciar sesión para usar el sandbox.')
        } else if (res.status === 404) {
          setErrorMsg('Agente no encontrado o inactivo.')
        } else {
          setErrorMsg(errData.error ?? 'Error desconocido')
        }
      }
    } catch {
      setErrorMsg('Error de red. Verifica tu conexión.')
    } finally {
      setLoading(false)
    }
  }

  const selectedAgent = agents.find(a => a.slug === selectedSlug)
  const balancePct    = balance !== null ? Math.min(100, (balance / 0.5) * 100) : 100

  if (loadingInitial) {
    return (
      <main className="min-h-screen bg-gray-50 pb-24">
        <div className="mx-auto max-w-2xl px-4 py-10 flex items-center justify-center">
          <p className="text-gray-400 text-sm">Cargando sandbox…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sandbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('subtitle')}
          </p>
        </div>

        {/* Balance card */}
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Balance sandbox</p>
              <p className="text-2xl font-bold text-gray-900">
                {balance !== null ? formatUsdc(balance) : '—'}
                <span className="text-sm font-normal text-gray-400 ml-1">USDC</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{totalCalls} llamadas</p>
              <p className="text-xs text-gray-400 mt-0.5">máx 10/hora</p>
            </div>
          </div>
          {/* Barra de balance */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#E84142] rounded-full transition-all duration-500"
              style={{ width: `${balancePct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Inicial: $0.5000 USDC · Restante: {balancePct.toFixed(0)}%
          </p>
        </section>

        {/* Formulario */}
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
          {/* Selector de agente */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Agente
            </label>
            {agents.length === 0 ? (
              <p className="text-sm text-gray-400">{t('noActiveAgents')}</p>
            ) : (
              <select
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#E84142]/30 focus:border-[#E84142]"
                value={selectedSlug}
                onChange={e => setSelectedSlug(e.target.value)}
              >
                {agents.map(a => (
                  <option key={a.slug} value={a.slug}>
                    {a.name} — {formatUsdc(a.price_per_call)} USDC/llamada
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Input <span className="text-gray-400 font-normal">(texto o JSON)</span>
            </label>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#E84142]/30 focus:border-[#E84142] font-mono resize-none"
              rows={4}
              placeholder='{"prompt": "Hola, agente!"}'
              value={inputText}
              onChange={e => setInputText(e.target.value)}
            />
          </div>

          {/* Costo estimado */}
          {selectedAgent && (
            <p className="text-xs text-gray-400">
              Costo estimado: <span className="font-medium text-gray-600">{formatUsdc(selectedAgent.price_per_call)} USDC</span>
            </p>
          )}

          {/* Botón */}
          <button
            className="w-full bg-[#E84142] hover:bg-[#d03536] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
            onClick={handleInvoke}
            disabled={loading || !selectedSlug || agents.length === 0}
          >
            {loading ? 'Invocando…' : 'Invocar gratis →'}
          </button>
        </section>

        {/* Error */}
        {errorMsg && (
          <section className="rounded-2xl border border-red-100 bg-red-50 p-4">
            <p className="text-sm text-red-600">⚠️ {errorMsg}</p>
          </section>
        )}

        {/* Resultado */}
        {result && (
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Resultado</h2>
              <div className="flex gap-3 text-xs text-gray-400">
                <span>Costo: <span className="text-gray-700 font-medium">{formatUsdc(result.cost_usdc)}</span></span>
                <span>·</span>
                <span>Restante: <span className="text-[#E84142] font-medium">{formatUsdc(result.balance_remaining)}</span></span>
              </div>
            </div>
            <pre className="text-xs text-gray-800 bg-gray-50 border border-gray-100 rounded-xl p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
              {JSON.stringify(result.result, null, 2)}
            </pre>
            <p className="text-xs text-gray-400 font-mono">
              ID: {result.call_id.slice(0, 8)}…
            </p>
          </section>
        )}

      </div>
    </main>
  )
}
