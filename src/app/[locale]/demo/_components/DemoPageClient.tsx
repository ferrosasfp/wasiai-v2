'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
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
  { name: 'discovery',  icon: '🔍' },
  { name: 'planning',   icon: '🗺️' },
  { name: 'execution',  icon: '⚡' },
  { name: 'report',     icon: '📝' },
]

export function DemoPageClient() {
  const t = useTranslations('demo')

  const [goal, setGoal] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DemoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activePhaseIdx, setActivePhaseIdx] = useState(-1)
  const [donePhases, setDonePhases] = useState<number[]>([])
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
    setDonePhases([])
    setActivePhaseIdx(0)
  }

  function finishAnimation(data: DemoResponse) {
    const total = PHASE_STEPS.length
    for (let i = 0; i < total; i++) {
      const t1 = setTimeout(() => {
        setDonePhases(prev => prev.includes(i) ? prev : [...prev, i])
        setActivePhaseIdx(i + 1)
        if (i === total - 1) {
          const t2 = setTimeout(() => {
            setActivePhaseIdx(-1)
            setDonePhases([])
            setLoading(false)
            setResult(data)
          }, 400)
          timerRefs.current.push(t2)
        }
      }, i * 600)
      timerRefs.current.push(t1)
    }
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
      if (!res.ok) throw new Error(data.error ?? t('errorGeneric'))
      clearTimers()
      finishAnimation(data as DemoResponse)
    } catch (err) {
      clearTimers()
      setActivePhaseIdx(-1)
      setDonePhases([])
      setLoading(false)
      setError(err instanceof Error ? err.message : t('errorGeneric'))
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1 text-gray-900">{t('title')}</h1>
      <p className="text-gray-500 mb-6 text-sm">{t('subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Agent Key — primero, igual que chat */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('apiKeyLabel')}</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="wasi_..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {/* Goal — segundo */}
        <div>
          <textarea
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder={t('goalPlaceholder')}
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500 resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading || goal.trim().length === 0 || apiKey.trim().length === 0}
          className="w-full rounded-lg bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {t('running')}
            </>
          ) : t('run')}
        </button>
      </form>

      {/* Live phase progress */}
      {loading && activePhaseIdx >= 0 && (
        <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('pipelineRunning')}</p>
          {PHASE_STEPS.map((step, i) => {
            const done = donePhases.includes(i)
            const active = i === activePhaseIdx && !done
            const pending = i > activePhaseIdx && !done
            return (
              <div key={step.name} className={`flex items-center gap-2 text-sm transition-opacity duration-500 ${pending ? 'opacity-30' : 'opacity-100'}`}>
                {done ? (
                  <span>✅</span>
                ) : active ? (
                  <svg className="animate-spin h-4 w-4 text-avax-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0 inline-block" />
                )}
                <span className={`${active ? 'font-medium text-gray-800' : done ? 'text-gray-500' : 'text-gray-400'}`}>
                  {step.icon} {step.name}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-gray-100 p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('report')}</h2>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {result.report.replace(/\*\*/g, '').replace(/^\s*[-–—]\s*/gm, '')}
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('phases')}</h2>
            <ul className="space-y-2">
              {result.phases.map((phase, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
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
            <span>{t('totalCost')}: <span className="font-medium text-gray-600">${result.total_cost_usdc} USDC</span></span>
            <span>{t('pipeline')}: {result.pipeline_id.slice(0, 8)}…</span>
          </div>
        </div>
      )}
    </div>
  )
}
