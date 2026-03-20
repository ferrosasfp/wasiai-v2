## Logic Audit — WAS-251 (commit `7473eba7b`)

**Archivo auditado:** `src/app/api/v1/onboard/step/route.ts`  
**Fecha:** 2026-03-19  
**Auditor:** San (subagent)

---

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|--------------|---------------|--------|
| AC-01: `answer: "defi"` en paso 4 → HTTP 200 | ✅ Sí | `route.ts:93-105` | PASS — Query a `agent_categories` con `serviceClient`, valida con `validSlugs.includes(answer)` |
| AC-02: `answer: "defi-risk"` → HTTP 200 | ✅ Sí | `route.ts:93-105` | PASS — Misma lógica dinámica que AC-01 |
| AC-03: `answer: "invalid-cat"` → HTTP 400 | ✅ Sí | `route.ts:100-104` | PASS — Error message usa `validSlugs.join(', ')` de DB |
| AC-04: Nueva categoría en DB → disponible sin deploy | ✅ Sí | `route.ts:95-98` | PASS — Query lee de DB en cada request, no hay cache hardcodeado |
| AC-05: Build sin errores | ✅ Sí | Build output | PASS — `npm run build` exitoso, exit code 0 |

**Cambios detectados en el diff:**
- ✅ Eliminado: `VALID_CATEGORIES` constant (línea 19 del código anterior)
- ✅ Eliminado: `type Category` (línea 20 del código anterior)
- ✅ Hint actualizado: de `'One of: nlp, vision...'` a `'e.g. defi, nlp, vision...'`
- ✅ Validación reemplazada: de `VALID_CATEGORIES.includes(answer)` a `validSlugs.includes(answer)`
- ✅ Mensaje de error dinámico: usa `validSlugs.join(', ')` en lugar de `VALID_CATEGORIES.join(', ')`
- ✅ Type assertion eliminada: `data.category = answer` (antes `answer as Category`)

---

### Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| **F1** | 🔴 **ALTA** | **No hay error handling para fallo del query a DB.** Si `serviceClient.from('agent_categories').select(...)` falla (DB down, timeout, permisos), la variable `cats` será `undefined` (no `null`). El código hace `(cats ?? []).map(...)` lo cual resulta en `validSlugs = []`. **Consecuencia:** Cualquier respuesta del usuario será rechazada con HTTP 400 (`Category must be one of: `), sin indicar que el problema es del servidor. **Debe retornar HTTP 503 o 500 cuando el query falle explícitamente.** | `route.ts:95-99` |
| **F2** | 🟡 **MEDIA** | **Caso edge: tabla vacía de categorías.** Si la tabla `agent_categories` existe pero no tiene registros con `is_active = true`, el wizard se vuelve imposible de completar (todos los inputs fallan en step 4). **Debe validar `validSlugs.length === 0` y retornar HTTP 500 con mensaje claro:** `"No active categories available. Please contact support."` | `route.ts:99-104` |
| **F3** | 🟢 **BAJA** | **Hint de step 4 aún muestra ejemplos hardcodeados.** El hint dice `'e.g. defi, nlp, vision, code, data, security'`, lo cual puede confundir si esas categorías no están activas en DB. **Sugerencia:** Cambiar a `'Enter one of the available categories'` o hacer hint dinámico si es crítico para UX. | `route.ts:13` |

---

### Análisis de corrección lógica

#### ¿Step 4 hace query a `agent_categories` con `serviceClient`?
✅ **Sí.** Línea 95-98:
```typescript
const { data: cats } = await serviceClient
  .from('agent_categories')
  .select('slug')
  .eq('is_active', true)
```

#### ¿Filtra por `is_active = true`?
✅ **Sí.** Línea 98: `.eq('is_active', true)`

#### ¿La validación usa `validSlugs.includes(answer)`?
✅ **Sí.** Línea 100: `if (!validSlugs.includes(answer))`

#### ¿El error message usa los slugs de DB (no hardcodeados)?
✅ **Sí.** Línea 101-104:
```typescript
return NextResponse.json(
  { error: `Category must be one of: ${validSlugs.join(', ')}` },
  { status: 400 },
)
```

#### ¿Qué pasa si el query a `agent_categories` falla (DB error)?
❌ **Bug detectado (F1).** El destructuring `const { data: cats } = await ...` NO captura el `error` property. Si el query falla:
- `cats` será `undefined`
- `(cats ?? [])` retorna `[]`
- `validSlugs = []`
- **Cualquier respuesta del usuario será rechazada con 400**, sin indicar que el problema es del servidor.

**Fix requerido:**
```typescript
const { data: cats, error: dbError } = await serviceClient
  .from('agent_categories')
  .select('slug')
  .eq('is_active', true)

if (dbError) {
  console.error('[onboard/step4] DB query failed', dbError)
  return NextResponse.json(
    { error: 'Unable to load categories. Please try again later.' },
    { status: 503 }
  )
}
```

#### ¿`validSlugs` puede ser empty si la tabla está vacía?
⚠️ **Sí, posible (F2).** Si `agent_categories` tiene 0 filas activas, `validSlugs = []`. El wizard se vuelve imposible de completar.

**Fix requerido:**
```typescript
const validSlugs = (cats ?? []).map((c) => c.slug)
if (validSlugs.length === 0) {
  return NextResponse.json(
    { error: 'No active categories available. Please contact support.' },
    { status: 500 }
  )
}
```

#### ¿Se eliminó completamente `VALID_CATEGORIES` y el tipo `Category`?
✅ **Sí.** Confirmado en el diff:
- Línea 19-20 del código anterior: borradas
- No aparecen en ninguna otra parte del archivo

#### ¿El hint del step 4 ya no lista categorías hardcodeadas?
⚠️ **Parcialmente.** El hint ahora dice `'e.g. defi, nlp, vision, code, data, security'` (línea 13), usando `e.g.` en lugar de `One of:`. Sigue siendo hardcodeado, pero al menos ya no implica una lista exhaustiva. **Podría mejorarse** (F3).

---

### Scope creep

#### ¿Se tocaron pasos distintos al 4?
✅ **No.** Solo se modificó el `case 4:` block. Los demás pasos permanecen intactos.

#### ¿Se tocaron imports innecesarios?
✅ **No.** No se agregaron imports. Todos los imports existentes son necesarios para el funcionamiento del archivo.

---

### Build

```bash
$ npm run build
✓ Compiled successfully in 4.7s
Process exited with code 0.
```

✅ **Sin errores de TypeScript.** La eliminación del tipo `Category` no causó errores de compilación.

---

### Veredicto: **REQUIERE CORRECCIÓN** 🔴

**Razón:**  
El finding **F1** es crítico. Si la DB está caída o el query falla, el wizard rechaza silenciosamente todas las categorías con HTTP 400, haciendo parecer que el input del usuario es inválido. Esto viola el principio de "fail loudly" en servicios críticos.

**Acción requerida:**
1. Agregar validación de `dbError` en el query a `agent_categories` (F1)
2. Agregar validación de `validSlugs.length === 0` (F2)
3. Opcional: mejorar hint de step 4 para evitar confusión (F3)

**Una vez corregidos F1 y F2, el código cumplirá todos los ACs especificados.**

---

**Firma:**  
San ⚡ — Logic Auditor, subagent:462b56de  
Commit auditado: `7473eba7b168dac55d68fe8330c09fa31150541a`
