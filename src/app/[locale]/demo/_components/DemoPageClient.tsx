'use client'

import { useState, useEffect, useRef } from 'react'
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

const PHASE_STEPS = [
  { name: 'discovery',  label: '🔍 Discovering agents for your goal...' },
  { name: 'planning',   label: '🗺️  Planning pipeline steps...' },
  { name: 'execution',  label: '⚡ Executing agents on-chain...' },
  { name: 'report',     label: '📝 Generating report...' },
]

// Approximate timing per phase (ms) — total ~25s budget
const PHASE_DURATIONS = [3500, 2000, 16000, 3500]

export function DemoPageClient() {
  const [goal, setGoal] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DemoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activePhaseIdx, setActivePhaseIdx] = useState(-1)
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) setApiKey(stored)
  }, [])

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout)
    timerRefs.current = []
  }

  function startPhaseAnimation() {
    clearTimers()
    setActivePhaseIdx(0)
    let elapsed = 0
    PHASE_DURATIONS.slice(0, -1).forEach((dur, i) => {
      elapsed += dur
      const t = setTimeout(() => setActivePhaseIdx(i + 1), elapsed)
      timerRefs.current.push(t)
    })
  }

  const handleKeyChange = (val: string) => {
    setApiKey(val)
    localStorage.setItem(STORAGE_KEY, val)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    setActivePhaseIdx(-1)
    setLoading(true)
    startPhaseAnimation()
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
      clearTimers()
      setActivePhaseIdx(-1)
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
              placeholder="wasi_..."
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
          className="w-full bg-avax-500 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-avax-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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

      {/* Live phase progress */}
      {loading && activePhaseIdx >= 0 && (
        <div className="mt-6 border rounded-lg p-4 space-y-2 bg-gray-50">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Pipeline running</p>
          {PHASE_STEPS.map((step, i) => {
            const done = i < activePhaseIdx
            const active = i === activePhaseIdx
            const pending = i > activePhaseIdx
            return (
              <div key={step.name} className={`flex items-center gap-2 text-sm transition-opacity duration-500 ${pending ? 'opacity-30' : 'opacity-100'}`}>
                {done ? (
                  <span className="text-green-500">✅</span>
                ) : active ? (
                  <svg className="animate-spin h-4 w-4 text-avax-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0 inline-block" />
                )}
                <span className={active ? 'font-medium text-gray-800' : done ? 'text-gray-500' : 'text-gray-400'}>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="border rounded-lg p-4">
            <h2 className="font-semibold mb-2 text-sm text-gray-700">Report</h2>
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{result.report}</p>
          </div>

          <div className="border rounded-lg p-4">
            <h2 className="font-semibold mb-3 text-sm text-gray-700">Pipeline Phases</h2>
            <ul className="space-y-2">
              {result.phases.map((phase, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span>{phase.status === 'ok' ? '✅' : '❌'}</span>
                  <span>
                    <span className="font-medium capitalize">{phase.name}</span>
                    {phase.detail && <span className="text-gray-500"> — {phase.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Total cost: <span className="font-medium text-gray-600">${result.total_cost_usdc} USDC</span></span>
            <span>Pipeline: {result.pipeline_id.slice(0, 8)}…</span>
          </div>
        </div>
      )}
    </div>
  )
}
