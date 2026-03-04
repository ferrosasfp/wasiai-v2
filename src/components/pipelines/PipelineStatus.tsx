'use client'

import { useState } from 'react'
import { AlertTriangle, Copy, Check } from 'lucide-react'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface StepReceipt {
  step:              number
  agent_slug:        string
  cost_usdc:         string
  receipt_signature: string
  call_id:           string
}

export interface PipelineRunState {
  pipelineId:    string | null
  jobId:         string | null
  status:        'idle' | 'running' | 'completed' | 'failed'
  result:        unknown
  receipts:      StepReceipt[]
  totalCost:     string
  error:         string | null
  stepsExecuted: number
}

export interface PipelineStatusProps {
  runState: PipelineRunState
  onReset:  () => void
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PipelineStatus({ runState, onReset }: PipelineStatusProps) {
  const { status, result, receipts, totalCost, error, stepsExecuted, pipelineId } = runState
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(JSON.stringify(result, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (status === 'idle') return null

  return (
    <div className="border rounded-lg p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Ejecución del pipeline</h2>
        {status !== 'running' && (
          <button
            onClick={onReset}
            className="text-sm px-3 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            Nueva ejecución
          </button>
        )}
      </div>

      {/* Estado: running */}
      {status === 'running' && (
        <div className="flex items-center gap-3 text-indigo-600">
          <span className="animate-spin h-5 w-5 border-2 border-indigo-600 border-t-transparent rounded-full inline-block" />
          <span className="text-sm">Ejecutando pipeline...</span>
        </div>
      )}

      {/* Estado: completed */}
      {status === 'completed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-600">
            <span className="text-lg">✅</span>
            <span className="text-sm font-medium">
              Pipeline completado — {stepsExecuted} step{stepsExecuted !== 1 ? 's' : ''} ejecutado{stepsExecuted !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Costo total */}
          <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2">
            <span className="text-sm text-green-700 font-medium">
              Costo total: {totalCost} USDC
            </span>
          </div>

          {/* Pipeline ID */}
          {pipelineId && (
            <div className="text-xs text-gray-400 font-mono">
              Pipeline ID: {pipelineId}
            </div>
          )}

          {/* Resultado */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-700">Resultado</h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                title="Copiar resultado"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 rounded-md p-4 text-xs overflow-auto max-h-64">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>

          {/* Receipts por step (sin receipt_signature) */}
          {receipts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Receipts</h3>
              <div className="space-y-2">
                {receipts.map(r => (
                  <div
                    key={r.call_id || r.step}
                    className="border border-gray-200 rounded-md px-4 py-2 text-xs text-gray-600 flex flex-wrap gap-4"
                  >
                    <span><strong>Step {r.step + 1}</strong></span>
                    <span>Agente: <code className="font-mono">{r.agent_slug}</code></span>
                    <span>Costo: {r.cost_usdc} USDC</span>
                    <span className="text-gray-400 font-mono">
                      Call: {r.call_id ? r.call_id.slice(0, 8) + '…' : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Estado: failed */}
      {status === 'failed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle size={18} />
            <span className="text-sm font-medium">Pipeline fallido</span>
          </div>

          {/* Detalles del error */}
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-2">
            {error && (
              <p className="text-sm text-red-700 leading-relaxed">{error}</p>
            )}
            {stepsExecuted > 0 && (
              <p className="text-xs text-red-400">
                ✓ {stepsExecuted} step{stepsExecuted !== 1 ? 's' : ''} completado{stepsExecuted !== 1 ? 's' : ''} antes del error
              </p>
            )}
          </div>

          {/* Partial receipts */}
          {receipts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Partial receipts</h3>
              <div className="space-y-2">
                {receipts.map(r => (
                  <div
                    key={r.call_id || r.step}
                    className="border border-gray-200 rounded-md px-4 py-2 text-xs text-gray-600 flex flex-wrap gap-4"
                  >
                    <span><strong>Step {r.step + 1}</strong></span>
                    <span>Agente: <code className="font-mono">{r.agent_slug}</code></span>
                    <span>Costo: {r.cost_usdc} USDC</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
