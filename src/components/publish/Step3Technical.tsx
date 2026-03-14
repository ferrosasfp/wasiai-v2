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
      errs.endpoint_url = t('step3EndpointRequired')
    } else {
      try {
        new URL(data.endpoint_url)
      } catch {
        errs.endpoint_url = t('step3EndpointInvalid')
      }
    }
    // WAS-200: bloquear si REQUIRE_INPUT_SCHEMA=true y no hay schema
    if (process.env.NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA === 'true') {
      if (!data.input_schema) {
        errs.input_schema = t('step3SchemaRequiredError')
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
        <h2 className="text-xl font-bold text-gray-900">{t('step3Title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('step3Subtitle')}</p>
      </div>

      {/* Endpoint URL */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('step3EndpointLabel')} <span className="text-red-400">*</span>
        </label>
        <input
          type="url"
          value={data.endpoint_url ?? ''}
          onChange={e => {
            onChange('endpoint_url', e.target.value)
            if (localErrors.endpoint_url) setLocalErrors(prev => { const e = { ...prev }; delete e.endpoint_url; return e })
          }}
          placeholder={t('step3EndpointPlaceholder')}
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
              ? t('step3TestOk', { ms: testResult.latencyMs ?? 0 })
              : testResult.error === 'timeout'
                ? t('step3TestTimeout')
                : testResult.error === 'rate_limit'
                  ? t('step3TestRateLimit')
                  : t('step3TestError', { status: testResult.status ?? '', error: testResult.error ?? '' })
            }
            <p className="mt-1 text-xs opacity-60">
              {t('step3TestNote')}
            </p>
          </div>
        )}
      </div>

      {/* HTTP Method */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('step3HttpMethod')}
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
          {t('step3AuthLabel')} <span className="font-normal text-gray-400">{t('step3AuthOptional')}</span>
        </label>
        <input
          type="password"
          value={(data as Record<string, unknown>).auth_header as string ?? ''}
          onChange={e => onChange('auth_header', e.target.value)}
          placeholder={t('step3AuthPlaceholder')}
          autoComplete="off"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
        />
        <p className="mt-1 text-xs text-gray-400">
          {t('step3AuthNote')} <code>Authorization</code>
        </p>
      </div>

      {/* WAS-196: Sandbox opt-in/out */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-gray-700">{t('step3SandboxLabel')}</label>
          <p className="text-xs text-gray-400">
            {t('step3SandboxDesc')}<br />
            {t('step3SandboxNote')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange('sandbox_enabled', !(data.sandbox_enabled ?? true))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${(data.sandbox_enabled ?? true) ? 'bg-avax-500' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${(data.sandbox_enabled ?? true) ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* WAS-200: Input Schema — obligatorio/opcional según env var */}
      {(() => {
        const required = process.env.NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA === 'true'
        const hasSchema = data.input_schema !== null && data.input_schema !== undefined
        return (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('step3SchemaLabel')}{' '}
              {required
                ? <span className="text-red-500">*</span>
                : <span className="text-gray-400 font-normal">{t('step3SchemaOptional')}</span>}
            </label>
            <p className="mb-2 text-xs text-gray-400">{t('step3SchemaDesc')}</p>
            <textarea
              rows={5}
              value={typeof data.input_schema === 'object' && data.input_schema !== null ? JSON.stringify(data.input_schema, null, 2) : ''}
              onChange={e => {
                const val = e.target.value.trim()
                if (!val) { onChange('input_schema', null); return }
                try { onChange('input_schema', JSON.parse(val)) }
                catch { onChange('input_schema', val) }
              }}
              placeholder={'{\n  "type": "object",\n  "required": ["query"],\n  "properties": {\n    "query": { "type": "string" }\n  }\n}'}
              className={`w-full rounded-xl border px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-avax-100 ${
                required && !hasSchema ? 'border-amber-300 focus:border-amber-400' : 'border-gray-200 focus:border-avax-400'
              }`}
            />
            {!hasSchema && (
              <p className={`mt-1.5 text-xs ${required ? 'text-red-500' : 'text-amber-600'}`}>
                {required
                  ? t('step3SchemaRequired')
                  : t('step3SchemaWarning')}
              </p>
            )}
          </div>
        )
      })()}

      {/* WAS-202: Output Schema — opcional */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('outputSchemaLabel')}{' '}
          <span className="text-gray-400 font-normal">{t('outputSchemaOptional')}</span>
        </label>
        <p className="mb-2 text-xs text-gray-400">{t('outputSchemaDesc')}</p>
        <textarea
          rows={5}
          value={typeof data.output_schema === 'object' && data.output_schema !== null ? JSON.stringify(data.output_schema, null, 2) : ''}
          onChange={e => {
            const val = e.target.value.trim()
            if (!val) { onChange('output_schema', null); return }
            try { onChange('output_schema', JSON.parse(val)) }
            catch { onChange('output_schema', val) }
          }}
          placeholder={'{\n  "type": "object",\n  "required": ["result"],\n  "properties": {\n    "result": { "type": "string" }\n  }\n}'}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-avax-100 focus:border-avax-400"
        />
      </div>

      {/* Info box */}
      <div className="rounded-xl bg-avax-50 p-4 text-sm text-avax-700">
        <span className="inline-flex items-center gap-1"><DollarSign size={12} />{t('step3EarningsNote')}</span>
      </div>

      {/* General error */}
      {allErrors.general && (
        <p className="text-sm text-red-500">{allErrors.general}</p>
      )}
      {allErrors.input_schema && (
        <p className="text-sm text-red-500">{allErrors.input_schema}</p>
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
