'use client'

import { useState, useTransition, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface FreeTrialToggleProps {
  slug: string
  initialEnabled: boolean
  initialLimit: number
}

export function FreeTrialToggle({
  slug,
  initialEnabled,
  initialLimit,
}: FreeTrialToggleProps) {
  const t = useTranslations('freeTrial')
  const [enabled, setEnabled]        = useState(initialEnabled)
  const [limit, setLimit]            = useState(initialLimit)
  const [toast, setToast]            = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Refs para revert optimista (MAJOR-1: evita closure stale)
  const lastGood   = useRef({ enabled: initialEnabled, limit: initialLimit })
  // Ref para cancelar PATCH en vuelo (MAJOR-2: evita doble PATCH)
  const patchAbort = useRef<AbortController | null>(null)

  async function patch(nextEnabled: boolean, nextLimit: number) {
    patchAbort.current?.abort()
    patchAbort.current = new AbortController()

    try {
      const res = await fetch(`/api/creator/agents/${slug}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          free_trial_enabled: nextEnabled,
          free_trial_limit:   nextLimit,
        }),
        signal: patchAbort.current.signal,
      })

      if (res.ok) {
        lastGood.current = { enabled: nextEnabled, limit: nextLimit }
        const msg = nextEnabled ? t('activated') : t('deactivated')
        setToast(msg)
        setTimeout(() => setToast(null), 3000)
      } else {
        // Revert optimista al último estado bueno conocido
        setEnabled(lastGood.current.enabled)
        setLimit(lastGood.current.limit)
        setToast(t('errorSaving'))
        setTimeout(() => setToast(null), 4000)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setEnabled(lastGood.current.enabled)
      setLimit(lastGood.current.limit)
      setToast(t('errorSaving'))
      setTimeout(() => setToast(null), 4000)
    }
  }

  function handleToggle() {
    const next = !enabled
    setEnabled(next) // optimista
    startTransition(() => { void patch(next, limit) })
  }

  function handleLimitChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1))
    setLimit(val)
  }

  function handleLimitBlur() {
    if (enabled) {
      startTransition(() => { void patch(enabled, limit) })
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 mt-3">
      {/* Header con toggle */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">{t('label')}</p>
          <p className="text-xs text-gray-500 max-w-xs">
            {t('description')}
          </p>
        </div>

        {/* Toggle switch accesible */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('label')}
          onClick={handleToggle}
          disabled={isPending}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-avax-500 focus:ring-offset-2 disabled:opacity-50 ${
            enabled ? 'bg-avax-500' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Input de límite — visible solo cuando toggle está ON */}
      {enabled && (
        <div className="space-y-1">
          <label
            htmlFor={`trial-limit-${slug}`}
            className="block text-xs font-medium text-gray-700"
          >
            {t('limitLabel')}
          </label>
          <input
            id={`trial-limit-${slug}`}
            type="number"
            min={1}
            max={10}
            value={limit}
            onChange={handleLimitChange}
            onBlur={handleLimitBlur}
            disabled={isPending}
            className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500 disabled:opacity-50"
          />
          <p className="text-xs text-gray-400">
            {t('limitHint', { limit, times: limit === 1 ? t('timeSingular') : t('timePlural') })}
          </p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <p
          className={`text-xs font-medium ${
            toast === t('errorSaving') ? 'text-red-600' : 'text-green-600'
          }`}
          role="status"
          aria-live="polite"
        >
          {toast}
        </p>
      )}
    </div>
  )
}
