# SDD #S6-A3: Exponer min_performance en GET /agents + NaN Guard

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: feature
> SDD_MODE: mini
> Branch: feat/s6-a3-min-performance-param

---

## 1. Resumen

`discoverAgent()` en `agent-discovery.ts` ya soporta `minPerformance` internamente (SELECT, filtro WHERE, interfaz `DiscoveredAgent`) pero `GET /api/v1/agents` no lee ese param del querystring — nunca se pasa. Este SDD expone `min_performance` como param público de la route y añade validación NaN antes de pasarlo a discoverAgent.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | S6-A3 |
| **Tipo** | feature |
| **Objetivo** | Leer `min_performance` del querystring en `GET /api/v1/agents`, validar, y pasar a `discoverAgent()` |
| **Scope IN** | `src/app/api/v1/agents/route.ts` — leer param + validar + pasar |
| **Scope OUT** | Cambios a `agent-discovery.ts`, cambios al schema del contrato, UI |

## 3. Context Map

### Exemplars

| Para modificar | Seguir patrón de |
|---------------|------------------|
| `agents/route.ts` validación | `min_reputation` que ya se lee y pasa en la misma route |

## 4. Archivos afectados

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `src/app/api/v1/agents/route.ts` | Modificar | Leer `min_performance`, validar, pasar a `discoverAgent` | Mismo patrón que `min_reputation` en la misma route |

## 5. Lógica de validación

```typescript
const minPerfRaw = searchParams.get('min_performance')
let minPerformance: number | undefined = undefined
if (minPerfRaw !== null) {
  const parsed = Number(minPerfRaw)
  if (isNaN(parsed) || parsed < 0 || parsed > 100) {
    return NextResponse.json(
      { error: 'invalid_parameter', field: 'min_performance', message: 'Must be a number between 0 and 100' },
      { status: 400 }
    )
  }
  minPerformance = parsed
}
// pasar minPerformance a discoverAgent({ ..., minPerformance })
```

## 6. Acceptance Criteria (EARS)

1. WHEN `GET /api/v1/agents?min_performance=80` is called, THE response SHALL only include agents with `performance_score >= 80`.
2. WHEN `GET /api/v1/agents?min_performance=abc` is called, THE system SHALL return HTTP 400 `{ error: 'invalid_parameter', field: 'min_performance' }`.
3. WHEN `GET /api/v1/agents?min_performance=101` is called, THE system SHALL return HTTP 400.
4. WHEN `GET /api/v1/agents` is called without `min_performance`, THE system SHALL return HTTP 200 (no regression).
5. WHEN `GET /api/v1/agents?min_performance=0` is called, THE system SHALL return all agents (0 = sin filtro efectivo).

## 7. Constraint Directives

### OBLIGATORIO seguir
- Seguir el patrón exacto de `min_reputation` en la misma route (misma lógica, mismo estilo)
- `discoverAgent` ya acepta `minPerformance?: number` — no modificar su firma

### PROHIBIDO
- NO modificar `agent-discovery.ts`
- NO añadir el param a ningún otro endpoint
- NO cambiar el nombre del param (debe ser `min_performance` con underscore)

---

*SDD generado por NexusAgil — MINI | Sprint 6*
