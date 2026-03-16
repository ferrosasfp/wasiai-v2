# DEUDA-01 — API no expone `example_input` resuelto

**Tipo:** FAST-FIX | **Fecha:** 2026-03-15 | **Prioridad:** Media | **Depende de:** WAS-206

---

## Contexto

`GET /api/v1/agents/{slug}` y `GET /api/v1/agents` no exponen `example_input` resuelto. Los consumidores (Sandbox, TryIt, agentes IA externos) deben implementar su propia lógica. El handler actual **no lee `metadata`** de Supabase — hay que agregar `metadata` al SELECT query.

**Archivos afectados:**
- `src/app/api/v1/agents/[slug]/route.ts` — agregar `metadata` al SELECT + campo `example_input` resuelto
- `src/app/api/v1/agents/route.ts` — agregar `example_input` resuelto por agente
- `src/features/agents/utils/resolveExampleInput.ts` (nuevo) — función centralizada

---

## Scope

**IN:**
- Crear `resolveExampleInput(agent)` centralizado
- Agregar `metadata` al SELECT de Supabase en `/api/v1/agents/{slug}`
- Exponer `example_input` resuelto en ambos endpoints
- `/api/v1/agents/discover` también debe incluir `example_input`

**OUT:**
- `POST /api/v1/agents/invoke` — no se modifica
- No modificar schema de BD

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN `GET /api/v1/agents/{slug}` responde, THEN SHALL incluir campo `example_input` (string JSON serializado) resuelto según jerarquía: `metadata.input_example` → `capabilities[0].example_input` → `buildExampleFromSchema(input_schema)` → `'{"input":""}'`.

**AC-2:** WHEN `GET /api/v1/agents` (list) responde, THEN cada agente SHALL incluir `example_input` resuelto con la misma jerarquía.

**AC-3:** WHEN `metadata.input_example` o `capabilities[0].example_input` existe pero falla `JSON.parse()`, THEN `resolveExampleInput` SHALL descartarlo silenciosamente y continuar al siguiente nivel.

**AC-3b:** WHEN `capabilities` está vacío `[]` o `capabilities[0]` es undefined, THEN `resolveExampleInput` SHALL continuar a `buildExampleFromSchema` sin lanzar excepción.

**AC-4:** WHEN `buildExampleFromSchema` retorna `{}` (schema sin propiedades útiles), THEN `example_input` SHALL ser el fallback `'{"input":""}'`.

**AC-5:** WHEN ningún nivel produce un ejemplo válido, THEN `example_input` SHALL ser `'{"input":""}'`, nunca `null`.

---

## Constraints

- `example_input` SHALL ser siempre un **string** (JSON serializado), nunca un objeto JS
- Campo **aditivo** — no rompe API contract existente
- `resolveExampleInput(agent)` centralizada — no duplicar lógica en los dos endpoints
- El handler de `/api/v1/agents/{slug}` debe agregar `metadata` al SELECT: `.select('... metadata ...')`
- Depende de WAS-206 para `buildExampleFromSchema` mejorada
