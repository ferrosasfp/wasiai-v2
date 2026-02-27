# S1 — SDD-UX-09: Editor Visual de Capabilities

**HU origen:** UX-09  
**Sprint:** 5  
**Estado:** PENDING_SPEC_APPROVED  
**Autor:** PM Agent (BMAD v6)  
**Fecha:** 2026-02-26

---

## 1. Alcance técnico

Reemplazar el textarea JSON de capabilities en `Step2Product.tsx` por un editor visual basado en cards. Sin tocar la API `/api/models`. Sin migración de DB. Cambio 100% en capa de presentación.

**Archivos nuevos:**
- `src/features/publish/CapabilitiesEditor.tsx`
- `src/features/publish/CapabilityCard.tsx`

**Archivos modificados:**
- `src/components/publish/Step2Product.tsx` (reemplazar bloque capabilities)

**AC5 (toggle JSON):** OMITIDO — esfuerzo desproporcionado vs. valor.

---

## 2. Tipos compartidos

Definir en `src/features/publish/types.ts` (crear si no existe):

```typescript
// Tipo interno del editor (con id para React keys)
export type Capability = {
  id: string            // uuid generado localmente, nunca enviado a la API
  name: string          // obligatorio
  description: string   // obligatorio
  input_type: string    // select controlado
  output_type: string   // select controlado
  example_input: string // opcional
  example_output: string // opcional
}

// Tipo que la API espera (sin id)
export type CapabilityPayload = Omit<Capability, 'id'>

// Opciones de los selects
export const INPUT_TYPES = ['text', 'json', 'url', 'image', 'audio', 'any'] as const
export const OUTPUT_TYPES = ['text', 'json', 'markdown', 'code', 'any'] as const
```

---

## 3. `CapabilityCard.tsx`

**Ubicación:** `src/features/publish/CapabilityCard.tsx`  
**Directiva:** `'use client'`

### 3.1 Props

```typescript
interface CapabilityCardProps {
  capability: Capability
  index: number                             // para labels accesibles
  errors: { name?: string; description?: string } // errores de validación de este card
  onChange: (id: string, field: keyof Capability, value: string) => void
  onRemove: (id: string) => void
}
```

### 3.2 Estado interno

Ninguno. El card es controlado 100% por el padre.

### 3.3 Estructura JSX

```
<div className="rounded-xl border border-gray-200 p-4 space-y-3">
  <header>  ← "Capability #{index+1}" + botón Remove (ícono Trash, aria-label)
  <input name />          ← con error inline si errors.name
  <textarea description /> ← con error inline si errors.description
  <div className="grid grid-cols-2 gap-3">
    <select input_type />
    <select output_type />
  </div>
  <textarea example_input />   ← opcional, sin error
  <textarea example_output />  ← opcional, sin error
</div>
```

### 3.4 Comportamiento de errores

- Campo con error: clase `border-red-400 focus:border-red-400 focus:ring-red-100`
- Mensaje de error: `<p className="mt-1 text-xs text-red-500">`
- Errores se muestran solo después del intento de submit (controlado por padre vía prop `errors`)

### 3.5 Keys i18n usadas en este componente

```
publish.capabilities            → "Capacidades"
publish.capabilityName          → "Nombre"
publish.capabilityDesc          → "Descripción"
publish.inputType               → "Tipo de Entrada"
publish.outputType              → "Tipo de Salida"
publish.capabilityExampleInput  → "Ejemplo de Entrada" (NUEVA)
publish.capabilityExampleOutput → "Ejemplo de Salida"  (NUEVA)
publish.removeCapability        → "Eliminar capability" (NUEVA — aria-label)
publish.capabilityNumber        → "Capability #{n}"    (NUEVA)
```

---

## 4. `CapabilitiesEditor.tsx`

**Ubicación:** `src/features/publish/CapabilitiesEditor.tsx`  
**Directiva:** `'use client'`

### 4.1 Props

```typescript
interface CapabilitiesEditorProps {
  // Valor actual (array JSON tal como viene de DB o del estado del formulario)
  value: unknown[]
  // Callback: notifica al padre con el array listo para la API (sin ids internos)
  onChange: (capabilities: CapabilityPayload[]) => void
  // Errores de validación, indexados por id de capability
  // El padre los inyecta después de intentar submit
  fieldErrors?: Record<string, { name?: string; description?: string }>
}
```

### 4.2 Estado interno

```typescript
const [capabilities, setCapabilities] = useState<Capability[]>(() =>
  parseInitialCapabilities(value)
)
```

El estado vive en este componente. Cada mutación llama `onChange(toPayload(capabilities))`.

### 4.3 Función `parseInitialCapabilities(value: unknown[]): Capability[]`

```
- Si value es null / undefined / array vacío → retorna []
- Por cada elemento del array:
  - Extraer name, description, input_type, output_type, example_input, example_output
  - Usar valores por defecto: input_type='text', output_type='text', strings vacíos
  - Asignar id = crypto.randomUUID()
- Wrap entero en try/catch → si falla retorna []
```

Esta función garantiza el AC4 (carga de capabilities existentes sin crashear).

### 4.4 Función `toPayload(capabilities: Capability[]): CapabilityPayload[]`

```typescript
function toPayload(caps: Capability[]): CapabilityPayload[] {
  return caps.map(({ id: _id, ...rest }) => rest)
}
```

Strips el `id` local antes de enviar al padre. La API recibe el JSON limpio.

### 4.5 Handlers

```typescript
function handleAdd() {
  if (capabilities.length >= 10) return  // AC2: máximo 10
  const newCap: Capability = {
    id: crypto.randomUUID(),
    name: '', description: '',
    input_type: 'text', output_type: 'text',
    example_input: '', example_output: ''
  }
  const next = [...capabilities, newCap]
  setCapabilities(next)
  onChange(toPayload(next))
}

function handleChange(id: string, field: keyof Capability, value: string) {
  const next = capabilities.map(c => c.id === id ? { ...c, [field]: value } : c)
  setCapabilities(next)
  onChange(toPayload(next))
}

function handleRemove(id: string) {
  const next = capabilities.filter(c => c.id !== id)
  setCapabilities(next)
  onChange(toPayload(next))
}
```

### 4.6 Estructura JSX

```
<div className="space-y-3">
  {capabilities.map((cap, i) => (
    <CapabilityCard
      key={cap.id}
      capability={cap}
      index={i}
      errors={fieldErrors?.[cap.id] ?? {}}
      onChange={handleChange}
      onRemove={handleRemove}
    />
  ))}

  {/* Botón Add — deshabilitado si capabilities.length >= 10 */}
  <button
    type="button"
    onClick={handleAdd}
    disabled={capabilities.length >= 10}
    className="..."
  >
    {t('publish.addCapability')}   {/* "+ Agregar Capacidad" */}
  </button>

  {/* Hint de límite */}
  {capabilities.length >= 10 && (
    <p className="text-xs text-gray-400">{t('publish.capabilityLimit')}</p>
  )}
</div>
```

### 4.7 Keys i18n adicionales en este componente

```
publish.addCapability    → "+ Agregar Capacidad"  (YA EXISTE en es.json)
publish.capabilityLimit  → "Máximo 10 capabilities" (NUEVA)
publish.noCapabilities   → "Sin capabilities definidas" (NUEVA — estado vacío)
```

---

## 5. Integración en `Step2Product.tsx`

### 5.1 Qué se elimina

```typescript
// ELIMINAR — estado local del textarea:
const [capabilitiesText, setCapabilitiesText] = useState<string>(...)
const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)

// ELIMINAR — función handleCapabilitiesBlur()

// ELIMINAR — bloque JSX del textarea con label "Capacidades (JSON array · opcional)"
```

### 5.2 Qué se agrega

```typescript
// AGREGAR — estado de errores por card (poblado en handleNext)
const [capabilityErrors, setCapabilityErrors] = useState<
  Record<string, { name?: string; description?: string }>
>({})

// AGREGAR — en handleNext, validar antes de llamar onNext():
function validateCapabilities(): boolean {
  const caps = (data.capabilities ?? []) as CapabilityPayload[]
  const errs: Record<string, { name?: string; description?: string }> = {}
  // PROBLEMA: a este punto ya tenemos CapabilityPayload[] sin ids.
  // Solución: guardar los ids en un ref o usar índice como key de error.
  // VER NOTA en sección 5.3
  let valid = true
  caps.forEach((cap, i) => {
    const cardErrors: { name?: string; description?: string } = {}
    if (!cap.name.trim()) { cardErrors.name = t('publish.errorRequired'); valid = false }
    if (!cap.description.trim()) { cardErrors.description = t('publish.errorRequired'); valid = false }
    if (Object.keys(cardErrors).length) errs[String(i)] = cardErrors
  })
  setCapabilityErrors(errs)
  return valid
}
```

### 5.3 Nota sobre IDs de error

`Step2Product` trabaja con `CapabilityPayload[]` (sin ids). Para pasar errores al `CapabilitiesEditor`, usar **índice numérico como string** como key (`"0"`, `"1"`, etc.).

`CapabilitiesEditor` debe aceptar `fieldErrors` tanto por `id` (UUID) como por `índice`. La solución más simple: en `CapabilitiesEditor`, además del map por `cap.id`, aceptar un prop alternativo `indexErrors?: Record<number, {...}>`. **Decisión de implementación:** el Dev puede elegir el mecanismo más limpio, pero debe quedar documentado.

**Alternativa recomendada (más limpia):** `Step2Product` no valida capabilities directamente. El `CapabilitiesEditor` expone un método `validate(): boolean` via `useImperativeHandle` (ref), y `Step2Product` lo llama en `handleNext`. El editor muestra sus propios errores internamente. Esta separación es mejor.

```typescript
// En Step2Product:
const capabilitiesEditorRef = useRef<{ validate: () => boolean }>(null)

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

// En JSX de Step2Product:
<CapabilitiesEditor
  ref={capabilitiesEditorRef}
  value={(data.capabilities as unknown[]) ?? []}
  onChange={(caps) => onChange('capabilities', caps)}
/>
```

Con esta estrategia, `CapabilitiesEditor` tiene su propio estado de errores y `Step2Product` solo pregunta "¿eres válido?".

### 5.4 Import

```typescript
import { CapabilitiesEditor } from '@/features/publish/CapabilitiesEditor'
```

---

## 6. Keys i18n — Lista completa de cambios

### `messages/es.json` — claves a agregar bajo `publish`

```json
{
  "publish": {
    "capabilityExampleInput": "Ejemplo de Entrada",
    "capabilityExampleOutput": "Ejemplo de Salida",
    "removeCapability": "Eliminar capability",
    "capabilityNumber": "Capability #{n}",
    "capabilityLimit": "Máximo 10 capabilities",
    "noCapabilities": "Sin capabilities definidas. Agrega al menos una para mejor descubrimiento.",
    "errorRequired": "Campo obligatorio"
  }
}
```

### `messages/en.json` — equivalentes

```json
{
  "publish": {
    "capabilityExampleInput": "Example Input",
    "capabilityExampleOutput": "Example Output",
    "removeCapability": "Remove capability",
    "capabilityNumber": "Capability #{n}",
    "capabilityLimit": "Maximum 10 capabilities",
    "noCapabilities": "No capabilities defined. Add at least one for better discovery.",
    "errorRequired": "Required field"
  }
}
```

### Claves existentes que se reutilizan (no cambiar)

- `publish.capabilities` → label de la sección
- `publish.capabilityName` → label campo Name
- `publish.capabilityDesc` → label campo Description
- `publish.inputType` → label select Input Type
- `publish.outputType` → label select Output Type
- `publish.addCapability` → botón Add
- `publish.cta.back` / `publish.cta.next` → sin cambios

---

## 7. Flujo de datos completo

```
User interactúa con CapabilityCard
        ↓
CapabilityCard.onChange(id, field, value)
        ↓
CapabilitiesEditor.handleChange(id, field, value)
  → setCapabilities(next)
  → onChange(toPayload(next))   ← CapabilityPayload[] sin ids
        ↓
Step2Product recibe onChange('capabilities', CapabilityPayload[])
  → actualiza data.capabilities en el estado del formulario padre
        ↓
handleNext() → capabilitiesEditorRef.current.validate()
  → Si ok: onNext() → API recibe capabilities como JSON array ✓
  → Si error: CapabilitiesEditor muestra errores inline por card
```

---

## 8. Manejo de capabilities existentes (modo edición)

**Flujo:**
1. Formulario padre pasa `data.capabilities` (viene de DB como `unknown[]`)
2. `CapabilitiesEditor` recibe `value={data.capabilities ?? []}`
3. `parseInitialCapabilities(value)` mapea cada objeto a `Capability` con UUID fresco
4. Los cards se pre-populan con los valores de DB

**Casos edge:**
- `null` o `undefined` → array vacío (0 cards)
- JSON malformado (llega como string en lugar de array) → try/catch → array vacío
- Array con objetos parciales (faltan campos) → defaults: `input_type='text'`, `output_type='text'`, strings vacíos

---

## 9. Consideraciones de implementación

### 9.1 `crypto.randomUUID()`
Disponible en Next.js 14 (Node 18+). No importar uuid externo.

### 9.2 `useImperativeHandle`
`CapabilitiesEditor` debe ser `forwardRef`. Expone solo `{ validate: () => boolean }`.

```typescript
export const CapabilitiesEditor = forwardRef<
  { validate: () => boolean },
  CapabilitiesEditorProps
>(function CapabilitiesEditor({ value, onChange, ... }, ref) {
  const [validationErrors, setValidationErrors] = useState<Record<string, {...}>>({})

  useImperativeHandle(ref, () => ({
    validate() {
      const errs: Record<string, { name?: string; description?: string }> = {}
      let valid = true
      capabilities.forEach(cap => {
        const e: { name?: string; description?: string } = {}
        if (!cap.name.trim()) { e.name = 'Campo obligatorio'; valid = false }
        if (!cap.description.trim()) { e.description = 'Campo obligatorio'; valid = false }
        if (Object.keys(e).length) errs[cap.id] = e
      })
      setValidationErrors(errs)
      return valid
    }
  }), [capabilities])

  // ... render con fieldErrors={validationErrors}
})
```

### 9.3 Sin dependencias nuevas
No instalar react-beautiful-dnd ni dnd-kit. Drag & drop es Sprint 6.

### 9.4 Tailwind classes para cards
Consistencia con el resto de `Step2Product.tsx`:
- Bordes: `border-gray-200`, error: `border-red-400`
- Focus: `focus:border-avax-400 focus:ring-2 focus:ring-avax-100`
- Inputs: `rounded-xl px-4 py-2.5 text-sm`

---

## 10. Definition of Done (DoD verificable)

| # | Criterio | Verificación |
|---|----------|-------------|
| 1 | Textarea JSON desaparece de `/publish` Step2 | Visual + grep del JSX |
| 2 | CapabilitiesEditor y CapabilityCard creados en `src/features/publish/` | `ls src/features/publish/` |
| 3 | Agregar hasta 10 capabilities; botón Add se deshabilita en el límite | Test manual |
| 4 | Eliminar cualquier card de la lista | Test manual |
| 5 | Campos `name` y `description` muestran error rojo al hacer submit vacíos | Test manual en submit |
| 6 | `example_input` y `example_output` son opcionales (no bloquean submit) | Test manual |
| 7 | En modo edición, cards pre-populados con datos existentes | Test con agente en DB con capabilities |
| 8 | Si capabilities en DB es null → 0 cards, sin crash | Test con agente sin capabilities |
| 9 | JSON enviado a API mantiene estructura exacta: `[{name,description,input_type,output_type,example_input,example_output}]` | Console.log en API route o Network tab |
| 10 | Sin `id` interno en el payload enviado a la API | Inspección del body del request |
| 11 | Claves i18n nuevas presentes en `es.json` y `en.json` | Grep + test en ambos locales |
| 12 | TypeScript strict: sin errores en `tsc --noEmit` | `npm run build` pasa |
| 13 | Sin dependencias nuevas en `package.json` | `git diff package.json` |

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| `data.capabilities` llega como string JSON en lugar de array (legacy) | `parseInitialCapabilities` hace `JSON.parse` si recibe string, con fallback a `[]` |
| `forwardRef` + TypeScript genérico verbose | Tipado explícito en el forwardRef call; Dev puede simplificar con `useRef<{validate:()=>boolean}>` en el padre si el genérico molesta |
| `capabilityNumber` con interpolación `#{n}` — next-intl usa `{n}` | Usar `t('publish.capabilityNumber', { n: index + 1 })` y en el JSON `"Capability {n}"` (sin #) |

---

**Estado:** PENDING_SPEC_APPROVED  
**Requiere aprobación explícita de Fer antes de pasar a SM → Create Story.**
