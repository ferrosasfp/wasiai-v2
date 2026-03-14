# SDD #SSRF-002: Bloquear file:// y ftp:// en $ref de schemas

> SPEC_APPROVED: no
> Fecha: 2026-03-13
> Tipo: bugfix / security
> SDD_MODE: mini
> Clasificación: QUALITY
> Branch: fix/ssrf002-block-file-ftp-refs

---

## 1. Resumen

Sprint 2 bloqueó `$ref` y `$schema` con URLs `http://` y `https://`. Quedan sin bloquear `file://`, `ftp://`, `data:`, y otros protocolos peligrosos. AJV no resuelve `file://` actualmente, pero es mejor bloquear explícitamente con whitelist en lugar de blacklist para no depender del comportamiento interno de AJV.

El fix cambia la lógica de `findExternalRefs` de blacklist de protocolos a **whitelist**: solo se permiten `$ref` que sean fragmentos internos (`#/...`) o paths relativos. Todo lo demás queda bloqueado.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | SSRF-002 |
| **Tipo** | bugfix / security |
| **Objetivo** | Que ningún protocolo externo en $ref/\$schema pueda ser usado como vector SSRF |
| **Scope IN** | `src/lib/schema-validator.ts` — función `findExternalRefs` |
| **Scope OUT** | Endpoints, UI, migraciones, compose, sandbox |

### Acceptance Criteria (EARS)

- **AC-1:** WHEN `$ref` contains `file://`, THEN `metaValidateSchema` SHALL return `schema_ssrf_blocked`
- **AC-2:** WHEN `$ref` contains `ftp://`, THEN `metaValidateSchema` SHALL return `schema_ssrf_blocked`
- **AC-3:** WHEN `$ref` contains `data:`, THEN `metaValidateSchema` SHALL return `schema_ssrf_blocked`
- **AC-4:** WHEN `$ref` contains `ldap://` or any protocol not whitelisted, THEN `metaValidateSchema` SHALL return `schema_ssrf_blocked`
- **AC-5:** WHEN `$ref` is an internal fragment (`#/definitions/foo`), THEN `metaValidateSchema` SHALL NOT block it
- **AC-6:** WHEN `$ref` is a relative path (`./types.json`), THEN `metaValidateSchema` SHALL NOT block it (AJV no lo resuelve pero es válido en schema estático)
- **AC-7:** WHEN `http://` or `https://` $ref is present, THEN existing behavior (blocked) SHALL be preserved
- **AC-8:** WHEN fix is applied, THEN `npx tsc --noEmit` SHALL pass

---

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/lib/schema-validator.ts` | Función a modificar | `findExternalRefs` usa `startsWith('http://')` blacklist — cambiar a whitelist |

### Exemplar
| Para modificar | Seguir patrón de |
|---------------|-----------------|
| `findExternalRefs` en `schema-validator.ts` | La función misma — misma estructura recursiva, cambiar solo la condición de bloqueo |

---

## 4. Archivos afectados

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `src/lib/schema-validator.ts` | Modificar | `findExternalRefs`: cambiar blacklist a whitelist | Función misma |

---

## 5. Diseño técnico

**Lógica whitelist:**
```
// Solo son seguros:
// - Fragmento interno: empieza con "#"
// - Path relativo: empieza con "./" o "../" o no tiene "://"
// Todo lo que contenga "://" y no sea relativo está bloqueado
```

La condición de bloqueo: si el valor contiene `://` → bloqueado. Si empieza con `#` → permitido. Si es path relativo (no contiene `://`) → permitido.

---

## 6. Waves

### Wave 0 — Pre-flight
- [ ] W0.1: `npx tsc --noEmit` baseline
- [ ] W0.2: Leer `schema-validator.ts` completo

### Wave 1 — Fix
- [ ] W1.1: En `findExternalRefs`, cambiar condición de `ref.startsWith('http://')` a `ref.includes('://')` — bloquea todos los protocolos
- [ ] W1.2: Actualizar comentario: `// SSRF-001+002: bloquear cualquier protocolo externo en $ref/$schema`
- [ ] Build gate: `npx tsc --noEmit` ✅
- [ ] W1.3: Commit `fix(SSRF-002): bloquear todos los protocolos externos en $ref via whitelist`

---

## 7. Constraint Directives

### OBLIGATORIO
- Mantener la recursión existente — no reescribir la función
- Mantener compatibilidad con `#/...` (fragmentos internos)

### PROHIBIDO
- NO tocar `validateInput` — solo `findExternalRefs` y `metaValidateSchema`
- NO agregar dependencias
- NO cambiar la firma de `metaValidateSchema` ni `validateInput`
- NO hacer `git push`

---

## 8. Rollback

`git revert` del commit. La diferencia es 1 línea de condición.
