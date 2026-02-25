'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CreateModelDraft } from '@/lib/schemas/model.schema'

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
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})

  // Capabilities as JSON text for the textarea
  const [capabilitiesText, setCapabilitiesText] = useState<string>(() => {
    if (!data.capabilities || (data.capabilities as unknown[]).length === 0) return ''
    try { return JSON.stringify(data.capabilities, null, 2) } catch { return '' }
  })
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)

  function handleCapabilitiesBlur() {
    if (!capabilitiesText.trim()) {
      onChange('capabilities', [])
      setCapabilitiesError(null)
      return
    }
    try {
      const parsed: unknown = JSON.parse(capabilitiesText)
      if (!Array.isArray(parsed)) {
        setCapabilitiesError('Debe ser un array JSON')
        return
      }
      onChange('capabilities', parsed)
      setCapabilitiesError(null)
    } catch {
      setCapabilitiesError('JSON inválido')
    }
  }

  function handleNext() {
    const errs: Record<string, string> = {}
    if (!data.price_per_call || data.price_per_call <= 0) {
      errs.price_per_call = 'El precio debe ser mayor a 0'
    }
    if (capabilitiesText.trim() && capabilitiesError) {
      errs.capabilities = capabilitiesError
    }
    if (Object.keys(errs).length > 0) {
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
        <h2 className="text-xl font-bold text-gray-900">Producto</h2>
        <p className="mt-1 text-sm text-gray-500">Precio, modelo base y capacidades</p>
      </div>

      {/* Price per call */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Precio por llamada (USDC) <span className="text-red-400">*</span>
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
          Ganas el 90% por cada llamada · WasiAI toma el 10%
        </p>
      </div>

      {/* Base model */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Modelo base <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <input
          type="text"
          value={(data as Record<string, unknown>).base_model as string ?? ''}
          onChange={e => onChange('base_model', e.target.value)}
          placeholder="Ej: gpt-4o, llama-3, mistral-7b…"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
        />
      </div>

      {/* Capabilities JSON textarea */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Capacidades <span className="font-normal text-gray-400">(JSON array · opcional)</span>
        </label>
        <textarea
          value={capabilitiesText}
          onChange={e => setCapabilitiesText(e.target.value)}
          onBlur={handleCapabilitiesBlur}
          placeholder={'[\n  { "name": "summarize", "description": "...", "inputType": "text", "outputType": "text" }\n]'}
          rows={5}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 font-mono text-xs focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
        />
        {(capabilitiesError ?? allErrors.capabilities) && (
          <p className="mt-1 text-xs text-red-500">{capabilitiesError ?? allErrors.capabilities}</p>
        )}
      </div>

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
          {saving ? 'Guardando…' : t('cta.next')} →
        </button>
      </div>
    </div>
  )
}
