'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Phase {
  name: string
  status: 'ok' | 'error'
  detail?: string
}

interface DemoResponse {
  report: string
  phases: Phase[]
  total_cost_usdc: string
  pipeline_id: string
}

const STORAGE_KEY = 'wasi_api_key'

export function DemoPageClient() {
  const [goal, setGoal] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DemoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) setApiKey(stored)
  }, [])

  const handleKeyChange = (val: string) => {
    setApiKey(val)
    localStorage.setItem(STORAGE_KEY, val)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v1/demo/autonomous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ goal }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setResult(data as DemoResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">Autonomous Agent Demo</h1>
      <p className="text-gray-500 mb-6 text-sm">
        Describe a DeFi goal — WasiAI discovers and runs the right agents automatically.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Goal</label>
          <textarea
            className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Analyze AVAX price, safety, and market risk"
            rows={3}
            maxLength={500}
            value={goal}
            onChange={e => setGoal(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Agent Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              className="w-full border rounded-md px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={apiKey}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="sk-..."
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => setShowKey(v => !v)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || goal.trim().length === 0 || apiKey.trim().length === 0}
          className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Running...
            </>
          ) : (
            'Run Demo'
          )}
        </button>
      </form>

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="border rounded-md p-4">
            <h2 className="font-semibold mb-2 text-sm">Report</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.report}</p>
          </div>

          <div className="border rounded-md p-4">
            <h2 className="font-semibold mb-2 text-sm">Pipeline Phases</h2>
            <ul className="space-y-1">
              {result.phases.map((phase, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span>{phase.status === 'ok' ? '✅' : '❌'}</span>
                  <span>
                    <span className="font-medium">{phase.name}</span>
                    {phase.detail && <span className="text-gray-500"> — {phase.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-gray-500">Total cost: ${result.total_cost_usdc} USDC</p>
          <p className="text-xs text-gray-400">Pipeline ID: {result.pipeline_id}</p>
        </div>
      )}
    </div>
  )
}
