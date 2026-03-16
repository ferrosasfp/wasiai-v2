'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CopyableOutput } from '@/components/ui/CopyableOutput'

interface Agent {
  slug: string
  name: string
}

export function TryIt() {
  const t = useTranslations('docs')

  const [agents, setAgents]     = useState<Agent[]>([])
  const [slug, setSlug]         = useState('')
  const [payload, setPayload]   = useState('{"input": ""}')
  const [payloadDirty, setPayloadDirty] = useState(false)
  const [response, setResponse] = useState<string | null>(null)
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [latency, setLatency]   = useState<number | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Fetch agents list
  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    fetch('/api/v1/agents', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const list: Agent[] = Array.isArray(data) ? data : (data.agents ?? [])
        setAgents(list)
        if (list.length > 0) {
          const firstSlug = list[0].slug
          setSlug((prev) => prev || firstSlug)
          void fetchAndSetPayload(firstSlug)
        }
      })
      .catch(() => {/* ignore — user can type slug manually */})
      .finally(() => clearTimeout(timeoutId))

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [])

  async function fetchAndSetPayload(newSlug: string) {
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(newSlug)}`, {
        signal: AbortSignal.timeout(5_000)
      })
      if (res.ok) {
        const data = await res.json() as { example_input?: string }
        if (!payloadDirty) setPayload(data.example_input ?? '{"input": ""}')
      }
    } catch {
      if (!payloadDirty) setPayload('{"input": ""}')
    }
  }

  function handleSlugChange(newSlug: string) {
    setSlug(newSlug)
    setPayloadDirty(false)
    void fetchAndSetPayload(newSlug)
  }

  async function handleRun() {
    setError(null)
    setResponse(null)
    setStatusCode(null)
    setLatency(null)
    setLoading(true)

    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(payload)
    } catch {
      setError('Invalid JSON payload')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    const start = performance.now()
    try {
      // Sandbox — no API key needed, uses session auth or anonymous IP limit
      const res = await fetch(`/api/v1/sandbox/invoke/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: parsedPayload }),
        signal: controller.signal,
      })
      const elapsed = Math.round(performance.now() - start)
      setLatency(elapsed)
      setStatusCode(res.status)
      const text = await res.text()

      // Friendly sandbox-specific error messages
      try {
        const json = JSON.parse(text)
        if (json.code === 'insufficient_sandbox_credits') {
          setError(`Sandbox credits exhausted (balance: $${json.balance_usdc} USDC). Create a free account to get more, or use your own API key.`)
          setLoading(false)
          return
        }
        if (json.code === 'sandbox_rate_limited') {
          const reset = new Date(json.reset_at).toLocaleTimeString()
          setError(`Rate limit reached (${json.limit} calls/hour). Resets at ${reset}.`)
          setLoading(false)
          return
        }
        if (json.code === 'anon_rate_limited') {
          setError(`Anonymous limit reached (5 calls/day). ${json.message ?? 'Create a free account to continue.'}`)
          setLoading(false)
          return
        }
        if (json.error === 'sandbox_disabled') {
          setError('This agent is not available in sandbox mode.')
          setLoading(false)
          return
        }
        setResponse(JSON.stringify(json, null, 2))
      } catch {
        setResponse(text)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-4">
      {/* Header + sandbox badge */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{t('tryIt')}</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          🧪 Sandbox — free, no real USDC
        </span>
      </div>

      {/* Limits notice */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 space-y-0.5">
        <p>⚡ <strong>Anonymous:</strong> 5 calls / day (IP-based)</p>
        <p>🔑 <strong>Signed in:</strong> 10 calls / hour + $0.50 USDC sandbox credits</p>
        <p className="text-blue-500">Calls run against real agents but are covered by WasiAI sandbox credits — not your wallet.</p>
      </div>

      {/* Agent slug */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('tryItSlug')}</label>
        {agents.length > 0 ? (
          <select
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-avax-500"
          >
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>{a.name || a.slug}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="my-agent"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-avax-500"
          />
        )}
      </div>

      {/* Payload */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('tryItPayload')}</label>
        <textarea
          value={payload}
          onChange={(e) => { setPayload(e.target.value); setPayloadDirty(true) }}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-avax-500"
        />
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={loading || !slug}
        className="rounded-lg bg-avax-500 px-5 py-2 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50 transition"
      >
        {loading ? '…' : `${t('tryItRun')} ▶`}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">{error}</div>
      )}

      {/* Response */}
      {response !== null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600">{t('tryItResponse')}</span>
            <div className="flex items-center gap-2">
              {statusCode !== null && (
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${statusCode >= 200 && statusCode < 300 ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                  {statusCode}
                </span>
              )}
              {latency !== null && (
                <span className="text-xs text-gray-400">{t('tryItLatency')}: {latency} ms</span>
              )}
            </div>
          </div>
          <CopyableOutput content={response} className="bg-[#0d1117] text-green-400" maxHeightClass="max-h-80" />
        </div>
      )}
    </div>
  )
}
