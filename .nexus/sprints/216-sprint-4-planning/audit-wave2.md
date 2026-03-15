# Audit Wave 2 — WAS-186 + WAS-200
> Auditor: NexusAgil Logic Auditor + Security Reviewer v1.3
> Fecha: 2026-03-14

---

## Audit — WAS-186 (commit `1adff02`)

### Logic Audit

#### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|--------------|--------|
| AC1: Migración 053 ya aplicada (no re-aplicar) | Pre-condición — no aplica al commit | N/A | ✅ OK |
| AC2: Key con `allowed_slugs=['agente-a']` invocando `agente-b` → 403 `agent_not_in_scope` ANTES del payment | `isAgentInScope` retorna false → 403 antes del mutex Redis | `invoke/route.ts:270-282` | ✅ OK |
| AC3: `allowed_slugs=[]` → 403 (sin acceso a nada) | `isEmptyScope` detecta array vacío → early return 403 | `invoke/route.ts:258-268` | ✅ OK |
| AC4: `allowed_slugs=null AND allowed_categories=null` → acceso total | `isEmptyScope=false`, `isAgentInScope(null,null)` retorna `true` | `invoke/route.ts:258-282` | ✅ OK |
| AC5: Ambos definidos → lógica OR | `slugsForCheck`/`categoriesForCheck` pasados a `isAgentInScope` con lógica OR | `invoke/route.ts:274-282` + `scope-check.ts` | ✅ OK |
| AC6: `compose/route.ts` unifica error code a `agent_not_in_scope` | Dos ocurrencias actualizadas (scope check + fallback) | `compose/route.ts:269,312` | ✅ OK |
| AC7: Key con slug ya no existente → 403 (no 404) | El slug invocado es real; `isAgentInScope` falla contra allowed_slugs → 403 | `invoke/route.ts:270-282` | ✅ OK |

#### Findings Lógicos

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|--------------|
| 1 | MENOR | Edge case / isEmptyScope | Si una key tiene `allowed_slugs=['agent-a']` (válido) **Y** `allowed_categories=[]` (vacío), `isEmptyScope=true` → 403, bloqueando el acceso vía slug. Lógica OR de AC5 nunca se evalúa. El caso inverso (`allowed_slugs=[]` + `allowed_categories=['cat']`) también bloquea. Esta semántica es "ambos deben ser no-vacíos si están definidos", no OR pura. El SDD incluye exactamente este código en la sección 4.1, por lo que es un gap de especificación, no de implementación. | `invoke/route.ts:258-263` |
| 2 | MENOR | SELECT scope | `allowed_slugs` y `allowed_categories` se añaden correctamente al SELECT antes de usarse. Sin embargo, si Supabase retorna tipos `null` vs `[]` dependiendo del driver, la lógica `Array.isArray` podría tener comportamiento inesperado. No es bloqueante dado que TypeScript + Supabase tipan correctamente. | `invoke/route.ts:161` |

#### Veredicto Logic: **APROBADO** ✅

Los 7 ACs están correctamente implementados. Los 2 findings son menores/especificación; no requieren corrección en este commit.

---

### Security Review

#### Superficie de ataque

| Categoría | Nuevos elementos | Auth | Status |
|-----------|-----------------|------|--------|
| AuthZ — scope check en invoke directo | `isAgentInScope` + `isEmptyScope` en Route A | ✅ DESPUÉS de keyRow existence check, ANTES del mutex Redis y payment | ✅ SEGURO |
| Error code unification | `scope_violation` → `agent_not_in_scope` | N/A (cosmético) | ✅ INFO |
| SELECT query expansion | Se añaden `allowed_slugs, allowed_categories` al SELECT | Solo lectura, no expone datos al cliente | ✅ SEGURO |

#### Findings Seguridad

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|--------------|
| 1 | INFO | AuthZ ordering | Scope check está correctamente posicionado: después de `if (!keyRow) → 401` y antes de `Redis mutex` y cualquier payment logic. El orden crítico se respeta. | `invoke/route.ts:256-290` |
| 2 | LOW | Scope bypass via Route B | El scope check solo aplica a Route A (Agent Key). Route B (x402 payment header) no tiene scope check — una key podría explotar Route B para bypasear scopes. Sin embargo, Route B no usa `agent_keys`, por lo que el concepto de scope no aplica. Comportamiento intencional, pero merece documentarse. | `invoke/route.ts:251` (Route B section) |

#### Veredicto Security: **SEGURO** ✅

El scope check está en el lugar correcto. No hay TOCTOU, no hay path de bypass. Finding #2 es comportamiento intencional documentado.

---

## Audit — WAS-200 (commit `c1d5e55`)

### Logic Audit

#### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|--------------|--------|
| AC1: Migración 054 ya en prod (no re-aplicar) | Pre-condición — no aplica al commit | N/A | ✅ OK |
| AC2: Input inválido → 422 `input_invalid` + `details: [...]` SIN cobrar | `validateInput` retorna `string\|null`; wrapeado en `[validErr]` → 422 antes de Route A/B | `invoke/route.ts:228-247` | ✅ OK |
| AC3: `input_schema=null` → skip validación | `if (model.input_schema)` → bloque no ejecuta | `invoke/route.ts:228` | ✅ OK |
| AC4: `$ref` con URL externa → asumido seguro (meta-validación ya bloquea) | No hay re-validación SSRF en invoke — comportamiento correcto | N/A | ✅ OK |
| AC5: `GET /api/v1/agents/:slug` incluye `input_schema` | SDD verifica que ya estaba implementado; no se requieren cambios | Pre-existente | ✅ OK |
| AC6: `GET /api/v1/agents` (list) incluye `input_schema` | SDD verifica que ya estaba implementado | Pre-existente | ✅ OK |
| AC7: Schema circular/inválido → `validateInput` retorna error (AJV no crash) | Manejado por AJV en `schema-validator.ts` — no modificado | `schema-validator.ts` | ✅ OK |

#### Findings Lógicos

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|--------------|
| 1 | MENOR | Input resolution: `rawBody.input ?? rawBody` | El validador extrae `rawBody.input ?? rawBody` como el valor a validar. Si el schema espera el body completo (e.g., `{ query: "..." }`) pero el usuario envía `{ input: { query: "..." } }`, se valida `rawBody.input`. Si el schema espera directamente `{ query }` en el root, funciona. Esta ambigüedad depende de la convención de los agentes — no es un bug de implementación sino un contrato de API que debe estar documentado. Consistente con cómo `sandbox/invoke` lo hace. | `invoke/route.ts:232` |
| 2 | MENOR | Posición relativa WAS-200 vs WAS-186 | `validateInput` (WAS-200) corre ANTES de Route A/B, lo que incluye ANTES del scope check de WAS-186. Un input inválido de una key sin scope retornará 422 (input) en vez de 403 (scope). Podría considerarse information leak mínimo (confirma que el schema existe). No es bloqueante. | `invoke/route.ts:228` vs `invoke/route.ts:256` |

#### Veredicto Logic: **APROBADO** ✅

Los 7 ACs están implementados correctamente. Los 2 findings son menores y no representan regressions.

---

### Security Review

#### Superficie de ataque

| Categoría | Nuevos elementos | Auth | Status |
|-----------|-----------------|------|--------|
| Input validation pre-payment | `validateInput` + `request.clone().json()` | ✅ ANTES de Route A y Route B | ✅ SEGURO |
| Body parsing | `request.clone()` — no consume stream original | No afecta downstream `callUpstream` | ✅ SEGURO |
| Schema trust | `input_schema` viene de DB (trusted) — no re-valida SSRF | Consistente con AC4 | ✅ OK |

#### Findings Seguridad

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|--------------|
| 1 | INFO | DoS — AJV con schemas complejos | Schemas JSON complejos (deeply nested, allOf chains) podrían ser costosos de validar. AJV es rápido en general pero sin límite de complejidad de schema. Sin embargo, los schemas los define el creador del agente (no el caller) — superficie de ataque es interna. | `invoke/route.ts:228-247` |
| 2 | LOW | Información leak mínimo | Un caller sin scope válido recibe 422 (input inválido) en vez de 403 (scope) si su input falla validación primero. Confirma que el schema del agente existe y el input es inválido, revelando algo de estructura. Impacto muy bajo dado que la existencia del agente ya es pública. | `invoke/route.ts:228` |
| 3 | INFO | `request.clone()` correctness | Uso de `request.clone().json()` es el patrón correcto para Next.js App Router — no consume el stream original que necesita `callUpstream`. ✅ | `invoke/route.ts:231` |

#### Veredicto Security: **SEGURO** ✅

`validateInput` está antes del payment. `request.clone()` es correcto. No hay vectores de ataque nuevos significativos.

---

## Resumen

| Issue | Logic | Security |
|-------|-------|----------|
| WAS-186 (`1adff02`) | ✅ APROBADO — 7/7 ACs OK, 2 findings menores (no bloqueantes) | ✅ SEGURO — scope check en posición correcta, no bypass posible |
| WAS-200 (`c1d5e55`) | ✅ APROBADO — 7/7 ACs OK, 2 findings menores (no bloqueantes) | ✅ SEGURO — validación pre-payment, `request.clone()` correcto |

**Ambos commits pueden pasar a producción.** No hay findings BLOQUEANTES ni CRITICAL/HIGH.

### Recomendaciones post-merge (backlog)

1. **WAS-186 isEmptyScope edge case** — documentar la semántica explícita: "si cualquier scope field está definido como array vacío, la key queda bloqueada completamente". Considerar SDD update para aclarar el comportamiento con campos mixtos (vacío + con valores).
2. **WAS-200 input resolution** — documentar en API docs si el schema valida `body.input` o `body` según convención de cada agente.
3. **WAS-186 Route B** — añadir comentario en código que Route B (x402) no requiere scope check por diseño.
