'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CreateModelDraft } from '@/lib/schemas/model.schema'
import { CapabilitiesEditor } from '@/features/publish/CapabilitiesEditor'
import type { CapabilitiesEditorRef } from '@/features/publish/CapabilitiesEditor'

interface Props {
  data: Partial<CreateModelDraft>
  onChange: (field: string, value: unknown) => void
  errors: Record<string, string>
  onNext: () => void
  onBack: () => void
  saving?: boolean
}

export function Step2Product({ data, onChange, errors, onNext, onBack, saving }: Props) {
  const t = useTranslations('publish')
  const tCommon = useTranslations('common')
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const capabilitiesEditorRef = useRef<CapabilitiesEditorRef>(null)

  function handleNext() {
    const errs: Record<string, string> = {}
    if (!data.price_per_call || data.price_per_call <= 0) {
      errs.price_per_call = t('step2.errorPriceMin')
    }
    const capsValid = capabilitiesEditorRef.current?.validate() ?? true
    if (Object.keys(errs).length > 0 || !capsValid) {
      setLocalErrors(errs)
      return
    }
    setLocalErrors({})
    onNext()
  }

  const allErrors = { ...localErrors, ...errors }

  return (
    <div className="space-y-6 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('step2.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('step2.subtitle')}</p>
      </div>

      {/* Price per call */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('pricePerCall')} <span className="text-red-400">*</span>
        </label>
        <div className="flex items-center overflow-hidden rounded-xl border border-gray-200 focus-within:border-avax-400 focus-within:ring-2 focus-within:ring-avax-100">
          <span className="border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-400">$</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={data.price_per_call ?? ''}
            onChange={e => {
              onChange('price_per_call', parseFloat(e.target.value) || 0)
              if (localErrors.price_per_call) setLocalErrors(prev => { const e = { ...prev }; delete e.price_per_call; return e })
            }}
            placeholder="0.02"
            className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
          />
          <span className="px-3 text-sm text-gray-400">USDC</span>
        </div>
        {allErrors.price_per_call && (
          <p className="mt-1 text-xs text-red-500">{allErrors.price_per_call}</p>
        )}
        <p className="mt-1 text-xs text-gray-400">
          {t('step2.revenueHint')}
        </p>
      </div>

      {/* Base model */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('step2.baseModel')} <span className="font-normal text-gray-400">{t('step2.optional')}</span>
        </label>
        <input
          type="text"
          value={(data as Record<string, unknown>).base_model as string ?? ''}
          onChange={e => onChange('base_model', e.target.value)}
          placeholder="Ej: gpt-4o, llama-3, mistral-7b…"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
        />
      </div>

      {/* Capabilities — editor visual */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('step2.capabilitiesLabel')}{' '}
          <span className="font-normal text-gray-400">{t('step2.optional')}</span>
        </label>
        <CapabilitiesEditor
          ref={capabilitiesEditorRef}
          value={(data.capabilities as unknown[]) ?? []}
          onChange={(caps) => onChange('capabilities', caps)}
        />
      </div>

      {/* HU-8.4: Rate limits */}
      <details className="group rounded-xl border border-gray-100 bg-gray-50">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900">
          ⚙️ {t('step2.rateLimits.title')} <span className="font-normal text-gray-400">({t('step2.optional')})</span>
        </summary>
        <div className="space-y-4 px-4 pb-4 pt-2">
          <p className="text-xs text-gray-400">{t('step2.rateLimits.hint')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('step2.rateLimits.rpm')}
              </label>
              <input
                type="number"
                min={1}
                max={600}
                value={data.max_rpm ?? 60}
                onChange={e => onChange('max_rpm', parseInt(e.target.value) || 60)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
              />
              <p className="mt-0.5 text-xs text-gray-400">{t('step2.rateLimits.rpmHint')}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('step2.rateLimits.rpd')}
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                value={data.max_rpd ?? 1000}
                onChange={e => onChange('max_rpd', parseInt(e.target.value) || 1000)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
              />
              <p className="mt-0.5 text-xs text-gray-400">{t('step2.rateLimits.rpdHint')}</p>
            </div>
          </div>
        </div>
      </details>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          ← {t('cta.back')}
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={saving ?? false}
          className="rounded-xl bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50"
        >
          {saving ? tCommon('saving') : t('cta.next')} →
        </button>
      </div>
    </div>
  )
}
