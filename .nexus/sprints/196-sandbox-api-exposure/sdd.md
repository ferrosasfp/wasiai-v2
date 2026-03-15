# SDD #196: Sandbox opt-in/out — exponer sandbox_enabled en API

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14 | Clasificación: HU-MAJOR

## 1. Resumen

La migración y la lógica de sandbox ya existen. El único gap: `GET /api/v1/agents/:slug`
no incluye `sandbox_enabled` en la respuesta (AC5 del WI original). Este SDD es
un patch quirúrgico: añadir el campo al SELECT y al response object.

## 2. Acceptance Criteria

- **AC1:** WHEN `GET /api/v1/agents/:slug`, THE response SHALL incluir `sandbox_enabled: boolean`.
- **AC2:** WHEN `GET /api/v1/agents` (list), THE response de cada agente SHALL incluir `sandbox_enabled: boolean`.
- **AC3:** WHEN `sandbox_enabled = false` en DB, `POST /sandbox/invoke/:slug` SHALL retornar 403 (ya implementado — regresión test).
- **AC4:** WHEN `sandbox_enabled = true` (default), THE sandbox invoke SHALL funcionar normalmente (regresión test).

## 3. Context Map

| Archivo | Rol |
|---------|-----|
| `src/app/api/v1/agents/[slug]/route.ts` | MODIFICAR — añadir campo al SELECT + response |
| `src/app/api/v1/agents/route.ts` | MODIFICAR — añadir campo al SELECT + response de lista |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | NO tocar — ya funciona |

## 4. Diseño Técnico

### 4.1 GET /api/v1/agents/:slug

```typescript
// En el SELECT (línea ~36):
// AÑADIR sandbox_enabled
.select('id, slug, name, ..., reputation_score, reputation_count, sandbox_enabled, ...')

// En el response object:
sandbox_enabled: agent.sandbox_enabled ?? true,  // default true = seguro
```

### 4.2 GET /api/v1/agents (list) — DOS paths

El list route tiene dos paths: **slim** (select reducido) y **full** (select completo).

**Slim path** (`if (slim)` block, ~línea 86):
```typescript
// Añadir sandbox_enabled al SELECT slim:
.select('slug, name, description, category, agent_type, price_per_call, is_featured, mcp_tool_name, sandbox_enabled', { count: 'exact' })

// En el map de respuesta slim (~línea 104):
sandbox_enabled: a.sandbox_enabled ?? true,
```

**Full path** (query con JOIN, ~línea 122):
```typescript
// El SELECT full ya usa backtick multiline — añadir sandbox_enabled a la lista de columnas

// En el map de respuesta full:
sandbox_enabled: agent.sandbox_enabled ?? true,
```

## 5. Wave Plan

**Wave 1** — `GET /api/v1/agents/:slug` — SELECT + response → `npx tsc --noEmit`
**Wave 2** — `GET /api/v1/agents` (list) — SELECT + response → `npx tsc --noEmit`
**Wave 3** — Commit: `feat(WAS-196): exponer sandbox_enabled en GET /agents y GET /agents/:slug`

## 6. Rollback

`git revert <commit>` — solo se añaden campos al response, no se elimina lógica.

## 7. Critical Constraints

- **OBLIGATORIO:** Default `?? true` si el campo es null (fail-safe)
- **PROHIBIDO:** Modificar la lógica de sandbox/invoke (ya correcta)
- **PROHIBIDO:** Añadir nueva migración DB (sandbox_enabled ya existe)
