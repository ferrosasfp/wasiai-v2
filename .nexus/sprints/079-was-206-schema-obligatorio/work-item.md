# WAS-206 — input_schema + buildExampleFromSchema inteligente + preview en formulario

**Tipo:** HU-MAJOR | **Fecha:** 2026-03-15 | **Prioridad:** Alta | **Bloquea:** WAS-205, DEUDA-01, DEUDA-03

---

## Contexto

Al publicar un agente, `input_schema` es opcional. Sin schema no hay forma de generar un ejemplo ejecutable. `buildExampleFromSchema` genera `<placeholder>` en vez de valores reales. La función está duplicada en `AgentTrialPlayground.tsx` y `SandboxClient.tsx`.

`Step3Technical.tsx` es exclusivo del flujo de **publicación nueva** — no se usa en edición de agentes.

**Archivos afectados:**
- `src/features/agents/utils/buildExampleFromSchema.ts` (nuevo — función centralizada)
- `src/components/publish/Step3Technical.tsx` — agregar preview editable
- `src/features/agents/components/AgentTrialPlayground.tsx` — migrar al util centralizado
- `src/app/[locale]/sandbox/SandboxClient.tsx` — migrar al util centralizado

---

## Scope

**IN:**
- Crear `src/features/agents/utils/buildExampleFromSchema.ts` con heurísticas inteligentes
- Agregar preview editable en tiempo real en `Step3Technical.tsx`
- Guardar el ejemplo (generado o editado) como `metadata.input_example` al publicar
- Migrar usos duplicados de `buildExampleFromSchema` en AgentTrialPlayground.tsx y SandboxClient.tsx al nuevo util centralizado

**OUT:**
- No activar `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA` (eso es DEUDA-03)
- No modificar agentes existentes en BD
- No tocar formulario de edición de agente (Step3Technical.tsx es exclusivo de publicación)
- Schemas con `$ref`, `oneOf`, `anyOf`, `allOf` — devuelven `{}` sin procesamiento recursivo (v1)

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN el creador ingresa un `input_schema` JSON válido en el formulario, THEN el sistema SHALL mostrar un preview editable del ejemplo generado en tiempo real debajo del campo schema.

**AC-2:** WHEN `buildExampleFromSchema` procesa un campo `string` con `description`, THEN SHALL inferir un valor real según las heurísticas de la tabla, nunca devolviendo el texto de la descripción como valor.

**AC-3:** WHEN `buildExampleFromSchema` procesa un campo `string` sin `description`, THEN SHALL devolver `""` (string vacío), nunca `<fieldname>` ni `<placeholder>`.

**AC-4:** WHEN un campo aparece en `properties` pero NO en `required[]`, THEN `buildExampleFromSchema` SHALL omitirlo del ejemplo.

**AC-4b:** WHEN `input_schema` no define el array `required` (campo ausente), THEN `buildExampleFromSchema` SHALL incluir todos los campos definidos en `properties`.

**AC-5:** WHEN el creador modifica el preview antes del submit, THEN el valor modificado SHALL sincronizarse en el estado del formulario y guardarse como `metadata.input_example` al publicar.

**AC-6:** WHEN el creador no modifica el preview y hace submit, THEN el ejemplo generado automáticamente SHALL guardarse como `metadata.input_example`.

**AC-7:** WHEN `input_schema` es JSON inválido, THEN el preview SHALL mostrarse vacío sin bloquear el formulario.

**AC-8:** WHEN el matching de heurísticas evalúa `description` o `key`, THEN SHALL ser case-insensitive (`Address`, `address`, `ADDRESS` producen el mismo resultado).

**AC-9:** WHEN `buildExampleFromSchema` procesa un campo `string` con `enum`, THEN SHALL devolver `enum[0]` como valor de ejemplo.

**AC-10:** WHEN los usos de `buildExampleFromSchema` en `AgentTrialPlayground.tsx` y `SandboxClient.tsx` son migrados, THEN el comportamiento observable SHALL ser idéntico al actual (no regresiones).

---

## Heurísticas de buildExampleFromSchema

| Patrón en key o description (case-insensitive) | Valor generado |
|---|---|
| "address", "wallet", "0x" | `"0xAbCd...1234"` |
| "token", "symbol" | `"AVAX"` |
| "text", "content", "message", "query" | `"Hello world"` |
| "url", "endpoint" | `"https://example.com"` |
| "email" | `"user@example.com"` |
| "name" | `"My Agent"` |
| "id", "uuid" | `"abc-123"` |
| "optional" o description empieza con "Optional" | omitir campo |
| Ninguno de los anteriores (string) | `""` |
| number / integer | `0` |
| boolean | `true` |
| array | `[]` |
| object con properties | aplicar heurísticas recursivamente |
| object sin properties / $ref / oneOf | `{}` |

---

## Constraints

- **PROHIBIDO** que `buildExampleFromSchema` devuelva strings con `<` o `>`
- **OBLIGATORIO** que el output sea JSON.parse()-able
- La función debe ser pura y testeable (sin side effects)
- El preview debe ser un `<textarea>` editable con `font-mono`
- Sincronización del preview con estado: al `onChange` del textarea (no en cada keystroke — usar debounce de 300ms)
