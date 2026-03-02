'use client'

/**
 * /[locale]/sandbox — Sandbox Gratuito
 * WAS-75: Prueba agentes gratis con balance inicial de 0.5 USDC sandbox
 *
 * Nota: Este es un Client Component para manejar estado interactivo del invoker.
 * El balance inicial se carga via fetch al API en el cliente.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

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

interface SandboxCreditsRow {
  balance_usdc: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUsdc(value: number | string): string {
  return `$${parseFloat(String(value)).toFixed(4)} USDC`
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function SandboxPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'es'

  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [inputText, setInputText] = useState<string>('')
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SandboxInvokeResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(true)

  // Cargar agentes activos
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/agents?status=active&limit=50')
      if (res.ok) {
        const data = await res.json() as { agents?: AgentOption[]; data?: AgentOption[] }
        const list: AgentOption[] = data.agents ?? data.data ?? []
        setAgents(list)
        if (list.length > 0 && !selectedSlug) {
          setSelectedSlug(list[0].slug)
        }
      }
    } catch {
      // fail silently — lista vacía
    }
  }, [selectedSlug])

  // Cargar balance sandbox del usuario
  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/sandbox/balance')
      if (res.ok) {
        const data = await res.json() as SandboxCreditsRow
        setBalance(data.balance_usdc ?? 0.5)
      }
    } catch {
      setBalance(0.5) // default si no hay endpoint de balance aún
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchAgents(), fetchBalance()]).finally(() => {
      setLoadingInitial(false)
    })
  }, [fetchAgents, fetchBalance])

  // Invocar agente
  const handleInvoke = async () => {
    if (!selectedSlug) return
    setLoading(true)
    setResult(null)
    setErrorMsg(null)

    let parsedInput: Record<string, unknown> | string = inputText
    try {
      parsedInput = JSON.parse(inputText) as Record<string, unknown>
    } catch {
      parsedInput = inputText
    }

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
      } else {
        const errData = await res.json() as SandboxErrorResponse
        if (res.status === 402) {
          setErrorMsg(
            `Créditos insuficientes. Balance: ${formatUsdc(errData.balance_usdc ?? 0)} | Requerido: ${formatUsdc(errData.required_usdc ?? 0)}`
          )
        } else if (res.status === 429) {
          setErrorMsg(
            `Límite de rate excedido (${errData.limit ?? 10} llamadas/hora). Reintentar en: ${errData.reset_at ?? 'pronto'}`
          )
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

  const selectedAgent = agents.find((a) => a.slug === selectedSlug)

  if (loadingInitial) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-sm">Cargando sandbox…</p>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">🧪 Sandbox — Prueba gratis</h1>
        <p className="text-gray-400 text-sm">
          Invoca agentes sin pagar. Usa tus créditos sandbox iniciales.
        </p>
      </div>

      {/* Balance card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Balance sandbox</p>
          <p className="text-2xl font-bold text-green-400">
            {balance !== null ? formatUsdc(balance) : '—'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Inicial: $0.5000 USDC</p>
          <p className="text-xs text-gray-600 mt-1">10 llamadas/hora máx.</p>
        </div>
      </div>

      {/* Formulario */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 space-y-4">
        {/* Selector de agente */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Seleccionar agente
          </label>
          {agents.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay agentes activos disponibles.</p>
          ) : (
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name} — {formatUsdc(a.price_per_call)}/llamada
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Input (texto o JSON)
          </label>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            rows={4}
            placeholder='{"prompt": "Hola, agente!"}'
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
        </div>

        {/* Botón invocar */}
        <button
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          onClick={handleInvoke}
          disabled={loading || !selectedSlug || agents.length === 0}
        >
          {loading ? 'Invocando…' : 'Invocar gratis →'}
        </button>

        {/* Info del agente seleccionado */}
        {selectedAgent && (
          <p className="text-xs text-gray-600 text-center">
            Costo: {formatUsdc(selectedAgent.price_per_call)} por llamada
          </p>
        )}
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl p-4 mb-6 text-sm">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Resultado</h2>
          <pre className="text-xs text-green-300 bg-gray-950 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap">
            {JSON.stringify(result.result, null, 2)}
          </pre>
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span>Costo deducido: <span className="text-yellow-400">{formatUsdc(result.cost_usdc)}</span></span>
            <span>|</span>
            <span>Restante: <span className="text-green-400">{formatUsdc(result.balance_remaining)}</span></span>
            <span>|</span>
            <span className="font-mono text-gray-600">ID: {result.call_id.slice(0, 8)}…</span>
          </div>
        </div>
      )}
    </main>
  )
}
