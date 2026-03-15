# SDD #074: WAS-204 — Compose retry: persistir step outputs en grupos paralelos

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: bugfix/improvement
> SDD_MODE: bugfix
> Clasificación: HU-MINOR

---

## 1. Resumen del bug

`append_step_output` se llama solo en steps seriales (línea 662). En grupos paralelos (`Promise.allSettled`), los outputs exitosos nunca se persisten en `pipeline_executions.step_outputs`. Esto hace que el retry mode (`start_from_step`) no pueda recuperar outputs previos de steps paralelos — `retryLastOutput` queda `null` y el pipeline de retry arranca sin contexto.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 074 / WAS-204 |
| **Tipo** | bugfix |
| **Objetivo** | Persistir outputs de steps paralelos exitosos en `step_outputs` |
| **Scope IN** | Solo `compose/route.ts`: llamar `append_step_output` tras cada step paralelo exitoso |
| **Scope OUT** | No cambiar la lógica de retry, no cambiar `get_pipeline_for_retry`, no tocar UI |

---

## 3. Reproducción

### Repro steps
1. Lanzar compose con 3 steps paralelos (todos exitosos) → obtener `pipeline_id`
2. Relanzar con `pipeline_id` + `start_from_step: 1`
3. Observar que `retryLastOutput` es `null` — el step 1 nunca tuvo su output guardado

### Actual
Steps paralelos no llaman `append_step_output` → `step_outputs` queda `[]` → retry sin contexto

### Expected
Cada step paralelo exitoso llama `append_step_output` (best-effort, sin bloquear pipeline)

---

## 4. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/app/api/v1/compose/route.ts` | Contiene el bug | L662: `append_step_output` solo en serial; L694-720: paralelo con `Promise.allSettled` sin persist |
| `supabase/migrations/052_pipeline_step_outputs.sql` | RPC definition | `append_step_output(p_pipeline_id, p_step, p_output, p_agent_slug)` |

### Causa raíz

```
// Serial (línea ~655-670) — TIENE persist:
supabase.rpc('append_step_output', { p_pipeline_id, p_step, p_output, p_agent_slug }).then(...)
globalStepIndex++

// Paralelo (línea ~694-720) — NO TIENE persist:
const groupResults = await Promise.allSettled(group.map(async (step, i) => { ... }))
// → aquí se procesan resultados pero NUNCA se llama append_step_output
```

### Exemplar para el fix
| Fix en | Seguir patrón de |
|--------|------------------|
| Bloque paralelo en compose | Bloque serial (línea ~662-666) |

---

## 5. Fix propuesto

En el bloque `allSettled`, después de procesar cada resultado exitoso (`status === 'fulfilled'`), añadir llamada best-effort a `append_step_output` con el índice global correcto.

El índice debe calcularse como `groupStartIndex + i` donde `groupStartIndex` es el `globalStepIndex` al inicio del grupo.

---

## 6. Acceptance Criteria (EARS)

1. WHEN un grupo paralelo completa con ≥1 step exitoso, THE sistema SHALL llamar `append_step_output` por cada step exitoso (best-effort, no bloqueante).
2. WHEN se lanza retry con `start_from_step: N` sobre un pipeline con steps paralelos previos exitosos, THE `retryLastOutput` SHALL recuperar el último output del step `N-1`.
3. WHEN `append_step_output` falla (DB error), THE pipeline SHALL continuar sin error (fire-and-forget).

---

## 7. Constraint Directives

### PROHIBIDO
- NO hacer `await` en la llamada a `append_step_output` dentro del grupo paralelo (mantener best-effort)
- NO modificar la función RPC en Supabase
- NO cambiar el comportamiento del modo serial existente
- NO tocar lógica de cobro ni de receipts

---

## 8. Waves de Implementación

### Wave 0 — Pre-flight
- [ ] W0.1: Verificar `append_step_output` RPC existe en prod: `SELECT proname FROM pg_proc WHERE proname='append_step_output'`
- [ ] W0.2: Identificar el bloque `allSettled` exacto en compose (líneas ~694-730)

### Wave 1 — Fix
- [ ] W1.1: Añadir llamada `append_step_output` en el bloque paralelo tras cada fulfilled result

### Wave 2 — Verificación local
- [ ] W2.1: `npx tsc --noEmit` limpio
- [ ] W2.2: Test manual: pipeline 2 paralelos → obtener pipeline_id → inspeccionar `step_outputs` en DB → relanzar con retry → verificar contexto
