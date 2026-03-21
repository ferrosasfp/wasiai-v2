# SDD #261: Wizard + Register API — input_schema obligatorio + example_input auto-inferido

> SPEC_APPROVED: no
> Fecha: 2026-03-20
> Tipo: improvement
> SDD_MODE: full
> Branch: improvement/261-input-schema-required
> Linear: WAS-258

---

## 1. Resumen

El campo `input_schema` es el contrato del agente. Sin el, un caller no sabe que enviar. Hoy es opcional en wizard y en `/api/v1/agents/register`. Esta HU hace el wizard obligatorio y auto-infiere `example_input` usando `buildExampleFromSchema` (ya existe en el codebase).

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 261 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Scope IN** | wizard (step/route.ts + start/route.ts) + register API (register/route.ts) |
| **Scope OUT** | UI del PublishForm, migraciones de DB (columnas ya existen), agentes existentes |

### Acceptance Criteria (EARS)

- AC1: WHEN wizard reaches step 6 (tags), next step (7) SHALL ask for input_schema in JSON Schema format
- AC2: IF input_schema answer is invalid JSON, wizard SHALL reject with 400
- AC3: IF input_schema has zero properties, wizard SHALL reject with 400
- AC4: IF input_schema fails metaValidateSchema, wizard SHALL reject with 400
- AC5: WHEN input_schema is valid, it SHALL be stored in session data
- AC6: WHEN agent is inserted (step 8 - email step), example_input SHALL be auto-inferred via buildExampleFromSchema
- AC7: WHEN buildExampleFromSchema returns null, example_input SHALL default to '{}'
- AC8: start/route.ts total_steps SHALL be updated from 7 to 8
- AC9: WHEN POST /api/v1/agents/register is called WITH input_schema, SHALL auto-infer example_input via buildExampleFromSchema
- AC10: POST /api/v1/agents/register input_schema remains optional (no breaking change)
- AC11: TypeScript build SHALL pass

---

## 3. Context Map

### Archivos a leer
| Archivo | Por que |
|---------|---------|
| `src/app/api/v1/onboard/step/route.ts` | QUESTIONS dict + switch + agent insert (case 7 actual) |
| `src/app/api/v1/onboard/start/route.ts` | total_steps: 7 |
| `src/app/api/v1/agents/register/route.ts` | RegisterAgentSchema + insert |
| `src/features/agents/utils/buildExampleFromSchema.ts` | Funcion a reutilizar — retorna string o null |

### Estado de DB
| Columna | Tabla | Estado |
|---------|-------|--------|
| `input_schema` | `agents` | EXISTS, JSONB, DEFAULT NULL (migracion 054) |
| `example_input` | `agents` | EXISTS (en uso en agents/route.ts) |

### Funcion existente a reutilizar
`buildExampleFromSchema(schema: JsonSchema | null | undefined): string | null`
- Ubicacion: `src/features/agents/utils/buildExampleFromSchema.ts`
- Retorna: JSON string listo para usar, o null si no puede inferir
- Ya maneja: nested objects, enums, arrays, descriptions, heuristicas por nombre de campo
- NO crear funcion nueva — reutilizar esta

---

## 4. Diseno Tecnico

### Step numbering definitivo

**ANTES:** 1(name) -> 2(desc) -> 3(endpoint) -> 4(category) -> 5(price) -> 6(tags) -> 7(email+insert)
**DESPUES:** 1(name) -> 2(desc) -> 3(endpoint) -> 4(category) -> 5(price) -> 6(tags) -> 7(input_schema) -> 8(email+insert)

- `case 7` actual (email+insert) SE RENUMERA a `case 8`
- `QUESTIONS[7]` actual (email) SE RENUMERA a `QUESTIONS[8]`
- Nuevo `case 7` = input_schema
- Nuevo `QUESTIONS[7]` = pregunta de input_schema

### 4.1 Archivo 1: `src/app/api/v1/onboard/step/route.ts`

**Cambio 1 — QUESTIONS dict:** Renombrar key 7 -> 8, agregar key 7:
```
QUESTIONS[7] = { question: "Describe your agent's input schema (JSON Schema format).", hint: 'e.g. {"type":"object","properties":{"wallet":{"type":"string","description":"Avalanche address (0x...)"}}}' }
QUESTIONS[8] = { question: 'What is your email address?', hint: 'We will create your creator account and generate your API key.' }
```

**Cambio 2 — switch:** Renombrar `case 7:` a `case 8:`. Agregar nuevo `case 7:` ANTES del case 8:

```ts
case 7: {
  let parsed: Record<string, unknown>
  try {
    parsed = typeof answer === 'string'
      ? JSON.parse(answer) as Record<string, unknown>
      : answer as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'input_schema must be valid JSON' }, { status: 400 })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'input_schema must be a JSON object' }, { status: 400 })
  }
  // Verificar que tiene al menos 1 propiedad
  const props = parsed.properties as Record<string, unknown> | undefined
  const hasProps = (props && Object.keys(props).length > 0)
    || (!parsed.type && !parsed.properties && Object.keys(parsed).length > 0)
  if (!hasProps) {
    return NextResponse.json({ error: 'Schema must have at least one property' }, { status: 400 })
  }
  // Sanitizar via metaValidateSchema (ya importado en register, pero en step/route.ts verificar si existe)
  // Si no esta importado, omitir este paso — la validacion basica de above es suficiente
  data.input_schema = parsed
  break
}
```

**Cambio 3 — agent insert en case 8:** Agregar los dos campos al objeto de insert:
```ts
import { buildExampleFromSchema } from '@/features/agents/utils/buildExampleFromSchema'
// tipo local para satisfacer TypeScript:
type JsonSchema = Parameters<typeof buildExampleFromSchema>[0]

// Dentro del insert del agente en case 8:
example_input: data.input_schema
  ? (buildExampleFromSchema(data.input_schema as JsonSchema) ?? '{}')
  : '{}',
input_schema: data.input_schema ?? null,
```

### 4.2 Archivo 2: `src/app/api/v1/onboard/start/route.ts`

- Cambiar `total_steps: 7` a `total_steps: 8`

### 4.3 Archivo 3: `src/app/api/v1/agents/register/route.ts`

- `input_schema` permanece `z.unknown().optional().nullable()` — NO breaking change
- Agregar comentario: `// Strongly recommended — callers without input_schema get no example_input`
- Despues de la validacion existente de `metaValidateSchema`, si `data.input_schema` existe, auto-inferir example_input:
```ts
import { buildExampleFromSchema } from '@/features/agents/utils/buildExampleFromSchema'
type JsonSchema = Parameters<typeof buildExampleFromSchema>[0]

// En el insert del agente:
example_input: data.input_schema
  ? (buildExampleFromSchema(data.input_schema as JsonSchema) ?? null)
  : null,
```

---

## 5. Waves

### Wave 0 — Pre-flight (Builder verifica)
- [ ] Confirmar que `input_schema` y `example_input` existen en tabla `agents`
- [ ] Confirmar que `buildExampleFromSchema` esta en `src/features/agents/utils/buildExampleFromSchema.ts`
- [ ] Confirmar que case 7 actual es el del email+insert
- [ ] Confirmar que `metaValidateSchema` esta importado o importable en step/route.ts

### Wave 1 — Wizard: nuevo step 7 + renumeracion
- Renombrar QUESTIONS[7] -> QUESTIONS[8]
- Agregar QUESTIONS[7] (input_schema)
- Renombrar `case 7:` -> `case 8:` en el switch
- Agregar nuevo `case 7:` (input_schema validation)
- Agregar import de `buildExampleFromSchema` en step/route.ts
- Agregar `example_input` e `input_schema` al insert del agente en case 8
- **Build gate:** `npx tsc --noEmit`

### Wave 2 — start/route.ts
- Cambiar `total_steps: 7` -> `total_steps: 8`
- **Build gate:** `npx tsc --noEmit`

### Wave 3 — Register API
- Agregar comentario en `input_schema` del schema Zod
- Agregar import de `buildExampleFromSchema` en register/route.ts
- Agregar auto-inferencia de `example_input` en el insert
- **Build gate:** `npx tsc --noEmit`

---

## 6. Rollback

`git revert` del commit. Sin migraciones. Safe.

---

## 7. Constraint Directives

**OBLIGATORIO:**
- Reutilizar `buildExampleFromSchema` — NO crear funcion nueva
- `input_schema` en register API permanece `.optional().nullable()` — no breaking change
- Step numbering: case 7 = input_schema, case 8 = email+insert (renumerado)
- Build gate al final de cada wave
- NO hacer git push

**PROHIBIDO:**
- Crear funcion `inferExampleInput` ni ninguna funcion de inferencia nueva
- Cambiar `input_schema` a required en register/route.ts
- Modificar PublishForm.tsx u otros archivos de UI
- Modificar migraciones de DB
