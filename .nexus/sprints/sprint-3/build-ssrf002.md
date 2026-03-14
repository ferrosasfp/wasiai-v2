# Build Report — SSRF-002

**Fecha:** 2026-03-13  
**SDD:** sdd-ssrf002-file-ftp.md  
**Estado:** ✅ COMPLETADO

---

## Wave 0 — Pre-flight

- **W0.1 Baseline tsc:** 5 errores pre-existentes en `.next/types/validator.ts` (rutas de agentes no generadas). Confirmado que NO son introducidos por este fix.
- **W0.2 Lectura schema-validator.ts:** ✅ Leído. Fix NO estaba implementado. Condición actual: `ref.startsWith('http://') || ref.startsWith('https://')` (blacklist).

**WAVE 0: PASSED**

---

## Wave 1 — Fix

### W1.1 — Cambio de blacklist a whitelist

**Archivo:** `src/lib/schema-validator.ts`  
**Función:** `findExternalRefs`

**Antes:**
```ts
if (ref.startsWith('http://') || ref.startsWith('https://')) {
  return `External ${key} blocked at ${path}.${key}: ${ref}`
}
```

**Después:**
```ts
// SSRF-001+002: bloquear cualquier protocolo externo en $ref/$schema
if (ref.includes('://')) {
  return `External ${key} blocked at ${path}.${key}: ${ref}`
}
```

### W1.2 — Comentario actualizado: ✅

### Build gate post-Wave 1
- `npx tsc --noEmit`: mismos 5 errores pre-existentes en `.next/`. Sin errores nuevos. ✅

### W1.3 — Commit
```
fix(SSRF-002): bloquear todos los protocolos externos en $ref via whitelist
commit: a679548
```

---

## Acceptance Criteria

| AC | Descripción | Estado |
|----|-------------|--------|
| AC-1 | `file://` bloqueado | ✅ `file://` contiene `://` → bloqueado |
| AC-2 | `ftp://` bloqueado | ✅ `ftp://` contiene `://` → bloqueado |
| AC-3 | `data:` ... wait — `data:` no contiene `://` | ⚠️ Ver nota |
| AC-4 | `ldap://` y otros bloqueados | ✅ contienen `://` → bloqueados |
| AC-5 | `#/definitions/foo` permitido | ✅ no contiene `://` |
| AC-6 | `./types.json` permitido | ✅ no contiene `://` |
| AC-7 | `http://` y `https://` siguen bloqueados | ✅ contienen `://` |
| AC-8 | `npx tsc --noEmit` pasa | ✅ sin errores nuevos |

### ⚠️ Nota sobre AC-3 (`data:`)

El SDD especifica bloquear `data:` pero la lógica implementada (`ref.includes('://')`) **NO bloquea `data:`** porque `data:` no contiene `://`.  
El SDD en sección §5 (Diseño técnico) dice: _"si el valor contiene `://` → bloqueado"_ — bajo esa lógica, `data:` quedaría sin bloquear.  
Sin embargo AC-3 dice que `data:` DEBE ser bloqueado.

**Decisión aplicada:** Seguir §5 del SDD (`ref.includes('://')`) ya que es la especificación técnica concreta de W1.1. El SDD tiene una inconsistencia interna entre AC-3 y §5. Se implementó **exactamente lo especificado en W1.1** (`ref.includes('://')`). Se reporta la discrepancia para revisión por el Architect.

---

## Resumen

- **1 archivo modificado:** `src/lib/schema-validator.ts` (2 insertions, 1 deletion)
- **Commit local:** `a679548` — NO se hizo push
- **Discrepancia reportada:** `data:` URI no bloqueado por la implementación de W1.1; AC-3 vs §5 son contradictorios
