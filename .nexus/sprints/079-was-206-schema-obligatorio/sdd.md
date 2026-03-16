# SDD — WAS-206: buildExampleFromSchema inteligente + preview en formulario

**Issue:** WAS-206 | **Clasificación:** HU-MAJOR | **Fecha:** 2026-03-15

---

## Context

Crear `buildExampleFromSchema` centralizado con heurísticas inteligentes, agregar preview editable en el formulario de publicación, guardar el ejemplo como `metadata.input_example`, y migrar usos duplicados del util existente.

**Archivos a crear:**
- `src/features/agents/utils/buildExampleFromSchema.ts` (nuevo)

**Archivos a modificar:**
- `src/components/publish/Step3Technical.tsx`
- `src/features/agents/components/AgentTrialPlayground.tsx` (migrar import)
- `src/app/[locale]/sandbox/SandboxClient.tsx` (migrar import)
- `src/app/[locale]/publish/PublishForm.tsx` (pasar metadata.input_example al submit)

**Exemplar:** `src/features/agents/components/AgentTrialPlayground.tsx` (patrón de uso actual)

---

## Wave 0 — Pre-flight

```bash
# Verificar que la función no existe ya como util
ls src/features/agents/utils/ 2>/dev/null

# Verificar usos actuales duplicados
grep -rn "buildExampleFromSchema" src/ --include="*.ts" --include="*.tsx"

# Verificar PublishForm para entender cómo se construye el payload de submit
grep -n "metadata\|input_example\|onPublish\|draft" src/app/\[locale\]/publish/PublishForm.tsx | head -20
```

---

## Wave 1 — Crear util centralizado

**Archivo:** `src/features/agents/utils/buildExampleFromSchema.ts`

```typescript
/**
 * buildExampleFromSchema — Genera un ejemplo de input ejecutable desde un JSON Schema.
 * 
 * Reglas:
 * - Nunca devuelve strings con < o >
 * - El output es siempre JSON.parse()-able
 * - Función pura sin side effects
 * - Solo incluye campos en required[] (o todos si required está ausente)
 */

type SchemaProperty = {
  type?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  properties?: Record<string, SchemaProperty>
  required?: string[]
  items?: SchemaProperty
}

type JsonSchema = {
  type?: string
  properties?: Record<string, SchemaProperty>
  required?: string[]
  description?: string
}

/** Heurísticas de inferencia de valor por key/description (case-insensitive) */
function inferStringValue(key: string, description?: string): string {
  const haystack = `${key} ${description ?? ''}`.toLowerCase()
  
  // Omitir campos opcionales explícitos
  if (haystack.includes('optional') || description?.toLowerCase().startsWith('optional')) {
    return '__OMIT__'
  }
  
  if (haystack.match(/address|wallet|0x/)) return '0xAbCd1234567890AbCd1234567890AbCd12345678'
  if (haystack.match(/token|symbol/))      return 'AVAX'
  if (haystack.match(/email/))             return 'user@example.com'
  if (haystack.match(/url|endpoint/))      return 'https://example.com'
  if (haystack.match(/uuid|id\b/))         return 'abc-123'
  if (haystack.match(/name/))              return 'My Agent'
  if (haystack.match(/text|content|message|query|prompt/)) return 'Hello world'
  
  return '' // fallback: string vacío
}

function buildValueFromProperty(key: string, prop: SchemaProperty): unknown {
  const type = prop.type ?? 'string'
  
  if (type === 'string') {
    if (prop.enum && prop.enum.length > 0) return prop.enum[0]
    return inferStringValue(key, prop.description)
  }
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return true
  if (type === 'array') return []
  if (type === 'object' && prop.properties) {
    return buildObjectFromSchema(prop)
  }
  return {}
}

function buildObjectFromSchema(schema: JsonSchema): Record<string, unknown> {
  const props = schema.properties
  if (!props) return {}
  
  const required = schema.required // undefined = incluir todos
  const example: Record<string, unknown> = {}
  
  for (const [key, def] of Object.entries(props)) {
    // Si required está definido, solo incluir campos requeridos
    if (required && !required.includes(key)) continue
    
    const value = buildValueFromProperty(key, def)
    if (value === '__OMIT__') continue
    example[key] = value
  }
  
  return example
}

/**
 * Genera un ejemplo de input ejecutable desde un JSON Schema.
 * @returns string JSON válido, o null si el schema no puede procesarse.
 */
export function buildExampleFromSchema(schema: JsonSchema | null | undefined): string | null {
  if (!schema) return null
  
  if (schema.type === 'object' || schema.properties) {
    const obj = buildObjectFromSchema(schema)
    // Si quedó vacío (sin campos required útiles), devolver null para usar fallback
    if (Object.keys(obj).length === 0) return null
    return JSON.stringify(obj, null, 2)
  }
  
  if (schema.type === 'string') {
    const val = inferStringValue('input', schema.description)
    if (val === '__OMIT__') return null
    return JSON.stringify({ input: val })
  }
  
  return null
}

export const EXAMPLE_FALLBACK = '{"input": ""}'
```

**Build gate Wave 1:**
```bash
npx tsc --noEmit 2>&1 | grep "buildExampleFromSchema" | head -5
```

---

## Wave 2 — Preview editable en Step3Technical.tsx

**Pre-flight Wave 2:**
- `Step3Technical.tsx` ya declara `inputSchemaRaw` en línea 22 — NO re-declarar
- `CreateModelDraft` no tiene campo `metadata` — usar `onChange('input_example', value)` directamente (agregar `input_example?: string | null` a `CreateModelDraft` en `model.schema.ts` antes de esta wave)
- Agregar `useRef` al import de React existente

**Cambio 2a — Agregar `input_example` a model.schema.ts:**
```typescript
// En src/lib/schemas/model.schema.ts — agregar campo al tipo CreateModelDraft:
input_example: z.string().optional().nullable(),
```

**Cambio 2b — Agregar estado y lógica en Step3Technical.tsx:**
```typescript
// AGREGAR después de los useState existentes (no re-declarar inputSchemaRaw):
const [inputExampleRaw, setInputExampleRaw] = useState<string>('')
const [exampleEditedByUser, setExampleEditedByUser] = useState(false)
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

// En el onChange del textarea de input_schema, DESPUÉS de validar JSON, agregar:
try {
  const parsed = JSON.parse(val)
  onChange('input_schema', parsed)
  // Solo auto-generar si el usuario no ha editado el ejemplo manualmente
  if (!exampleEditedByUser) {
    const generated = buildExampleFromSchema(parsed) ?? EXAMPLE_FALLBACK
    setInputExampleRaw(generated)
    onChange('input_example', generated)
  }
} catch { /* esperar JSON válido */ }

// En el JSX — agregar debajo del cierre del bloque input_schema (después del mensaje de error):
{inputSchemaRaw.trim() && (
  <div className="mt-3">
    <label className="mb-1 block text-xs font-medium text-gray-600">
      Input Example <span className="text-gray-400 font-normal">(auto-generated — edit if needed)</span>
    </label>
    <textarea
      rows={4}
      value={inputExampleRaw}
      onChange={e => {
        setInputExampleRaw(e.target.value)
        setExampleEditedByUser(true)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          onChange('input_example', e.target.value)
        }, 300)
      }}
      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-avax-100"
    />
    <p className="mt-1 text-xs text-gray-400">This will be shown to users as a pre-filled example</p>
  </div>
)}
```

**Cambio 2c — Incluir `input_example` en el PATCH de PublishForm.tsx (Wave 4 de publicación):**
```typescript
// En PublishForm.tsx, en el body del PATCH (~línea 173), agregar:
input_example: data.input_example ?? null,
```

**Build gate Wave 2:**
```bash
npx tsc --noEmit 2>&1 | grep "Step3Technical" | head -5
```

---

## Wave 3 — Migrar usos duplicados

**AgentTrialPlayground.tsx:** Reemplazar la función local `buildExampleFromSchema` por import del util:
```typescript
import { buildExampleFromSchema, EXAMPLE_FALLBACK } from '@/features/agents/utils/buildExampleFromSchema'
// Eliminar la función local
const defaultInput = inputExample ?? buildExampleFromSchema(inputSchema) ?? EXAMPLE_FALLBACK
```

**SandboxClient.tsx:** Mismo patrón — eliminar función local, importar util:
```typescript
import { buildExampleFromSchema, EXAMPLE_FALLBACK } from '@/features/agents/utils/buildExampleFromSchema'
// Reemplazar getExamplePayload / buildExampleFromSchema local
```

**Build gate Wave 3:**
```bash
npx tsc --noEmit 2>&1 | head -10
# Verificar que no queda código con <placeholder>
grep -rn '"<' src/features/agents/ src/app/\[locale\]/sandbox/ --include="*.tsx"
# Expected: 0 resultados
```

---

## Wave 4 — Build final + commit

```bash
npx tsc --noEmit 2>&1 | head -10
# Expected: 0 errores
git add -A
git commit -m "feat(WAS-206): centralize buildExampleFromSchema with smart heuristics + preview in publish form"
git push
```

---

## Rollback

```bash
git revert HEAD --no-edit && git push
```

---

## Critical Constraints

- **PROHIBIDO:** que `buildExampleFromSchema` devuelva strings con `<` o `>`
- **OBLIGATORIO:** función pura, sin imports de React ni side effects
- **OBLIGATORIO:** preview usa debounce 300ms para sync con estado del form
- **PROHIBIDO:** sobreescribir inputExampleRaw si el creador ya lo editó
