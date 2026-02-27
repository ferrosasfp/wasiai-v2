'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CapabilityCard } from './CapabilityCard'
import type { Capability, CapabilityPayload } from './types'

const MAX_CAPABILITIES = 10

interface CapabilitiesEditorProps {
  value: unknown[]
  onChange: (capabilities: CapabilityPayload[]) => void
}

export interface CapabilitiesEditorRef {
  validate: () => boolean
}

// Convierte el array de DB (unknown[]) a Capability[] con UUIDs locales
function parseInitialCapabilities(value: unknown[]): Capability[] {
  if (!value || !Array.isArray(value) || value.length === 0) return []
  try {
    return value.map((item) => {
      const obj = item as Record<string, unknown>
      return {
        id: crypto.randomUUID(),
        name: (obj.name as string) ?? '',
        description: (obj.description as string) ?? '',
        input_type: (obj.input_type as string) ?? 'text',
        output_type: (obj.output_type as string) ?? 'text',
        example_input: (obj.example_input as string) ?? '',
        example_output: (obj.example_output as string) ?? '',
      }
    })
  } catch {
    return []
  }
}

// Strips el id local antes de enviar al padre
function toPayload(caps: Capability[]): CapabilityPayload[] {
  return caps.map(({ id: _id, ...rest }) => { void _id; return { ...rest } })
}

export const CapabilitiesEditor = forwardRef<
  CapabilitiesEditorRef,
  CapabilitiesEditorProps
>(function CapabilitiesEditor({ value, onChange }, ref) {
  const t = useTranslations('publish')

  const [capabilities, setCapabilities] = useState<Capability[]>(() =>
    parseInitialCapabilities(value)
  )

  // Errores por id de capability (poblados en validate())
  const [validationErrors, setValidationErrors] = useState<
    Record<string, { name?: string; description?: string }>
  >({})

  // Expone validate() al padre vía ref
  useImperativeHandle(ref, () => ({
    validate(): boolean {
      const errs: Record<string, { name?: string; description?: string }> = {}
      let valid = true
      capabilities.forEach((cap) => {
        const e: { name?: string; description?: string } = {}
        if (!cap.name.trim()) {
          e.name = t('errorRequired')
          valid = false
        }
        if (!cap.description.trim()) {
          e.description = t('errorRequired')
          valid = false
        }
        if (Object.keys(e).length > 0) {
          errs[cap.id] = e
        }
      })
      setValidationErrors(errs)
      return valid
    },
  }), [capabilities, t])

  function handleAdd() {
    if (capabilities.length >= MAX_CAPABILITIES) return
    const newCap: Capability = {
      id: crypto.randomUUID(),
      name: '',
      description: '',
      input_type: 'text',
      output_type: 'text',
      example_input: '',
      example_output: '',
    }
    const next = [...capabilities, newCap]
    setCapabilities(next)
    onChange(toPayload(next))
  }

  function handleChange(id: string, field: keyof Capability, value: string) {
    const next = capabilities.map((c) =>
      c.id === id ? { ...c, [field]: value } : c
    )
    setCapabilities(next)
    onChange(toPayload(next))
    // Limpiar error del campo editado
    if (validationErrors[id]) {
      setValidationErrors((prev) => {
        const updated = { ...prev }
        if (field === 'name' || field === 'description') {
          const cardErrs = { ...updated[id] }
          delete cardErrs[field]
          if (Object.keys(cardErrs).length === 0) {
            delete updated[id]
          } else {
            updated[id] = cardErrs
          }
        }
        return updated
      })
    }
  }

  function handleRemove(id: string) {
    const next = capabilities.filter((c) => c.id !== id)
    setCapabilities(next)
    onChange(toPayload(next))
    // Limpiar errores del card eliminado
    setValidationErrors((prev) => {
      const updated = { ...prev }
      delete updated[id]
      return updated
    })
  }

  const atLimit = capabilities.length >= MAX_CAPABILITIES

  return (
    <div className="space-y-3">
      {/* Cards */}
      {capabilities.length === 0 && (
        <p className="text-xs text-gray-400 italic">
          {t('noCapabilities')}
        </p>
      )}
      {capabilities.map((cap, i) => (
        <CapabilityCard
          key={cap.id}
          capability={cap}
          index={i}
          errors={validationErrors[cap.id] ?? {}}
          onChange={handleChange}
          onRemove={handleRemove}
        />
      ))}

      {/* Botón Add */}
      <button
        type="button"
        onClick={handleAdd}
        disabled={atLimit}
        className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:border-avax-400 hover:text-avax-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('addCapability')}
      </button>

      {/* Hint de límite */}
      {atLimit && (
        <p className="text-xs text-gray-400">{t('capabilityLimit')}</p>
      )}
    </div>
  )
})
