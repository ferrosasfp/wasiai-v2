# SDD #186: Agent Key Scoping — fix invoke directo

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14 | Clasificación: QUALITY

## 1. Resumen

El scope check ya existe en `compose/route.ts` y `agent-discovery.ts` pero no en el
endpoint principal `POST /api/v1/models/:slug/invoke`. Una key con `allowed_slugs`
puede bypassar el scope invocando directamente. Este SDD añade el check al invoke
principal y unifica el error code (`scope_violation` → `agent_not_in_scope`).

## 2. Acceptance Criteria

- **AC1:** WHEN migración 053 ya aplicada en prod (verificar — no re-aplicar).
- **AC2:** WHEN key con `allowed_slugs = ['agente-a']` invoca `POST /models/agente-b/invoke`, THE endpoint SHALL retornar 403 `{ error: "Agent not in scope", code: "agent_not_in_scope" }` ANTES del payment check.
- **AC3:** WHEN key con `allowed_slugs = []` (array vacío), THE sistema SHALL tratarlo como "sin acceso a ningún slug" — retornar 403 igual que el caso anterior.
- **AC4:** WHEN key con `allowed_slugs = null AND allowed_categories = null`, THE key SHALL tener acceso total (comportamiento actual).
- **AC5:** WHEN key con `allowed_slugs` y `allowed_categories` ambos definidos, THE lógica SHALL ser OR — acceso si slug está en lista OR categoría está en lista.
- **AC6:** WHEN `compose/route.ts` retorna scope error, THE error code SHALL ser `agent_not_in_scope` (unificar desde `scope_violation`).
- **AC7:** WHEN key con `allowed_slugs` contiene slug que ya no existe, THE invoke SHALL retornar 403 `agent_not_in_scope` (no 404).

## 3. Context Map

| Archivo | Rol |
|---------|-----|
| `src/lib/scope-check.ts` | `isAgentInScope()` — reutilizar sin modificar |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | AÑADIR scope check post key-lookup |
| `src/app/api/v1/compose/route.ts` | ACTUALIZAR error code a `agent_not_in_scope` |
| `src/features/docs/content/errors.tsx` | ACTUALIZAR code en docs |

## 4. Diseño Técnico

### 4.1 invoke/route.ts — añadir scope check

En el bloque "Route A: Agent Key", inmediatamente DESPUÉS de validar que `keyRow` existe y ANTES de cualquier payment check:

```typescript
// WAS-186: Scope check — BEFORE any payment processing
import { isAgentInScope } from '@/lib/scope-check'

// Dentro del bloque if (rawAgentKey):
// ...después de: if (!keyRow) return 401...

// AC3: empty array [] = no access (explicit early return — NOT sentinel string)
// isAgentInScope(slug, cat, [], []) → null/null lógic trataría [] como falsy
// Por eso: early return si ambos son arrays vacíos o si hay scope definido y no cumple
const hasSlugScope     = Array.isArray(keyRow.allowed_slugs)      && keyRow.allowed_slugs.length > 0
const hasCategoryScope = Array.isArray(keyRow.allowed_categories) && keyRow.allowed_categories.length > 0
const isEmptyScope     = (keyRow.allowed_slugs !== null      && !hasSlugScope)
                      || (keyRow.allowed_categories !== null && !hasCategoryScope)

if (isEmptyScope) {
  // Empty array explicitly set = no access to anything
  return NextResponse.json(
    { error: 'Agent not in scope', code: 'agent_not_in_scope' },
    { status: 403 },
  )
}

const slugsForCheck      = hasSlugScope     ? keyRow.allowed_slugs      : null
const categoriesForCheck = hasCategoryScope ? keyRow.allowed_categories : null

if (!isAgentInScope(slug, model.category, slugsForCheck, categoriesForCheck)) {
  return NextResponse.json(
    { error: 'Agent not in scope', code: 'agent_not_in_scope' },
    { status: 403 },
  )
}
```

**IMPORTANTE:** El SELECT de `agent_keys` en invoke/route.ts actualmente selecciona solo `id, key_hash, is_active, budget_usdc, spent_usdc`. Añadir `allowed_slugs, allowed_categories` al SELECT:

```typescript
.select('id, key_hash, is_active, budget_usdc, spent_usdc, allowed_slugs, allowed_categories')
```

### 4.2 compose/route.ts — unificar error code

```typescript
// ANTES:
{ error: 'Agent not in key scope', code: 'scope_violation', slug: agent.slug }

// DESPUÉS:
{ error: 'Agent not in scope', code: 'agent_not_in_scope', slug: agent.slug }
```

### 4.3 errors.tsx — actualizar docs

```typescript
// ANTES:
code: 'scope_violation'

// DESPUÉS:
code: 'agent_not_in_scope'
```

## 5. Wave Plan

**Wave 0** — Verificar que migración 053 ya está en prod: `SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_keys' AND column_name = 'allowed_slugs'`
**Wave 1** — Actualizar SELECT en `invoke/route.ts` para incluir `allowed_slugs, allowed_categories` → `npx tsc --noEmit`
**Wave 2** — Añadir scope check en `invoke/route.ts` → `npx tsc --noEmit`
**Wave 3** — Unificar error code en `compose/route.ts` y `errors.tsx` → `npx tsc --noEmit`
**Wave 4** — Commit: `fix(WAS-186): scope check en invoke directo + unificar error code agent_not_in_scope`

## 6. Rollback

`git revert <commit>` — los cambios son aditivos en el middleware, no destructivos.

## 7. Critical Constraints

- **OBLIGATORIO:** Scope check ANTES del payment check (no cobrar y luego denegar)
- **OBLIGATORIO:** Array vacío `[]` = sin acceso (no acceso total)
- **OBLIGATORIO:** Añadir `allowed_slugs, allowed_categories` al SELECT antes de usarlos
- **PROHIBIDO:** Modificar `src/lib/scope-check.ts` (función ya correcta)
- **PROHIBIDO:** Re-aplicar migración 053 (ya está en prod)
