'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CreateModelDraft } from '@/lib/schemas/model.schema'
import { DollarSign, Rocket } from 'lucide-react'

interface Props {
  data: Partial<CreateModelDraft>
  onChange: (field: string, value: unknown) => void
  errors: Record<string, string>
  onPublish: () => void
  onBack: () => void
  publishing: boolean
}

export function Step3Technical({ data, onChange, errors, onPublish, onBack, publishing }: Props) {
  const t = useTranslations('publish')
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<{
    ok: boolean
    status?: number
    latencyMs?: number
    error?: string
  } | null>(null)
  const [testing, setTesting] = useState(false)

  function handlePublish() {
    const errs: Record<string, string> = {}
    if (!data.endpoint_url || !data.endpoint_url.trim()) {
      errs.endpoint_url = 'La URL del endpoint es obligatoria'
    } else {
      try {
        new URL(data.endpoint_url)
      } catch {
        errs.endpoint_url = 'Debe ser una URL válida (https://...)'
      }
    }
    if (Object.keys(errs).length > 0) {
      setLocalErrors(errs)
      return
    }
    setLocalErrors({})
    onPublish()
  }

  const allErrors = { ...localErrors, ...errors }

  async function handleTest() {
    if (!data.endpoint_url) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/creator/test-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint_url: data.endpoint_url,
          auth_header:  (data as Record<string, unknown>).auth_header as string | undefined,
        }),
      })
      const json = await res.json()
      if (res.status === 429) {
        setTestResult({ ok: false, error: 'rate_limit' })
      } else if (!res.ok) {
        setTestResult({ ok: false, error: json.error ?? 'error' })
      } else {
        setTestResult(json)
      }
    } catch {
      setTestResult({ ok: false, error: 'unreachable' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Configuración técnica</h2>
        <p className="mt-1 text-sm text-gray-500">Endpoint de tu API y autenticación</p>
      </div>

      {/* Endpoint URL */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          URL del endpoint <span className="text-red-400">*</span>
        </label>
        <input
          type="url"
          value={data.endpoint_url ?? ''}
          onChange={e => {
            onChange('endpoint_url', e.target.value)
            if (localErrors.endpoint_url) setLocalErrors(prev => { const e = { ...prev }; delete e.endpoint_url; return e })
          }}
          placeholder="https://tu-api.com/predict"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
        />
        {allErrors.endpoint_url && (
          <p className="mt-1 text-xs text-red-500">{allErrors.endpoint_url}</p>
        )}

        {/* Test endpoint button + result */}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !data.endpoint_url}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {testing ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                {t('step3Testing')}
              </span>
            ) : t('step3TestBtn')}
          </button>
        </div>

        {testResult && (
          <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${
            testResult.ok
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {testResult.ok
              ? `✅ OK · ${testResult.latencyMs}ms`
              : testResult.error === 'timeout'
                ? '❌ No alcanzable (timeout > 5s)'
                : testResult.error === 'rate_limit'
                  ? '⏳ Demasiadas pruebas — espera un momento'
                  : `⚠️ Error ${testResult.status ?? ''} — ${testResult.error ?? 'verifica tu endpoint'}`
            }
            <p className="mt-1 text-xs opacity-60">
              El timeout de producción puede variar según la carga del servidor.
            </p>
          </div>
        )}
      </div>

      {/* HTTP Method */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Método HTTP
        </label>
        <select
          value={(data as Record<string, unknown>).http_method as string ?? 'POST'}
          onChange={e => onChange('http_method', e.target.value)}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
        </select>
      </div>

      {/* Auth header */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Authorization header <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <input
          type="password"
          value={(data as Record<string, unknown>).auth_header as string ?? ''}
          onChange={e => onChange('auth_header', e.target.value)}
          placeholder="Bearer sk-..."
          autoComplete="off"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
        />
        <p className="mt-1 text-xs text-gray-400">
          {t('step3AuthNote')} <code>Authorization</code>
        </p>
      </div>

      {/* Info box */}
      <div className="rounded-xl bg-avax-50 p-4 text-sm text-avax-700">
        <span className="inline-flex items-center gap-1"><DollarSign size={12} />{t('step3EarningsNote')}</span>
      </div>

      {/* General error */}
      {allErrors.general && (
        <p className="text-sm text-red-500">{allErrors.general}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={publishing}
          className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
        >
          ← {t('cta.back')}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing}
          className="rounded-xl bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-2">{publishing ? t('cta.publishing') : t('cta.publish')} <Rocket size={14} /></span>
        </button>
      </div>
    </div>
  )
}
