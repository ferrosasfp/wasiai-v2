# SDD #200: Input Schema — validación pre-cobro en invoke principal

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14 | Clasificación: QUALITY

## 1. Resumen

`validateInput()` ya existe y está implementado en `sandbox/invoke`. El gap: el
endpoint principal `POST /api/v1/models/:slug/invoke` no lo llama — usuarios son
cobrados por input inválido. Este SDD añade la validación ANTES del payment check
y expone `input_schema` en los endpoints GET.

La migración correcta es **054** (ya existe en prod con la columna `input_schema`).

## 2. Acceptance Criteria

- **AC1:** WHEN migración 054 ya en prod (verificar — columna `input_schema JSONB` en `agents`).
- **AC2:** WHEN `POST /api/v1/models/:slug/invoke` con input que viola `input_schema`, THE endpoint SHALL retornar 422 `{ error: "Input validation failed", code: "input_invalid", details: [...] }` SIN cobrar ni ejecutar.
- **AC3:** WHEN `input_schema` es null, THE validación SHALL omitirse (comportamiento actual preservado).
- **AC4:** WHEN `input_schema` contiene `$ref` con URL externa, THE meta-validación ya bloquea al guardar — el invoke asume schema es seguro (no re-validar SSRF en invoke).
- **AC5:** WHEN `GET /api/v1/agents/:slug`, THE response SHALL incluir `input_schema` si existe (null si no).
- **AC6:** WHEN `GET /api/v1/agents` (list), THE response de cada agente SHALL incluir `input_schema` (null si no definido).
- **AC7:** WHEN schema circular o inválido llega al validador, THE `validateInput` SHALL retornar error (no crash) — ya manejado por AJV.

## 3. Context Map

| Archivo | Rol |
|---------|-----|
| `src/lib/schema-validator.ts` | `validateInput()` — reutilizar sin modificar |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | AÑADIR validación pre-cobro |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Exemplar — cómo se usa `validateInput` |
| `src/app/api/v1/agents/[slug]/route.ts` | AÑADIR `input_schema` al response |
| `src/app/api/v1/agents/route.ts` | AÑADIR `input_schema` al response de lista |

## 4. Diseño Técnico

### 4.1 invoke/route.ts — validación pre-cobro

**Contexto real del repo:** El body se consume en `callUpstream()` (helper interno, línea ~479: `body = await request.json()`). La validación debe ocurrir ANTES de llamar a `callUpstream`, usando el body ya parseado del request principal.

El handler principal lee el body implícitamente via `callUpstream`. El punto de inserción correcto es ANTES de la llamada a `callUpstream`, donde el body aún está disponible — el handler principal lo obtiene así:

```typescript
import { validateInput } from '@/lib/schema-validator'

// WAS-200: Validate input BEFORE payment — insertado ANTES de la sección de Route A/B
// El body se parsea aquí para validación; callUpstream lo volverá a parsear internamente
// (NextRequest body puede leerse múltiples veces en Next.js App Router — no hay stream único)
if (model.input_schema) {
  let inputVal: unknown
  try {
    const rawBody = await request.clone().json()
    inputVal = rawBody.input ?? rawBody
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'invalid_body' },
      { status: 400 },
    )
  }

  // validateInput returns string | null (error message or null if valid)
  const validErr = validateInput(model.input_schema, inputVal)
  if (validErr) {
    return NextResponse.json(
      { error: 'Input validation failed', code: 'input_invalid', details: [validErr] },
      { status: 422 },
    )
  }
}
```

**NOTA:** `validateInput` retorna `string | null` — wrappear en array `[validErr]` para cumplir AC2 que especifica `details: [...]`.

### 4.2 GET /api/v1/agents/:slug — input_schema YA IMPLEMENTADO

**Verificado en repo:** `input_schema` ya está en el SELECT (línea 35) y en el response (línea 96) de `GET /api/v1/agents/:slug`. **No requiere cambios.**

### 4.3 GET /api/v1/agents (list) — input_schema YA IMPLEMENTADO  

**Verificado en repo:** `input_schema` ya está en el SELECT y response del full path (líneas 127, 227). El slim path no lo incluye por diseño (es la versión ligera). **No requiere cambios en Waves 2 & 3.**

## 5. Wave Plan

**Wave 0** — Verificar migración 054: `SELECT column_name FROM information_schema.columns WHERE table_name='agents' AND column_name='input_schema'`
**Wave 1** — Añadir `validateInput` en `invoke/route.ts` (pre-cobro, con `request.clone()`) → `npx tsc --noEmit`
**Wave 2** — Commit: `feat(WAS-200): validateInput pre-cobro en invoke — input_schema en GET ya implementado`

*(Waves 2 & 3 originales eliminadas — input_schema ya está en ambos GET endpoints)*

## 6. Rollback

`git revert <commit>` — cambios aditivos, no destructivos.

## 7. Critical Constraints

- **OBLIGATORIO:** Validación ANTES del payment check (no cobrar input inválido)
- **OBLIGATORIO:** `request.clone()` antes de leer el body (no consumir stream)
- **OBLIGATORIO:** Si `input_schema` es null → skip validación (no regresar)
- **PROHIBIDO:** Re-aplicar migración 054 (ya en prod)
- **PROHIBIDO:** Modificar `src/lib/schema-validator.ts`
- **PROHIBIDO:** Añadir SSRF check en invoke (ya está en meta-validación al guardar)
