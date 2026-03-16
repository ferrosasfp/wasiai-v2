# SDD — DEUDA-01: API expone example_input resuelto

**Issue:** DEUDA-01 | **Clasificación:** FAST-FIX | **Fecha:** 2026-03-15 | **Depende de:** WAS-206

---

## Context

Crear `resolveExampleInput(agent)` centralizado y agregar `example_input` como campo aditivo en los endpoints de agentes. El handler de `/api/v1/agents/{slug}` debe agregar `metadata` al SELECT.

**Archivos a crear:**
- `src/features/agents/utils/resolveExampleInput.ts` (nuevo)

**Archivos a modificar:**
- `src/app/api/v1/agents/[slug]/route.ts` — agregar `metadata` al SELECT + campo `example_input`
- `src/app/api/v1/agents/route.ts` — agregar `example_input` por agente
- `src/app/api/v1/agents/discover/route.ts` — agregar `example_input`

---

## Wave 0 — Pre-flight

```bash
# Verificar que metadata no está en el SELECT actual
grep -n "metadata\|example_input" src/app/api/v1/agents/\[slug\]/route.ts | head -10
grep -n "metadata\|example_input" src/app/api/v1/agents/route.ts | head -10
# Verificar estructura de metadata en BD
grep -n "metadata" src/app/api/v1/agents/register/route.ts | head -10
```

---

## Wave 1 — resolveExampleInput util

**Archivo:** `src/features/agents/utils/resolveExampleInput.ts`

```typescript
import { buildExampleFromSchema, EXAMPLE_FALLBACK } from './buildExampleFromSchema'

interface AgentLike {
  metadata?: Record<string, unknown> | null
  capabilities?: Array<{ example_input?: string; [k: string]: unknown }> | null
  input_schema?: Record<string, unknown> | null
}

function isValidJson(str: unknown): str is string {
  if (typeof str !== 'string' || !str.trim()) return false
  try { JSON.parse(str); return true } catch { return false }
}

/**
 * Resuelve el ejemplo de input de un agente según jerarquía:
 * 1. metadata.input_example (string JSON válido)
 * 2. capabilities[0].example_input (string JSON válido)
 * 3. buildExampleFromSchema(input_schema)
 * 4. EXAMPLE_FALLBACK '{"input":""}'
 * 
 * @returns siempre un string JSON válido, nunca null
 */
export function resolveExampleInput(agent: AgentLike): string {
  // 1. metadata.input_example
  const metaExample = agent.metadata?.input_example
  if (isValidJson(metaExample)) return metaExample as string

  // 2. capabilities[0].example_input
  const capExample = agent.capabilities?.[0]?.example_input
  if (isValidJson(capExample)) return capExample as string

  // 3. buildExampleFromSchema
  const schemaExample = buildExampleFromSchema(agent.input_schema)
  if (schemaExample) return schemaExample

  // 4. fallback garantizado
  return EXAMPLE_FALLBACK
}
```

**Build gate Wave 1:**
```bash
npx tsc --noEmit 2>&1 | grep "resolveExampleInput" | head -5
```

---

## Wave 2 — Agregar metadata al SELECT y example_input al response de /agents/{slug}

```typescript
// En GET /api/v1/agents/[slug]/route.ts — agregar metadata al SELECT:
.select(`
  id, slug, name, description, category, agent_type, status,
  price_per_call, cover_image, is_featured,
  endpoint_url, mcp_tool_name, capabilities, input_schema, output_schema,
  total_calls, total_revenue, reputation_score, reputation_count, performance_score,
  sandbox_enabled, metadata,   ← AGREGAR
  created_at,
  creator:creator_profiles(id, username, display_name, avatar_url, verified)
`)

// En el objeto body de respuesta, agregar:
example_input: resolveExampleInput(agent),
```

**Build gate Wave 2:**
```bash
npx tsc --noEmit 2>&1 | grep "agents/\[slug\]" | head -5
```

---

## Wave 3 — Agregar example_input en /agents (list) y /discover

En `/api/v1/agents/route.ts` dentro del `.map()` de agentes:
```typescript
example_input: resolveExampleInput(agent),
```

En `/api/v1/agents/discover/route.ts` — mismo patrón.

**Build gate Wave 3:**
```bash
npx tsc --noEmit 2>&1 | head -10
```

---

## Wave 4 — Build final + commit

```bash
npx tsc --noEmit 2>&1 | head -10
git add -A
git commit -m "feat(DEUDA-01): expose resolved example_input in agents API endpoints"
git push
```

---

## Rollback

```bash
git revert HEAD --no-edit && git push
```

---

## Critical Constraints

- `example_input` SHALL ser siempre **string**, nunca objeto JS
- Campo **aditivo** — no modificar campos existentes en la respuesta
- `metadata` debe agregarse al SELECT en `/agents/{slug}` (cambio de query)
