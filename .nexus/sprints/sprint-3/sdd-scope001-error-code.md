# SDD #SCOPE-001: Fix error code en fallback_slug — scope_violation vs no_agent_match

> SPEC_APPROVED: no
> Fecha: 2026-03-13
> Tipo: bugfix
> SDD_MODE: mini
> Clasificación: HU-MINOR
> Branch: fix/scope001-error-code

---

## 1. Resumen

Cuando un step usa `capability` + `fallback_slug` y el fallback está fuera del scope de la key, el sistema retorna `no_agent_match`. El AC promete `scope_violation`. Son semánticamente distintos: `no_agent_match` significa "no encontré ningún agente", `scope_violation` significa "encontré el agente pero tu key no tiene acceso". El fix es cambiar el error code en el path correcto.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | SCOPE-001 |
| **Tipo** | bugfix |
| **Objetivo** | Error code preciso cuando fallback_slug está fuera de scope |
| **Scope IN** | `compose/route.ts` — bloque de resolución de capability con fallback |
| **Scope OUT** | Lógica de scope check, discovery, otros endpoints |

### Acceptance Criteria (EARS)

- **AC-1:** WHEN a step has `capability` + `fallback_slug` AND `fallback_slug` is resolved but out of scope, THEN compose SHALL return `scope_violation` (not `no_agent_match`)
- **AC-2:** WHEN a step has `capability` only (no fallback) and no agent matches, THEN compose SHALL still return `no_agent_match`
- **AC-3:** WHEN fix applied, THEN `npx tsc --noEmit` SHALL pass

---

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/app/api/v1/compose/route.ts` líneas 290-315 | Bloque fallback_slug | Retorna `no_agent_match` en todos los casos — hay que distinguir fallback out-of-scope |

---

## 4. Archivos afectados

| Archivo | Acción | Qué cambia |
|---------|--------|-----------|
| `src/app/api/v1/compose/route.ts` | Modificar | Añadir variable `fallbackFoundButOutOfScope` antes del return final |

---

## 5. Diseño técnico

Actualmente el bloque de fallback:
```
if (fbAgent && isAgentInScope(...)) {
  // resuelto ✅
  continue
}
// cae al no_agent_match general
```

Fix: rastrear si `fbAgent` existía pero falló el scope check. IMPORTANTE: declarar `fallbackOutOfScope` DENTRO del bloque de resolución del step (no fuera del loop for) para evitar contaminación entre iteraciones:
```
let fallbackOutOfScope = false  // dentro del bloque if (!discovered) { ... }  // declarar DENTRO del bloque del step, no fuera del loop
if (fbAgent) {
  if (isAgentInScope(...)) { continue }
  else { fallbackOutOfScope = true }
}
// en el return: code = fallbackOutOfScope ? 'scope_violation' : 'no_agent_match'
```

---

## 6. Waves

### Wave 0 — Pre-flight
- [ ] W0.1: `npx tsc --noEmit` baseline
- [ ] W0.2: Leer bloque de resolución capability en `compose/route.ts` (líneas ~270-320)

### Wave 1 — Fix
- [ ] W1.1: Añadir `let fallbackOutOfScope = false  // declarar DENTRO del bloque del step, no fuera del loop` antes del bloque fallback
- [ ] W1.2: En el `else` del `isAgentInScope` check → `fallbackOutOfScope = true`
- [ ] W1.3: En el return final → `code: fallbackOutOfScope ? 'scope_violation' : 'no_agent_match'`
- [ ] Build gate: `npx tsc --noEmit` ✅
- [ ] W1.4: Commit `fix(SCOPE-001): error code scope_violation cuando fallback_slug fuera de scope`

---

## 7. Constraint Directives

### PROHIBIDO
- NO cambiar la lógica de scope check (`isAgentInScope`)
- NO tocar `agent-discovery.ts`
- NO modificar otros error codes existentes
- NO hacer `git push`
