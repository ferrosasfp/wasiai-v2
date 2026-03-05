'use client'

import { useState } from 'react'
import { PipelineBuilder }                   from '@/components/pipelines/PipelineBuilder'
import { PipelineStatus, PipelineRunState }  from '@/components/pipelines/PipelineStatus'
import { PipelineHistory }                   from '@/components/pipelines/PipelineHistory'
import { useTranslations }                   from 'next-intl'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
  parallel?:    boolean
}

interface StepReceipt {
  step:              number
  agent_slug:        string
  cost_usdc:         string
  receipt_signature: string
  call_id:           string
}

interface ComposeResponse {
  pipeline_id:     string
  steps_executed:  number
  groups_executed: number
  total_cost_usdc: string
  result:          unknown
  receipts:        StepReceipt[]
}

interface PipelineFailedResponse {
  error:            string
  code:             'step_failed'
  failed_step:      number
  reason:           string
  steps_executed:   number
  partial_receipts: StepReceipt[]
}

interface AvailableAgent {
  slug:           string
  name:           string
  price_per_call: number
}

interface PipelinePageClientProps {
  availableAgents: AvailableAgent[]
  userId:          string
}

// ── Estado inicial ────────────────────────────────────────────────────────────

const INITIAL_RUN_STATE: PipelineRunState = {
  pipelineId:    null,
  jobId:         null,
  status:        'idle',
  result:        null,
  receipts:      [],
  totalCost:     '0.000000',
  error:         null,
  stepsExecuted: 0,
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PipelinePageClient({ availableAgents, userId }: PipelinePageClientProps) {
  const t = useTranslations('pipelines')
  const [runState, setRunState] = useState<PipelineRunState>(INITIAL_RUN_STATE)
  const [historyKey, setHistoryKey] = useState(0)

  async function handleRun(steps: ComposeStep[], apiKey: string) {
    setRunState({ ...INITIAL_RUN_STATE, status: 'running' })

    try {
      const res = await fetch('/api/v1/compose', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    apiKey,
        },
        body: JSON.stringify({ steps }),
      })

      if (res.ok) {
        const data = (await res.json()) as ComposeResponse
        setRunState({
          pipelineId:    data.pipeline_id,
          jobId:         null,
          status:        'completed',
          result:        data.result,
          receipts:      data.receipts,
          totalCost:     data.total_cost_usdc,
          error:         null,
          stepsExecuted: data.steps_executed,
        })
        // Refrescar historial
        setHistoryKey(k => k + 1)
      } else {
        const errData = (await res.json()) as Partial<PipelineFailedResponse>
        setRunState({
          pipelineId:    null,
          jobId:         null,
          status:        'failed',
          result:        null,
          receipts:      errData.partial_receipts ?? [],
          totalCost:     '0.000000',
          error:         errData.reason ?? errData.error ?? 'Error desconocido',
          stepsExecuted: errData.steps_executed ?? 0,
        })
      }
    } catch (err) {
      setRunState({
        ...INITIAL_RUN_STATE,
        status: 'failed',
        error:  err instanceof Error ? err.message : 'Error de red',
      })
    }
  }

  function handleReset() {
    setRunState(INITIAL_RUN_STATE)
  }

  const isRunning = runState.status === 'running'

  return (
    <div className="space-y-10">
      {/* Builder — siempre visible excepto cuando hay status activo */}
      {runState.status === 'idle' || runState.status === 'running' ? (
        <section className="border rounded-lg p-6 space-y-4 bg-white shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800">{t('configure')}</h2>
          {availableAgents.length === 0 ? (
            <p className="text-sm text-amber-600">{t('noActiveAgents')}</p>
          ) : (
            <PipelineBuilder
              onRun={handleRun}
              isRunning={isRunning}
              availableAgents={availableAgents}
            />
          )}
        </section>
      ) : (
        <section className="border rounded-lg p-6 bg-white shadow-sm">
          <PipelineStatus runState={runState} onReset={handleReset} />
        </section>
      )}

      {/* Historial */}
      {userId && (
        <section>
          <PipelineHistory key={historyKey} userId={userId} />
        </section>
      )}
      {!userId && (
        <p className="text-sm text-gray-400 text-center">
          {t('historyLogin')}
        </p>
      )}
    </div>
  )
}
