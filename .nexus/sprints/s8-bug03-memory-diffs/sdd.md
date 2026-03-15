# SDD #076: BUG-03 — introspect memory_diffs filter hardcoded keys

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: bugfix
> SDD_MODE: bugfix
> Clasificación: FAST-FIX

---

## 1. Resumen del bug

En `buildCOB.ts`, el filtro de `memory_diffs` descarta todas las entradas que no tengan clave `'delta'` o `'diff'`. Si el agente upstream devuelve diffs con otros keys (ej: `'change'`, `'update'`, `'patch'`), son silenciosamente eliminados. El comportamiento correcto es tomar los primeros N diffs sin filtrar por keys.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 076 |
| **Tipo** | bugfix |
| **Objetivo** | Eliminar el filtro por keys y limitar memory_diffs por count |
| **Scope IN** | Solo `src/lib/introspect/buildCOB.ts` líneas ~57-65 |
| **Scope OUT** | No cambiar la interfaz de COB, no cambiar signing, no tocar el endpoint |

---

## 3. Reproducción

### Repro steps
1. Agente upstream devuelve `memory_diffs: [{ "change": "...", "key": "x" }]`
2. `buildCOB` filtra por `'delta' in e || 'diff' in e` → array vacío
3. COB retorna `memory_diffs: []` aunque upstream tenía diffs

### Actual
```typescript
.filter((e) => typeof e === 'object' && e !== null && ('delta' in e || 'diff' in e))
.slice(0, opts.depth === 'mid' ? 20 : 10)
```

### Expected
```typescript
.slice(0, opts.depth === 'mid' ? 20 : 10)
// Sin filter — cualquier objeto es válido
```

---

## 4. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/lib/introspect/buildCOB.ts` | Contiene el bug | L57-65: filter hardcoded + slice |

### Exemplar para el fix
El fix es eliminar el `.filter()`, dejando solo `.slice()` con el mismo límite.

---

## 5. Acceptance Criteria (EARS)

1. WHEN upstream devuelve `memory_diffs` con objetos sin keys `'delta'`/`'diff'`, THE COB SHALL incluirlos (hasta el límite por profundidad).
2. WHEN upstream devuelve >20 diffs en modo `mid`, THE COB SHALL incluir exactamente 20.
3. WHEN upstream devuelve >10 diffs en modo `shallow`, THE COB SHALL incluir exactamente 10.
4. WHEN depth es `full`, THE COB SHALL incluir todos los diffs sin límite (comportamiento intencional — full = datos completos).

---

## 6. Constraint Directives

### PROHIBIDO
- NO cambiar los límites de slice (10/20)
- NO tocar `signCOB`, `assembleCOB`, ni el endpoint
- NO hacer refactor del archivo completo

---

## 7. Wave única

- [ ] W1: Eliminar línea `.filter()` en `buildCOB.ts`
- [ ] W2: `npx tsc --noEmit` limpio
