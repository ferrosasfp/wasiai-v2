# Story UX-09 — Editor Visual de Capabilities

**Tipo:** User Story  
**Epic:** UX — Experiencia del Creator  
**Sprint:** 5  
**Prioridad:** P1  
**Estimado:** 2–3 días  
**Estado:** READY_FOR_DEV  
**Fecha:** 2026-02-26  
**Autor:** SM Agent (BMAD v6)

---

## Historia de Usuario

Como creator publicando mi agente en WasiAI,  
quiero poder definir las capabilities de mi agente usando un formulario visual con campos Name, Description, InputType, OutputType, Example Input y Example Output,  
para no tener que escribir JSON crudo que no entiendo.

---

## Criterios de Aceptación

### AC1 — Reemplazar textarea JSON por formulario visual
- [ ] El textarea de JSON de capabilities desaparece del formulario `/publish` Step2
- [ ] En su lugar: lista de capability cards, cada una expandible
- [ ] Cada capability card tiene exactamente estos campos:
  - `Name` (text, obligatorio, placeholder: "text-summarizer")
  - `Description` (textarea, obligatorio, placeholder: "Summarizes any text to N sentences")
  - `Input Type` (select: `text | json | url | image | audio | any`)
  - `Output Type` (select: `text | json | markdown | code | any`)
  - `Example Input` (textarea opcional, placeholder: "Summarize this: ...")
  - `Example Output` (textarea opcional, placeholder: "Here is a 3-sentence summary: ...")

### AC2 — Agregar y eliminar capabilities
- [ ] Botón "+ Agregar Capacidad" debajo de la lista → agrega un nuevo card vacío
- [ ] Botón "Eliminar" (ícono trash) en cada card → elimina esa capability
- [ ] Mínimo 0 capabilities (el campo es opcional)
- [ ] Máximo 10 capabilities — botón Add se deshabilita al llegar al límite
- [ ] Mensaje de límite aparece cuando hay exactamente 10 capabilities

### AC3 — Conversión automática a JSON
- [ ] El formulario convierte automáticamente el estado de los cards al JSON que la API espera
- [ ] Estructura JSON resultante: `[{ "name": "...", "description": "...", "input_type": "...", "output_type": "...", "example_input": "...", "example_output": "..." }]`
- [ ] El campo `id` interno (UUID de React) nunca aparece en el payload enviado a la API
- [ ] El JSON se envía al servidor exactamente igual que antes (sin cambios en la API)

### AC4 — Carga de capabilities existentes (modo edición)
- [ ] Si el agente ya tiene capabilities en DB, los cards se pre-populan correctamente
- [ ] Si `capabilities` en DB es JSON válido → parsear y renderizar cards
- [ ] Si `capabilities` es null, undefined o inválido → formulario vacío sin crash ni error visible

### AC5 — Validación
- [ ] Si `name` está vacío en una capability → error inline al hacer submit
- [ ] Si `description` está vacío en una capability → error inline al hacer submit
- [ ] Cards con errores muestran borde rojo + mensaje debajo del campo
- [ ] `example_input` y `example_output` son opcionales y nunca bloquean el submit
- [ ] Los errores se limpian al corregir el campo y volver a intentar submit

> **AC5 (toggle JSON avanzado):** OMITIDO por decisión en SDD — esfuerzo desproporcionado vs. valor.

---

## Archivos del Entregable

### Archivos nuevos (crear)
```
src/features/publish/types.ts
src/features/publish/CapabilityCard.tsx
src/features/publish/CapabilitiesEditor.tsx
```

### Archivos modificados
```
src/components/publish/Step2Product.tsx
messages/es.json
messages/en.json
```

---

## Código Completo

### `src/features/publish/types.ts`

```typescript
// Tipo interno del editor (incluye id para React keys — nunca enviado a la API)
export type Capability = {
  id: string             // crypto.randomUUID() — solo frontend
  name: string           // obligatorio
  description: string    // obligatorio
  input_type: string     // select controlado
  output_type: string    // select controlado
  example_input: string  // opcional
  example_output: string // opcional
}

// Tipo que la API espera (sin id)
export type CapabilityPayload = Omit<Capability, 'id'>

// Opciones de los selects
export const INPUT_TYPES = ['text', 'json', 'url', 'image', 'audio', 'any'] as const
export const OUTPUT_TYPES = ['text', 'json', 'markdown', 'code', 'any'] as const
```

---

### `src/features/publish/CapabilityCard.tsx`

```typescript
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
```

---

### `src/features/publish/CapabilitiesEditor.tsx`

```typescript
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
  return caps.map(({ id: _id, ...rest }) => rest)
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
```

---

### `src/components/publish/Step2Product.tsx` — versión final

> **Qué se elimina:**
> - Estado `capabilitiesText` + `setCapabilitiesText`
> - Estado `capabilitiesError` + `setCapabilitiesError`
> - Función `handleCapabilitiesBlur()`
> - Validación `capabilitiesText.trim() && capabilitiesError` en `handleNext()`
> - Bloque JSX `<div>` con label "Capacidades (JSON array · opcional)" + textarea + error
>
> **Qué se agrega:**
> - Import `useRef`
> - Import `CapabilitiesEditor` + `CapabilitiesEditorRef`
> - `ref` `capabilitiesEditorRef`
> - Llamada a `capabilitiesEditorRef.current?.validate()` en `handleNext()`
> - Bloque JSX `<CapabilitiesEditor>`

```typescript
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
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const capabilitiesEditorRef = useRef<CapabilitiesEditorRef>(null)

  function handleNext() {
    const errs: Record<string, string> = {}
    if (!data.price_per_call || data.price_per_call <= 0) {
      errs.price_per_call = 'El precio debe ser mayor a 0'
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

      {/* Capabilities — editor visual */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('capabilities')}{' '}
          <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <CapabilitiesEditor
          ref={capabilitiesEditorRef}
          value={(data.capabilities as unknown[]) ?? []}
          onChange={(caps) => onChange('capabilities', caps)}
        />
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
```

---

## Keys i18n

### `messages/es.json` — agregar bajo el objeto `publish`

```json
"capabilityExampleInput": "Ejemplo de Entrada",
"capabilityExampleOutput": "Ejemplo de Salida",
"removeCapability": "Eliminar capability",
"capabilityNumber": "Capability {n}",
"capabilityLimit": "Máximo 10 capabilities",
"noCapabilities": "Sin capabilities definidas. Agrega al menos una para mejor descubrimiento.",
"errorRequired": "Campo obligatorio"
```

### `messages/en.json` — agregar bajo el objeto `publish`

```json
"capabilityExampleInput": "Example Input",
"capabilityExampleOutput": "Example Output",
"removeCapability": "Remove capability",
"capabilityNumber": "Capability {n}",
"capabilityLimit": "Maximum 10 capabilities",
"noCapabilities": "No capabilities defined. Add at least one for better discovery.",
"errorRequired": "Required field"
```

### Claves existentes que se reutilizan (sin cambios)

| Key | Valor es | Valor en |
|-----|----------|----------|
| `publish.capabilities` | "Capacidades" | "Capabilities" |
| `publish.capabilityName` | "Nombre" | "Name" |
| `publish.capabilityDesc` | "Descripción" | "Description" |
| `publish.inputType` | "Entrada" | "Input Type" |
| `publish.outputType` | "Salida" | "Output Type" |
| `publish.addCapability` | "+ Agregar Capacidad" | "+ Add Capability" |
| `publish.cta.back` | sin cambio | sin cambio |
| `publish.cta.next` | sin cambio | sin cambio |

> **Nota:** `capabilityNumber` usa interpolación next-intl estándar `{n}` (sin `#`). Llamar como `t('capabilityNumber', { n: index + 1 })`.

---

## Flujo de Datos

```
Usuario edita un campo en CapabilityCard
        ↓
CapabilityCard.onChange(id, field, value)   ← props controladas
        ↓
CapabilitiesEditor.handleChange(id, field, value)
  → setCapabilities(next)                   ← actualiza estado interno
  → onChange(toPayload(next))               ← CapabilityPayload[] sin ids
        ↓
Step2Product recibe onChange('capabilities', CapabilityPayload[])
  → actualiza data.capabilities en estado del formulario padre
        ↓
Usuario hace click en "Siguiente"
        ↓
Step2Product.handleNext()
  → capabilitiesEditorRef.current.validate()
      → Si válido: onNext() → API recibe capabilities como JSON array ✓
      → Si inválido: CapabilitiesEditor muestra errores inline por card
        (Step2Product no necesita saber cuáles son, solo si es válido)
```

---

## Notas de Implementación Críticas

### 1. `forwardRef` + `useImperativeHandle`
`CapabilitiesEditor` usa `forwardRef` y expone solo `{ validate: () => boolean }`. El padre (`Step2Product`) guarda el ref con `useRef<CapabilitiesEditorRef>(null)`. Verificar que TypeScript infiere correctamente el tipo del ref.

### 2. `crypto.randomUUID()`
Disponible nativamente en Next.js 14 (Node 18+). No instalar paquete `uuid`.

### 3. Errores de validación — responsabilidad del editor
Los errores de capabilities viven en `CapabilitiesEditor` (estado `validationErrors`). `Step2Product` solo llama `validate()` y recibe `boolean`. Nunca necesita conocer qué campos fallaron.

### 4. Limpieza de errores
Al editar un campo que tenía error, el error de ese campo específico se limpia inmediatamente en `handleChange`. El usuario no necesita hacer submit de nuevo para ver que el error desapareció.

### 5. Modo edición (agente existente)
`parseInitialCapabilities` asigna UUID fresco a cada capability cargada de DB. Los UUIDs de DB (si existen) se descartan — el editor solo necesita IDs de React para keys y manejo de errores.

### 6. Manejo de edge cases en `parseInitialCapabilities`
- `null` / `undefined` → `[]`
- Array vacío → `[]`
- String JSON en lugar de array (datos legacy) → el try/catch retorna `[]`
- Objetos parciales (faltan campos) → defaults seguros

### 7. Sin dependencias nuevas
No instalar `react-beautiful-dnd`, `dnd-kit`, `uuid`, ni ningún otro paquete. Drag & drop es Sprint 6.

---

## Definition of Done (DoD)

| # | Criterio | Cómo verificar |
|---|----------|----------------|
| 1 | Textarea JSON de capabilities no existe en `/publish` Step2 | Inspección visual + `grep -n "capabilitiesText\|textarea.*capabilit" Step2Product.tsx` → 0 resultados |
| 2 | Archivos `types.ts`, `CapabilityCard.tsx`, `CapabilitiesEditor.tsx` creados en `src/features/publish/` | `ls src/features/publish/` |
| 3 | Agregar hasta 10 capabilities funciona; botón Add se deshabilita al llegar a 10 | Test manual en `/publish` |
| 4 | Eliminar cualquier card de la lista funciona | Test manual |
| 5 | Submit con `name` vacío → borde rojo + mensaje en ese card | Test manual |
| 6 | Submit con `description` vacía → borde rojo + mensaje en ese card | Test manual |
| 7 | `example_input` y `example_output` vacíos → submit pasa sin error | Test manual |
| 8 | Editar agente existente con capabilities → cards pre-populados | Test con agente en DB que tiene capabilities |
| 9 | Agente sin capabilities en DB → 0 cards, sin crash | Test con agente cuyo campo capabilities es null |
| 10 | JSON enviado a API: `[{name, description, input_type, output_type, example_input, example_output}]` | Network tab → inspeccionar request body |
| 11 | El campo `id` (UUID interno) no aparece en el payload de la API | Network tab → body no contiene `"id":` |
| 12 | Keys i18n nuevas presentes en `es.json` y `en.json` | `grep capabilityExampleInput messages/es.json messages/en.json` |
| 13 | Interfaz visible en ambos locales (`/es/publish` y `/en/publish`) | Test manual |
| 14 | `tsc --noEmit` sin errores | `npm run build` pasa sin errores de tipo |
| 15 | `git diff package.json` → sin cambios | `git diff package.json` |

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| `data.capabilities` llega como string JSON en lugar de array | Media | Medio | `parseInitialCapabilities` con try/catch, fallback `[]` |
| TypeScript verbose con `forwardRef` genérico | Baja | Bajo | Tipado explícito `forwardRef<CapabilitiesEditorRef, CapabilitiesEditorProps>` |
| `capabilityNumber` con interpolación incorrecta | Media | Bajo | Usar `{n}` (sin `#`) en el JSON i18n; llamar `t('capabilityNumber', { n: index + 1 })` |

---

## Dependencias

- Formulario `/publish/page.tsx` y su estado actual — **sin cambios requeridos**
- `src/components/publish/Step2Product.tsx` — modificar según sección anterior
- `messages/es.json` y `messages/en.json` — agregar claves nuevas
- Tailwind CSS — ya instalado, usar clases existentes
- next-intl — ya instalado, usar `useTranslations` con namespace `'publish'`

---

**Story creada por:** SM Agent (BMAD v6)  
**Fecha:** 2026-02-26  
**Estado:** READY_FOR_DEV ✅
