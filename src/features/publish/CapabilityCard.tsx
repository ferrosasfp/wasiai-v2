'use client'

import { useTranslations } from 'next-intl'
import type { Capability } from './types'
import { INPUT_TYPES, OUTPUT_TYPES } from './types'

interface CapabilityCardProps {
  capability: Capability
  index: number
  errors: { name?: string; description?: string }
  onChange: (id: string, field: keyof Capability, value: string) => void
  onRemove: (id: string) => void
}

export function CapabilityCard({
  capability,
  index,
  errors,
  onChange,
  onRemove,
}: CapabilityCardProps) {
  const t = useTranslations('publish')

  const inputBase =
    'w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2'
  const inputNormal =
    `${inputBase} border-gray-200 focus:border-avax-400 focus:ring-avax-100`
  const inputError =
    `${inputBase} border-red-400 focus:border-red-400 focus:ring-red-100`

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          {t('capabilityNumber', { n: index + 1 })}
        </span>
        <button
          type="button"
          onClick={() => onRemove(capability.id)}
          aria-label={t('removeCapability')}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition"
        >
          {/* Trash icon inline SVG — sin dependencias nuevas */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {t('capabilityName')} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={capability.name}
          onChange={(e) => onChange(capability.id, 'name', e.target.value)}
          placeholder="text-summarizer"
          className={errors.name ? inputError : inputNormal}
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-500">{errors.name}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {t('capabilityDesc')} <span className="text-red-400">*</span>
        </label>
        <textarea
          value={capability.description}
          onChange={(e) => onChange(capability.id, 'description', e.target.value)}
          placeholder="Summarizes any text to N sentences"
          rows={2}
          className={errors.description ? inputError : inputNormal}
        />
        {errors.description && (
          <p className="mt-1 text-xs text-red-500">{errors.description}</p>
        )}
      </div>

      {/* Input Type + Output Type */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {t('inputType')}
          </label>
          <select
            value={capability.input_type}
            onChange={(e) => onChange(capability.id, 'input_type', e.target.value)}
            className={inputNormal}
          >
            {INPUT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {t('outputType')}
          </label>
          <select
            value={capability.output_type}
            onChange={(e) => onChange(capability.id, 'output_type', e.target.value)}
            className={inputNormal}
          >
            {OUTPUT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Example Input */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {t('capabilityExampleInput')}{' '}
          <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <textarea
          value={capability.example_input}
          onChange={(e) => onChange(capability.id, 'example_input', e.target.value)}
          placeholder="Summarize this: ..."
          rows={2}
          className={inputNormal}
        />
      </div>

      {/* Example Output */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {t('capabilityExampleOutput')}{' '}
          <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <textarea
          value={capability.example_output}
          onChange={(e) => onChange(capability.id, 'example_output', e.target.value)}
          placeholder="Here is a 3-sentence summary: ..."
          rows={2}
          className={inputNormal}
        />
      </div>
    </div>
  )
}
