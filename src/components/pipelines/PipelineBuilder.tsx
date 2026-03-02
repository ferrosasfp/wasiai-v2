'use client'

import { useState, useEffect } from 'react'

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
  onRun:           (steps: ComposeStep[], apiKey: string, mode: 'sync' | 'async') => void
  isRunning:       boolean
  availableAgents: AvailableAgent[]
}

const API_KEY_STORAGE_KEY = 'wasi_pipeline_api_key'
const MAX_STEPS = 5

// ── Componente ────────────────────────────────────────────────────────────────

export function PipelineBuilder({ onRun, isRunning, availableAgents }: PipelineBuilderProps) {
  const [steps, setSteps] = useState<LocalStep[]>([
    { _id: newStepId(), agent_slug: availableAgents[0]?.slug ?? '', input: '', pass_output: false, parallel: false },
  ])
  const [apiKey, setApiKey] = useState('')

  // Cargar API key de localStorage con expiración de 30 días
  useEffect(() => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    const raw = localStorage.getItem(API_KEY_STORAGE_KEY)
    if (raw) {
      try {
        const entry = JSON.parse(raw) as { key: string; savedAt: number }
        if (typeof entry.key === 'string' && typeof entry.savedAt === 'number') {
          if (Date.now() - entry.savedAt < THIRTY_DAYS_MS) {
            setApiKey(entry.key)
          } else {
            localStorage.removeItem(API_KEY_STORAGE_KEY)
          }
        }
      } catch {
        // Formato viejo (string plano) — migrar al nuevo formato
        const entry = { key: raw, savedAt: Date.now() }
        localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(entry))
        setApiKey(raw)
      }
    }
  }, [])

  function handleApiKeyChange(value: string) {
    setApiKey(value)
    const entry = { key: value, savedAt: Date.now() }
    localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(entry))
  }

  function addStep() {
    if (steps.length >= MAX_STEPS) return
    setSteps(prev => [
      ...prev,
      { _id: newStepId(), agent_slug: availableAgents[0]?.slug ?? '', input: '', pass_output: false, parallel: false },
    ])
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  function updateStep(index: number, patch: Partial<LocalStep>) {
    setSteps(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function handleRun() {
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
    onRun(cleaned, apiKey, 'sync')
  }

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
          placeholder="wasi_..."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {!apiKey.trim() && (
          <p className="text-xs text-amber-600 mt-1">
            Ingresa tu API key para ejecutar el pipeline.
          </p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step._id} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Step {index + 1}</span>
              {steps.length > 1 && (
                <button
                  onClick={() => removeStep(index)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Eliminar
                </button>
              )}
            </div>

            {/* Selector de agente */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Agente</label>
              <select
                value={step.agent_slug}
                onChange={e => updateStep(index, { agent_slug: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {availableAgents.map(agent => (
                  <option key={agent.slug} value={agent.slug}>
                    {agent.name} — ${agent.price_per_call.toFixed(6)} USDC
                  </option>
                ))}
              </select>
            </div>

            {/* Input — solo si pass_output=false */}
            {!step.pass_output && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Input</label>
                <textarea
                  value={step.input ?? ''}
                  onChange={e => updateStep(index, { input: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Texto de entrada para este step..."
                />
              </div>
            )}

            {/* Toggles */}
            <div className="flex flex-wrap gap-4">
              {index > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={step.pass_output ?? false}
                    onChange={e => updateStep(index, { pass_output: e.target.checked })}
                    className="rounded"
                  />
                  Usar output del step anterior
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.parallel ?? false}
                  onChange={e => updateStep(index, { parallel: e.target.checked })}
                  className="rounded"
                />
                Ejecutar en paralelo
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* Botones de acción */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={addStep}
          disabled={atMaxSteps}
          className="text-sm px-4 py-2 border border-indigo-300 text-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Agregar step
        </button>
        {atMaxSteps && (
          <span className="text-xs text-amber-600">Máximo 5 steps</span>
        )}
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="text-sm px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isRunning ? (
            <>
              <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full inline-block" />
              Ejecutando...
            </>
          ) : (
            'Ejecutar pipeline'
          )}
        </button>
      </div>
    </div>
  )
}
