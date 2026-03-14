# Build Report — SCOPE-001

**Fecha:** 2026-03-13  
**Scope:** fix(SCOPE-001) — error code `scope_violation` cuando `fallback_slug` fuera de scope  
**Branch:** main  
**Commit:** `fe4a148`

---

## Tabla de Waves

| Wave | Tarea | Estado | Notas |
|------|-------|--------|-------|
| W0.1 | Baseline `npx tsc --noEmit` | ✅ | Errores pre-existentes solo en `.next/types/validator.ts` (archivos generados, fuera de scope) |
| W0.2 | Leer bloque capability en `compose/route.ts` líneas ~270-320 | ✅ | Bug confirmado: `if (fbAgent && isAgentInScope(...))` no distingue "out of scope" de "not found" |
| W1.1 | Añadir `let fallbackOutOfScope = false` dentro del bloque `if (!discovered)` | ✅ | Declarado DENTRO del bloque del step para evitar contaminación entre iteraciones |
| W1.2 | Separar `if (fbAgent)` con `else { fallbackOutOfScope = true }` en el check de scope | ✅ | |
| W1.3 | Return con `code: fallbackOutOfScope ? 'scope_violation' : 'no_agent_match'` | ✅ | |
| Build gate | `npx tsc --noEmit` post-fix | ✅ | Sin errores en source files; solo errores pre-existentes en `.next/types` |
| W1.4 | Commit local | ✅ | Hash: `fe4a148` |

---

## Archivos Cambiados

| Archivo | Acción | Líneas |
|---------|--------|--------|
| `src/app/api/v1/compose/route.ts` | Modificado | +10 / -5 |

---

## Discrepancias

Ninguna. El SDD asumía correctamente el estado del código. El bloque `if (fbAgent && isAgentInScope(...)) { continue }` existía exactamente como fue descrito.

---

## Diff resumen

**Antes:**
```ts
if (fbAgent && isAgentInScope(fbAgent.slug, fbAgent.category, keyRow.allowed_slugs, keyRow.allowed_categories)) {
  steps[i] = { ...step, agent_slug: step.fallback_slug }
  resolvedSlugs.set(i, step.fallback_slug)
  continue
}
// cae a no_agent_match siempre
return NextResponse.json(
  { error: `...`, code: 'no_agent_match', step: i },
  { status: 422 }
)
```

**Después:**
```ts
let fallbackOutOfScope = false // declarar DENTRO del bloque del step, no fuera del loop
if (fbAgent) {
  if (isAgentInScope(...)) {
    steps[i] = { ...step, agent_slug: step.fallback_slug }
    resolvedSlugs.set(i, step.fallback_slug)
    continue
  } else {
    fallbackOutOfScope = true
  }
}
return NextResponse.json(
  { error: `...`, code: fallbackOutOfScope ? 'scope_violation' : 'no_agent_match', step: i },
  { status: 422 }
)
```

---

## AC Verification

| AC | Criterio | Estado |
|----|----------|--------|
| AC-1 | fallback_slug resuelto pero fuera de scope → `scope_violation` | ✅ implementado |
| AC-2 | capability sin fallback, sin match → `no_agent_match` | ✅ no afectado (path no cambia cuando `step.fallback_slug` es undefined) |
| AC-3 | `npx tsc --noEmit` pasa | ✅ sin errores en source files |
