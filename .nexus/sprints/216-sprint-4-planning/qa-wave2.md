# QA Report — Sprint 4 Wave 2
> Generado: 2026-03-14 | QA: San (subagent)

---

## QA Report — WAS-186 (commit `1adff02`)

### Drift Detection

| Dimensión | Esperado (SDD) | Real | Status |
|-----------|---------------|------|--------|
| `invoke/route.ts` | Añadir scope check + SELECT fields | Modificado (+27 líneas) | ✅ MATCH |
| `compose/route.ts` | Unificar error code a `agent_not_in_scope` | Modificado (4 líneas) | ✅ MATCH |
| `errors.tsx` | Actualizar code en docs | Modificado (1 línea) | ✅ MATCH |
| `scope-check.ts` | NO modificar | Sin cambios (PROHIBIDO respetado) | ✅ MATCH |
| Migración 053 | NO re-aplicar | No hay archivo de migración en commit | ✅ MATCH |

### AC Verification

| AC | Status | Evidencia | Test |
|----|--------|-----------|------|
| AC1: migración 053 ya en prod | ✅ CUMPLE | No re-aplicada en commit (Wave 0 verificado externamente) | N/A |
| AC2: `allowed_slugs=['agente-a']` → 403 `agent_not_in_scope` ANTES de payment | ✅ CUMPLE | `invoke/route.ts:277-280` — `isAgentInScope()` retorna false → 403 antes de payment | Sin test automatizado |
| AC3: `allowed_slugs=[]` → 403 | ✅ CUMPLE | `invoke/route.ts:264-269` — `isEmptyScope` detecta array vacío, retorna 403 inmediatamente | Sin test automatizado |
| AC4: `null/null` → acceso total | ✅ CUMPLE | `scope-check.ts:13` — `if (!allowedSlugs && !allowedCategories) return true`; en invoke `slugsForCheck=null, categoriesForCheck=null` → `isAgentInScope` retorna true | Sin test automatizado |
| AC5: OR logic slug OR category | ✅ CUMPLE | `scope-check.ts:16-17` — OR explícito: `allowedSlugs.includes()` OR `allowedCategories.includes()` | Sin test automatizado |
| AC6: `compose/route.ts` retorna `agent_not_in_scope` | ✅ CUMPLE | `compose/route.ts:269` — `{ error: 'Agent not in scope', code: 'agent_not_in_scope', slug: agent.slug }` | Sin test automatizado |
| AC7: slug inexistente → 403 `agent_not_in_scope` (no 404) | ✅ CUMPLE | `invoke/route.ts:277-280` — el slug no estará en `allowed_slugs` → `isAgentInScope` false → 403 | Sin test automatizado |

**Notas AC2/AC3 — orden de ejecución:**
- Payment se ejecuta en el cuerpo de Route A (después de mutex acquisition en línea ~295+).
- Scope check está en `invoke/route.ts:260-280`, ANTES del mutex/payment.
- `isEmptyScope` early-return en línea 267 garantiza AC3 estrictamente.

**Notas AC4 — flujo null/null:**
- `hasSlugScope = false`, `hasCategoryScope = false`
- `isEmptyScope = (null !== null && ...) || (null !== null && ...) = false || false = false`
- No early-return → `slugsForCheck = null, categoriesForCheck = null`
- `isAgentInScope(slug, cat, null, null)` → `return true` (acceso total) ✅

### Build & Tests

| Check | Result | Detail |
|-------|--------|--------|
| `npx tsc --noEmit` | ✅ PASS | Sin errores (output vacío) |
| `npx jest --passWithNoTests` | ⚠️ PRE-EXISTING FAIL | 139 suites fallan: son tests de OpenZeppelin smart contracts (`contracts/lib/openzeppelin-contracts/`) con errores de parseo Babel. No relacionados con WAS-186. Ningún test TypeScript de la app falla. |

### Veredicto: QA PASS ✅

> Todos los ACs implementados con evidencia archivo:línea. Build limpio. Regresiones son pre-existentes (OZ contracts), no introducidas por este commit.

---

## QA Report — WAS-200 (commit `c1d5e55`)

### Drift Detection

| Dimensión | Esperado (SDD) | Real | Status |
|-----------|---------------|------|--------|
| `invoke/route.ts` | Añadir validación pre-cobro con `validateInput` | Modificado (+23 líneas) | ✅ MATCH |
| `agents/[slug]/route.ts` | YA implementado — no cambios | Sin cambios en commit | ✅ MATCH |
| `agents/route.ts` | YA implementado — no cambios | Sin cambios en commit | ✅ MATCH |
| `schema-validator.ts` | NO modificar (PROHIBIDO) | Sin cambios | ✅ MATCH |
| Migración 054 | NO re-aplicar | No hay migración en commit | ✅ MATCH |

### AC Verification

| AC | Status | Evidencia | Test |
|----|--------|-----------|------|
| AC1: migración 054 ya en prod | ✅ CUMPLE | No re-aplicada en commit | N/A |
| AC2: input inválido → 422 `input_invalid` ANTES de cobrar | ✅ CUMPLE | `invoke/route.ts:228-244` — `if (model.input_schema)` → `validateInput()` → 422 `{ code: 'input_invalid', details: [validErr] }`. Bloque en líneas 227-246, ANTES de Route A/B (pago) en línea 249+ | Sin test automatizado |
| AC3: `input_schema = null` → skip validación | ✅ CUMPLE | `invoke/route.ts:228` — `if (model.input_schema)` es falsy si null → skip completo | Sin test automatizado |
| AC4: `$ref` SSRF no re-validado en invoke | ✅ CUMPLE | SDD indica "no re-validar SSRF en invoke" — no hay código adicional de SSRF en el bloque WAS-200 | N/A |
| AC5: `GET /api/v1/agents/:slug` incluye `input_schema` | ✅ CUMPLE | `agents/[slug]/route.ts:35` (SELECT incluye `input_schema`) y `:98` (`input_schema: agent.input_schema ?? null`) | Sin test automatizado |
| AC6: `GET /api/v1/agents` incluye `input_schema` en full path | ✅ CUMPLE | `agents/route.ts:129` (SELECT incluye `input_schema`) y `:238` (`input_schema: agent.input_schema ?? null`) | Sin test automatizado |
| AC7: schema circular/inválido → error (no crash) | ✅ CUMPLE | Delegado a AJV dentro de `schema-validator.ts` (ya manejado, no modificado) | N/A |

**Notas AC2 — orden de ejecución:**
- `invoke/route.ts:227-246`: validación de input.
- `invoke/route.ts:249`: inicio de `// ── 2. Route A: Agent Key`
- `request.clone().json()` (línea 231) evita consumir el stream original ✅
- Payment (mutex + `settlePaymentDirectly`) ocurre mucho después en Route A/B ✅

**Notas AC5/AC6 — ya implementados pre-commit:**
- Confirmado que `input_schema` ya estaba en ambos GET endpoints antes de este commit, conforme indica el SDD §4.2 y §4.3 "No requiere cambios".

### Build & Tests

| Check | Result | Detail |
|-------|--------|--------|
| `npx tsc --noEmit` | ✅ PASS | Sin errores |
| `npx jest --passWithNoTests` | ⚠️ PRE-EXISTING FAIL | Mismos 139 suites OZ contracts. No relacionados con WAS-200. |

### Veredicto: QA PASS ✅

> Todos los ACs implementados con evidencia. Input validation correctamente antes de payment. Build limpio.

---

## Resumen Ejecutivo

| Issue | Commit | ACs | Build | Tests | Veredicto |
|-------|--------|-----|-------|-------|-----------|
| WAS-186 | `1adff02` | 7/7 ✅ | ✅ PASS | ⚠️ pre-existing | **QA PASS** |
| WAS-200 | `c1d5e55` | 7/7 ✅ | ✅ PASS | ⚠️ pre-existing | **QA PASS** |

### Observaciones globales

1. **Sin tests automatizados** para los nuevos paths (scope check, input validation). Se recomienda crear tests de integración para AC2/AC3 de ambos issues en una sprint futura.
2. **139 test suites fallando** son de `contracts/lib/openzeppelin-contracts/` — son tests Hardhat/Solidity corriendo via Jest sin la configuración adecuada. Pre-existentes, no introducidos en Wave 2.
3. **Constraint crítica verificada** en ambos issues: las nuevas validaciones ocurren **ANTES** del payment check, cumpliendo el requisito de "no cobrar antes de validar".
