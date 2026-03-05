'use client'

import { useState, useEffect, useReducer, useRef } from 'react'
import { Trash2, Plus, ArrowDown, Play, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
  parallel?:    boolean
}

// Estado local — _id es solo para React key, nunca se envía a la API
interface LocalStep extends ComposeStep {
  _id: string
}

let _stepCounter = 0
function newStepId(): string {
  return `step-${++_stepCounter}-${Date.now()}`
}

interface AvailableAgent {
  slug:           string
  name:           string
  price_per_call: number
}

export interface PipelineBuilderProps {
  onRun:           (steps: ComposeStep[], apiKey: string) => void
  isRunning:       boolean
  availableAgents: AvailableAgent[]
}

const API_KEY_STORAGE_KEY = 'wasi_pipeline_api_key'
const MAX_STEPS = 5

// ── Validación client-side ────────────────────────────────────────────────────
function validateStepsClient(steps: LocalStep[], tFn: (k: string, v?: Record<string, string | number | Date>) => string): string | null {
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].agent_slug) return `Step ${i + 1}: select an agent.`
    if (!steps[i].pass_output && !steps[i].input?.trim()) {
      return tFn('stepValidation', { n: i + 1 })
    }
  }
  return null
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PipelineBuilder({ onRun, isRunning, availableAgents }: PipelineBuilderProps) {
  const t = useTranslations('pipelines')
  const [steps, setSteps] = useState<LocalStep[]>([
    { _id: newStepId(), agent_slug: availableAgents[0]?.slug ?? '', input: '', pass_output: false, parallel: false },
  ])
  const [validationError, setValidationError] = useState<string | null>(null)
  const [mounted, markMounted] = useReducer(() => true, false)
  useEffect(markMounted, [markMounted])

  const [apiKey, setApiKey] = useState('')

  // Leer localStorage después de hidratación via callback ref en el input
  // (evita setState-in-effect que el React compiler prohíbe)
  const apiKeyInitialized = useRef(false)
  function initApiKeyFromStorage() {
    if (apiKeyInitialized.current) return
    apiKeyInitialized.current = true
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    const raw = localStorage.getItem(API_KEY_STORAGE_KEY)
    if (!raw) return
    try {
      const entry = JSON.parse(raw) as { key: string; savedAt: number }
      if (typeof entry.key === 'string' && typeof entry.savedAt === 'number') {
        if (Date.now() - entry.savedAt < THIRTY_DAYS_MS) { setApiKey(entry.key); return }
        localStorage.removeItem(API_KEY_STORAGE_KEY)
      }
    } catch {
      localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify({ key: raw, savedAt: Date.now() }))
      setApiKey(raw)
    }
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value)
    const entry = { key: value, savedAt: Date.now() }
    localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(entry))
  }

  function addStep() {
    if (steps.length >= MAX_STEPS) return
    setValidationError(null)
    setSteps(prev => [
      ...prev,
      // Steps 2+ tienen pass_output:true por default — encadenar es el caso de uso principal
      { _id: newStepId(), agent_slug: availableAgents[0]?.slug ?? '', input: '', pass_output: true, parallel: false },
    ])
  }

  function removeStep(index: number) {
    setValidationError(null)
    setSteps(prev => {
      const next = prev.filter((_, i) => i !== index)
      // Si el nuevo step 0 tenía pass_output:true, lo desactivamos (step 0 no puede usar output previo)
      if (next[0]?.pass_output) {
        next[0] = { ...next[0], pass_output: false }
      }
      return next
    })
  }

  function updateStep(index: number, patch: Partial<LocalStep>) {
    setValidationError(null)
    setSteps(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function handleRun() {
    const err = validateStepsClient(steps, t)
    if (err) {
      setValidationError(err)
      return
    }
    setValidationError(null)

    const cleaned: ComposeStep[] = steps.map((s: LocalStep) => {
      const step: ComposeStep = { agent_slug: s.agent_slug }
      if (s.pass_output) {
        step.pass_output = true
      } else {
        step.input = s.input ?? ''
      }
      if (s.parallel) step.parallel = true
      return step
    })
    onRun(cleaned, apiKey)
  }

  const totalCost = steps.reduce((acc, s) => {
    const agent = availableAgents.find(a => a.slug === s.agent_slug)
    return acc + (agent?.price_per_call ?? 0)
  }, 0)

  const canRun = !isRunning && steps.length > 0 && apiKey.trim().length > 0
  const atMaxSteps = steps.length >= MAX_STEPS

  return (
    <div className="space-y-6">
      {/* API Key */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => handleApiKeyChange(e.target.value)}
          onFocus={initApiKeyFromStorage}
          ref={el => { if (el) initApiKeyFromStorage() }}
          placeholder="wasi_..."
          className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-avax-400"
          suppressHydrationWarning
        />
        {mounted && !apiKey.trim() && (
          <p className="text-xs text-amber-600 mt-1" suppressHydrationWarning>
            {t('enterApiKey')}
          </p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={step._id}>
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
              {/* Header del step */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-avax-100 text-xs font-bold text-avax-600">
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">Step {index + 1}</span>
                  {step.pass_output && index > 0 && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 font-medium">
                      {t('stepChained')}
                    </span>
                  )}
                  {step.parallel && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 font-medium">
                      {t('stepParallel')}
                    </span>
                  )}
                </div>
                {steps.length > 1 && (
                  <button
                    onClick={() => removeStep(index)}
                    className="text-gray-400 hover:text-red-500 transition"
                    title={t('stepRemove')}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {/* Selector de agente */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('stepAgent')}</label>
                <select
                  value={step.agent_slug}
                  onChange={e => updateStep(index, { agent_slug: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-avax-400"
                >
                  {availableAgents.map(agent => (
                    <option key={agent.slug} value={agent.slug}>
                      {agent.name} — ${agent.price_per_call.toFixed(6)} USDC
                    </option>
                  ))}
                </select>
              </div>

              {/* Toggles — pass_output + parallel */}
              {index > 0 && (
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={step.pass_output ?? false}
                      onChange={e => updateStep(index, { pass_output: e.target.checked, input: '' })}
                      className="rounded accent-avax-500"
                    />
                    {t('stepUseOutput')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={step.parallel ?? false}
                      onChange={e => updateStep(index, { parallel: e.target.checked })}
                      className="rounded accent-avax-500"
                    />
                    {t('stepUseParallel')}
                  </label>
                </div>
              )}

              {/* Input — solo si pass_output=false */}
              {!step.pass_output && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Input{index === 0 ? ' (requerido)' : ' (requerido si no encadenas)'}
                  </label>
                  <textarea
                    value={step.input ?? ''}
                    onChange={e => updateStep(index, { input: e.target.value })}
                    rows={3}
                    className={`w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-avax-400 ${
                      !step.input?.trim() ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                    }`}
                    placeholder={t('stepInputPlaceholder')}
                  />
                  {!step.input?.trim() && (
                    <p className="mt-1 text-xs text-amber-600">
                      {t('stepInputRequired')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Conector visual entre steps */}
            {index < steps.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowDown size={16} className="text-gray-300" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error de validación */}
      {validationError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {validationError}
        </div>
      )}

      {/* Footer — costo total + botones */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={addStep}
            disabled={atMaxSteps || isRunning}
            className="flex items-center gap-1.5 text-sm px-4 py-2 border border-avax-300 text-avax-600 rounded-xl hover:bg-avax-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Plus size={14} /> {t('addStep')}
          </button>
          {atMaxSteps && (
            <span className="text-xs text-amber-600">{t('maxSteps', { n: 5 })}</span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {steps.length > 1 && (
            <span className="text-xs text-gray-500">
              Costo estimado: <strong className="text-gray-700">${totalCost.toFixed(6)} USDC</strong>
            </span>
          )}
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="flex items-center gap-2 text-sm px-6 py-2.5 bg-avax-500 text-white rounded-xl hover:bg-avax-600 disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold shadow-sm"
          >
            {isRunning ? (
              <><Loader2 size={14} className="animate-spin" /> Ejecutando…</>
            ) : (
              <><Play size={14} /> {t('runBtn')}</>
            )}
          </button>
        </div>
      </div>

      {/* Leyenda rápida si hay más de 1 step */}
      {steps.length > 1 && (
        <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 space-y-1">
          <p>{t('chainedNote')}</p>
          <p>{t('parallelNote')}</p>
        </div>
      )}
    </div>
  )
}
