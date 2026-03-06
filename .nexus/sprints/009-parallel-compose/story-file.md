# Story File — 009 — WAS-20: Ejecución Paralela en Compose
**Agente destino:** Dev | **Fecha:** 2026-03-01 | **Modo:** QUALITY | **Branch:** `feat/009-parallel-compose`

> Dev lee SOLO este archivo. Sin SDD, sin HU original, sin contexto adicional.
> Si algo no está aquí → DETENER y preguntar al Architect.

---

## Goal
Agregar soporte de ejecución paralela en `POST /api/v1/compose` mediante el campo `parallel: boolean` en cada step. Steps consecutivos con `parallel: true` se ejecutan con `Promise.allSettled`.

---

## Acceptance Criteria

| # | Criterio | Verificable en |
|---|---|---|
| AC-1 | Steps consecutivos con `parallel: true` se ejecutan simultáneamente | compose/route.ts — agrupador |
| AC-2 | Fallo de un step paralelo no aborta los otros del grupo | Promise.allSettled + receipts |
| AC-3 | Si todos los steps del grupo fallan → pipeline abortado con `code: 'pipeline_failed'` | response body |
| AC-4 | Si ≥1 step tiene éxito y `pass_output: true` → siguiente step recibe array de resultados exitosos | lógica de pass_output |
| AC-5 | Costo total = suma de todos los steps (exitosos + fallidos que se cobraron) | total_cost_usdc |
| AC-6 | Receipt individual por cada step paralelo | receipts array |
| AC-7 | Rate limit se verifica antes del grupo, no dentro de allSettled | ratelimit check pre-loop |
| AC-8 | `groups_executed: number` en la respuesta | ComposeResponse |
| AC-9 | Step que supera `COMPOSE_STEP_TIMEOUT_MS` falla con `step_timeout` sin cobrar | timeout handler |
| AC-10 | `npm run build` limpio, 0 errores TypeScript | CI |

---

## Archivos a modificar

| Archivo | Cambio | Exemplar |
|---|---|---|
| `src/app/api/v1/compose/route.ts` | Agrupador de steps + Promise.allSettled + nuevo campo `parallel` | El mismo archivo — leer el loop `for...of` existente |

> **Solo 1 archivo.** No crear archivos nuevos.

---

## Integration Contract

### Request (sin cambio en endpoint)
```typescript
// ComposeStep — campo nuevo
interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
  parallel?:    boolean  // NUEVO — default: false
}
```

### Response (extensión)
```typescript
interface ComposeResponse {
  pipeline_id:     string
  steps_executed:  number
  groups_executed: number  // NUEVO — número de grupos ejecutados
  total_cost_usdc: string
  result:          unknown
  receipts:        StepReceipt[]  // sin cambio en StepReceipt
}
```

### Lógica de agrupación
```typescript
// Ejemplo de agrupación
// Input:  [A(seq), B(par), C(par), D(seq)]
// Grupos: [[A], [B,C], [D]]

function groupSteps(steps: ComposeStep[]): ComposeStep[][] {
  const groups: ComposeStep[][] = []
  let i = 0
  while (i < steps.length) {
    if (steps[i].parallel) {
      const group: ComposeStep[] = []
      while (i < steps.length && steps[i].parallel) {
        group.push(steps[i++])
      }
      groups.push(group)
    } else {
      groups.push([steps[i++]])
    }
  }
  return groups
}
```

### Comportamiento de pass_output en grupo paralelo
```typescript
// Si el grupo tiene pass_output en el último step:
// - Si ≥1 exitoso → siguiente step recibe array de resultados exitosos
// - Si todos fallaron → pipeline abortado, code: 'pipeline_failed'
```

---

## Constraint Directives

### REQUIRED
- `Promise.allSettled` — NUNCA `Promise.all`
- Rate limit check **antes** del `allSettled`, por cada step del grupo individualmente
- Receipt individual por cada step, incluso los fallidos
- `groups_executed` en toda respuesta exitosa
- TypeScript strict — sin `any`

### FORBIDDEN
- Modificar la interfaz `StepReceipt` — solo se extiende `ComposeResponse`
- `Promise.all` — un fallo no debe abortar el grupo
- Hardcodear timeouts — usar `COMPOSE_STEP_TIMEOUT_MS` env var

---

## Waves

### W0 — Serial (foundation)
1. Agregar `parallel?: boolean` a `ComposeStep`
2. Implementar `groupSteps()` helper dentro del archivo
3. Agregar `groups_executed` a `ComposeResponse`

### W1 — Core (puede ser paralelo internamente con allSettled)
4. Reemplazar loop `for...of` con loop sobre grupos
5. Grupos de 1 step → comportamiento secuencial existente (sin cambio)
6. Grupos de N steps → `Promise.allSettled`
7. Lógica de `pass_output` para grupos paralelos

### W2 — Validación
8. Verificar que rate limit se aplica pre-grupo
9. Verificar receipts individuales en grupos paralelos
10. `npm run build`

---

## Scope OUT
- UI visual de pipelines (WAS-38)
- Retry automático de steps fallidos
- Límite dinámico de paralelismo (MAX_STEPS=5 aplica al total de steps, no por grupo)

---

## Escalation Rule
Si algo no está especificado en este archivo → DETENER y preguntar al Architect. No asumir.
