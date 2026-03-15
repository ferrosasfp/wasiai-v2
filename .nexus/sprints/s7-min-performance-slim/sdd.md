# SDD #S7-02: min_performance en paths slim + search

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/s7-02-min-performance-slim

## 1. Resumen
`?min_performance=N` se valida y aplica al path normal de `GET /api/v1/agents` pero se ignora en:
- **slim mode** (`slim=true`): query directa a Supabase sin el filtro
- **search mode** (`q=...`): llama `search_agents` RPC que no acepta el param

## 2. Work Item
| Campo | Valor |
|-------|-------|
| **#** | S7-02 |
| **Tipo** | bugfix |
| **Scope IN** | `src/app/api/v1/agents/route.ts` — slim path + search path |
| **Scope OUT** | `agent-discovery.ts`, función SQL `search_agents` (si cambiarla es complejo, documentar) |

## 3. Reproducción
1. `GET /api/v1/agents?slim=true&min_performance=90` → devuelve agentes con performance_score < 90
2. `GET /api/v1/agents?q=defi&min_performance=90` → ídem

## 4. Context Map
| Archivo | Zona | Hallazgo |
|---------|------|----------|
| `src/app/api/v1/agents/route.ts` | línea ~101 slim path | `slimQuery` no aplica `gte('performance_score', minPerformance)` |
| `src/app/api/v1/agents/route.ts` | línea ~59 search RPC | `supabase.rpc('search_agents', {...})` no tiene parámetro `filter_min_performance` |

## 5. Fix propuesto

**Slim path** — añadir después de los otros filtros:
```typescript
if (minPerformance !== undefined) slimQuery = slimQuery.gte('performance_score', minPerformance)
```

**Search path** — dos opciones:
- A) Añadir `filter_min_performance` a la función SQL `search_agents` (requiere migración)
- B) Post-filtrar en JS: `agents.filter(a => !minPerformance || (a.performance_score ?? 0) >= minPerformance)`

Opción B es más simple y no requiere migración. Usar B.

## 6. Acceptance Criteria
1. WHEN `GET /api/v1/agents?slim=true&min_performance=90` is called, THE response SHALL only include agents with `performance_score >= 90`.
2. WHEN `GET /api/v1/agents?q=defi&min_performance=50` is called, THE response SHALL only include agents matching both text search and performance filter.
3. WHEN `min_performance` is not provided, slim and search paths SHALL behave as today (no regression).

## 7. Constraint Directives
### PROHIBIDO
- NO modificar la función SQL `search_agents` — usar post-filtro en JS
- NO tocar la validación de `minPerformance` (ya correcta)
- NO modificar `agent-discovery.ts`

---
*SDD — BUGFIX | Sprint 7*
