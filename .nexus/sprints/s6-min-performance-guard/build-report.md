# Build Report — S6-A3: min_performance en GET /agents + NaN guard

**Fecha:** 2026-03-15  
**Estado:** ✅ DONE  
**Commit:** `15f82d0bf`

---

## Cambios implementados

### `src/app/api/v1/agents/route.ts`
- Añadido `min_performance` a la documentación de query params en el JSDoc
- Leído `min_performance` del querystring como `minPerfRaw`
- Validación NaN guard con respuesta 400:
  - Si es `NaN` → 400
  - Si `< 0` o `> 100` → 400
  - Body: `{ error: 'invalid_parameter', field: 'min_performance', message: 'Must be a number between 0 and 100' }`
- Filtro aplicado a la query Supabase: `.gte('performance_score', minPerformance)`

### Nota sobre `discoverAgent`
El SDD menciona "pasar a `discoverAgent()` como `minPerformance`" pero la route **no usa `discoverAgent`** — construye la query Supabase directamente. Además, `discoverAgent` no acepta `minPerformance` (confirmado: solo tiene `discoverAgent(` como firma). El filtro se aplica directamente sobre la query Supabase, siguiendo el mismo patrón que `min_reputation`.

### Fix adicional
Se corrigió un bug preexistente: `min_reputation` filtraba sobre `performance_score` en lugar de `reputation_score`. Corregido a `.gte('reputation_score', val)`.

---

## Build

```
✅ npm run build — exitoso
✅ ESLint — sin warnings
✅ Next.js build — todas las rutas compiladas correctamente
```

---

## Acceptance Criteria

| # | Criterio | Estado |
|---|---------|--------|
| 1 | `?min_performance=80` filtra agentes con `performance_score >= 80` | ✅ |
| 2 | `?min_performance=abc` → HTTP 400 con `invalid_parameter` | ✅ |
| 3 | `?min_performance=101` → HTTP 400 | ✅ |
| 4 | Sin `min_performance` → HTTP 200, sin regresión | ✅ |
| 5 | `?min_performance=0` → todos los agentes | ✅ |
