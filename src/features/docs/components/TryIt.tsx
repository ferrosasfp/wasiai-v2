'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

interface Agent {
  slug: string
  name: string
}

// Pre-filled example payloads per slug (or category fallback)
const EXAMPLE_PAYLOADS: Record<string, string> = {
  'summarizer':  '{\n  "text": "Paste your text here to summarize..."\n}',
  'translator':  '{\n  "text": "Hello world",\n  "target_lang": "es"\n}',
  'classifier':  '{\n  "text": "Classify this input..."\n}',
  'extractor':   '{\n  "text": "Extract structured data from this..."\n}',
  'default':     '{\n  "input": "Your input here"\n}',
}

function getExamplePayload(slug: string): string {
  return EXAMPLE_PAYLOADS[slug] ?? EXAMPLE_PAYLOADS['default']
}

export function TryIt() {
  const t = useTranslations('docs')

  const [apiKey, setApiKey] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [slug, setSlug] = useState('')
  const [payload, setPayload] = useState(EXAMPLE_PAYLOADS['default'])
  const [response, setResponse] = useState<string | null>(null)
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load API key from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('wasiai_api_key')
    if (stored) setApiKey(stored)
  }, [])

  // Fetch agents list — with AbortController + 30s timeout (BLOQUEANTE 3)
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
          setPayload(getExamplePayload(firstSlug))
        }
      })
      .catch(() => {/* ignore — user can type slug manually */})
      .finally(() => clearTimeout(timeoutId))

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [])

  function handleApiKeyChange(val: string) {
    setApiKey(val)
    localStorage.setItem('wasiai_api_key', val)
  }

  function handleSlugChange(newSlug: string) {
    setSlug(newSlug)
    // Pre-fill example payload when agent changes
    setPayload(getExamplePayload(newSlug))
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

    // BLOQUEANTE 3: AbortController with 30s timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    const start = performance.now()
    try {
      // BLOQUEANTE 2: encodeURIComponent(slug)
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(slug)}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(parsedPayload),
        signal: controller.signal,
      })
      const elapsed = Math.round(performance.now() - start)
      setLatency(elapsed)
      setStatusCode(res.status)
      const text = await res.text()
      let pretty: string
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        pretty = text
      }
      setResponse(pretty)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{t('tryIt')}</h3>

      {/* API Key */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('tryItApiKey')}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          placeholder="wai_..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-avax-500"
        />
        <p className="mt-1 text-xs text-gray-400">Stored only in your browser&apos;s localStorage</p>
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
          onChange={(e) => setPayload(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-avax-500"
        />
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={loading || !apiKey || !slug}
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
          <pre className="overflow-x-auto rounded-lg bg-[#0d1117] p-4 text-xs text-green-400 font-mono leading-relaxed">
            {response}
          </pre>
        </div>
      )}
    </div>
  )
}
