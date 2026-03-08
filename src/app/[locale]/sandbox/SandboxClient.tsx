'use client'

/**
 * SandboxClient — UI interactiva del sandbox (Client Component)
 * Recibe userId desde el Server Component (page.tsx) que ya verificó auth
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
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
export function SandboxClient({ userId }: { userId: string | null }) {
  const t = useTranslations('sandbox')
  const isAnonymous = !userId
  const [agents, setAgents]               = useState<AgentOption[]>([])
  const [selectedSlug, setSelectedSlug]   = useState<string>('')
  const [inputText, setInputText]         = useState<string>('')
  const [balance, setBalance]             = useState<number | null>(null)
  const [totalCalls, setTotalCalls]       = useState<number>(0)
  const [loading, setLoading]             = useState(false)
  const [result, setResult]               = useState<SandboxInvokeResponse | null>(null)
  const [errorMsg, setErrorMsg]           = useState<string | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [anonLimitHit, setAnonLimitHit]   = useState(false)

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
    if (!userId) { setBalance(null); return }
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
  }, [userId])

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
          setErrorMsg(t('errorInsufficient', { balance: formatUsdc(errData.balance_usdc ?? 0), required: formatUsdc(errData.required_usdc ?? 0) }))
        } else if (res.status === 429) {
          if (errData.code === 'anon_rate_limited') {
            setAnonLimitHit(true)
            setErrorMsg(null)
          } else {
            setErrorMsg(t('errorRateLimit', { limit: errData.limit ?? 10, reset: errData.reset_at ?? '—' }))
          }
        } else if (res.status === 422) {
          setErrorMsg(t('errorAgentFailed'))
        } else if (res.status === 401) {
          setErrorMsg(t('errorLogin'))
        } else if (res.status === 404) {
          setErrorMsg(t('errorNotFound'))
        } else {
          setErrorMsg(errData.error ?? t('error'))
        }
      }
    } catch {
      setErrorMsg(t('errorNetwork'))
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
          <p className="text-gray-400 text-sm">{t('loading')}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">

        {/* Testing banner */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          🧪 {t('testingBanner')}
        </div>

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sandbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('subtitle')}
          </p>
        </div>

        {/* Balance card */}
        {!isAnonymous && (
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{t('balanceLabel')}</p>
              <p className="text-2xl font-bold text-gray-900">
                {balance !== null ? formatUsdc(balance) : '—'}
                <span className="text-sm font-normal text-gray-400 ml-1">USDC</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{t('callsCount', { count: totalCalls })}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('maxPerHour')}</p>
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
            {t('initialBalance')} · {t('remaining', { pct: balancePct.toFixed(0) })}
          </p>
        </section>
        )}

        {/* Formulario */}
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
          {/* Selector de agente */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('agentLabel')}
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
                    {a.name} — {formatUsdc(a.price_per_call)} {t('usdcPerCall')}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('inputLabel')} <span className="text-gray-400 font-normal">({t('inputHint')})</span>
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
              {t('estimatedCost')} <span className="font-medium text-gray-600">{formatUsdc(selectedAgent.price_per_call)} USDC</span>
            </p>
          )}

          {/* Botón */}
          <button
            className="w-full bg-[#E84142] hover:bg-[#d03536] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
            onClick={handleInvoke}
            disabled={loading || !selectedSlug || agents.length === 0 || anonLimitHit}
          >
            {loading ? t('invoking') : t('invokeBtn')}
          </button>
        </section>

        {/* Anonymous limit banner */}
        {anonLimitHit && (
          <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-center space-y-3">
            <p className="text-sm text-blue-800 font-medium">{t('anonLimitTitle')}</p>
            <Link
              href="/auth/login"
              className="inline-block bg-[#E84142] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#d03536] transition-colors"
            >
              {t('anonLimitCta')}
            </Link>
          </section>
        )}

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
              <h2 className="text-sm font-semibold text-gray-700">{t('resultTitle')}</h2>
              <div className="flex gap-3 text-xs text-gray-400">
                <span>{t('resultCost')} <span className="text-gray-700 font-medium">{formatUsdc(result.cost_usdc)}</span></span>
                <span>·</span>
                <span>{t('resultRemaining')} <span className="text-[#E84142] font-medium">{formatUsdc(result.balance_remaining)}</span></span>
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
