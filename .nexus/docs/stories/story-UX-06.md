# Story: UX-06 — Gráfica de llamadas por día en dashboard creator

**Estado:** `READY FOR DEV`  
**Fecha:** 2026-02-27  
**Generado por:** SM Agent (BMAD Method v6)  
**Epic:** UX — Dashboard Creator  
**Estimado Dev:** ~2h (infraestructura ya existe; trabajo es hardening + migration)

---

## Contexto rápido

El dashboard del creator necesita mostrar una gráfica de barras con el número de llamadas por día en los últimos 30 días. **La mayor parte de la infraestructura ya fue implementada en Sprint 2 (HU-1.4).** Este story cubre el trabajo pendiente: migration DB, verificación de ACs y hardening.

---

## Trabajo pendiente (resumen ejecutivo)

| # | Tarea | Estimado |
|---|-------|----------|
| 1 | Crear y aplicar migration `019` (índice DB) | ~10 min |
| 2 | Verificar responsive en 375px, 768px, 1280px | ~20 min |
| 3 | Confirmar que `status: 'error'` renderiza fallback visible (no pantalla en blanco) | ~15 min |
| 4 | Test manual de RLS con 2 cuentas de creator | ~20 min |
| 5 | Agregar test unitario de `buildDailySeries()` si no existe | ~30 min |

---

## Archivos relevantes

| Path | Estado | Acción |
|------|--------|--------|
| `supabase/migrations/019_agent_calls_analytics_index.sql` | ❌ No existe | **CREAR** (ver §2) |
| `src/features/creator/components/analytics/CallsChart.tsx` | ✅ Existe | Verificar responsive + error fallback |
| `src/features/creator/components/CreatorAnalytics.tsx` | ✅ Existe | Verificar error state visible |
| `src/app/api/creator/analytics/route.ts` | ✅ Existe | Verificar filtro por `agent_id` |
| `src/app/[locale]/creator/dashboard/page.tsx` | ✅ Existe | No modificar — `<CreatorAnalytics>` ya integrado |
| `__tests__/creator/analytics/buildDailySeries.test.ts` | ⚠️ No confirmado | Crear si no existe |

---

## 1. Criterios de Aceptación (ACs)

| # | Criterio | Cómo verificar |
|---|----------|----------------|
| AC-1 | La gráfica muestra los últimos 30 días calendario, incluyendo días con 0 llamadas (siempre 30 barras) | Visual — cuenta barras en dashboard |
| AC-2 | El eje X muestra fechas legibles (ej. "02-01", "02-15", fecha actual) | Visual |
| AC-3 | El eje Y es implícito — altura de barras es proporcional al máximo; no se muestran decimales ni valores negativos | Visual |
| AC-4 | Los datos vienen de Supabase (`agent_calls`) — **cero mock data** | Revisar código: sin arrays hardcodeados |
| AC-5 | Si el creator tiene múltiples agentes, la gráfica filtra por el `agent_id` del agente en vista | Test: creator con 2+ agentes |
| AC-6 | Si todos los días tienen `calls = 0`, se muestra un mensaje de empty state claro (no barras vacías silenciosas) | Test: agente nuevo sin llamadas |
| AC-7 | La gráfica es responsive y se ve correctamente en 375px, 768px y 1280px sin overflow ni truncado | Chrome DevTools — toggle device |
| AC-8 | RLS activo — creator A no puede ver datos de creator B en ningún escenario | Test manual con 2 cuentas en staging |
| AC-9 | Mientras se cargan los datos, se muestra un skeleton o loading indicator (no pantalla en blanco) | Throttle red en DevTools → "Slow 3G" |
| AC-10 | Si el API route falla (simular 500), el dashboard no muestra pantalla en blanco — hay un fallback de error visible | Simular error en el handler → ver UI |

---

## 2. Migration SQL — `019_agent_calls_analytics_index.sql`

**Ruta:** `supabase/migrations/019_agent_calls_analytics_index.sql`

> ⚠️ Antes de crear el archivo, confirmar que no existe `019` ya con:
> ```bash
> ls supabase/migrations/ | grep "^019"
> ```
> Si ya existe un `019`, usar `020`. (Al momento de generar este story: migrations 000–018 aplicadas, próxima = 019 ✅)

```sql
-- Migration 019: Índice para analytics de llamadas por día
-- Historia: UX-06 — Gráfica de llamadas por día en dashboard creator
-- Impacto: Mejora performance de la query en GET /api/creator/analytics
--   Antes: Seq scan sobre agent_calls filtrando por agent_id y called_at
--   Después: Index scan con idx_agent_calls_agent_called_at

CREATE INDEX IF NOT EXISTS idx_agent_calls_agent_called_at
  ON agent_calls (agent_id, called_at DESC);

-- Notas:
-- 1. El índice cubre la query: WHERE agent_id = ANY($1) AND called_at >= $2
-- 2. DESC en called_at optimiza el ORDER BY más común (más reciente primero)
-- 3. El planner usará este índice con el filtro de rango de fecha en analytics
-- 4. No se usa índice parcial con fecha fija porque NOW() no es inmutable en Postgres
```

**Cómo aplicar (local):**
```bash
npx supabase db push
# o bien
npx supabase migration up
```

**Verificar que se aplicó:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'agent_calls'
  AND indexname = 'idx_agent_calls_agent_called_at';
```

---

## 3. Query SQL — llamadas por día (últimos 30 días)

### Implementación actual (JS-side grouping — funcional para MVP)

El API route en `src/app/api/creator/analytics/route.ts` actualmente:
1. Trae todos los `called_at` de los últimos 30 días de `agent_calls`
2. Hace group-by en memoria con `buildDailySeries()`
3. Rellena días faltantes con `calls = 0`

Esta implementación es correcta y suficiente para el volumen actual.

### Query SQL equivalente (referencia — para migrar a server-side cuando escale)

```sql
-- Uso: pasar :agent_ids como array de UUIDs
WITH date_series AS (
  SELECT generate_series(
    CURRENT_DATE - INTERVAL '29 days',
    CURRENT_DATE,
    INTERVAL '1 day'
  )::date AS day
),
daily_counts AS (
  SELECT
    DATE(called_at AT TIME ZONE 'UTC') AS day,
    COUNT(*) AS calls
  FROM agent_calls
  WHERE
    agent_id = ANY(:agent_ids)        -- array de UUIDs del creator
    AND called_at >= NOW() - INTERVAL '30 days'
    AND (is_trial = false OR is_trial IS NULL)  -- excluir trials si aplica
  GROUP BY DATE(called_at AT TIME ZONE 'UTC')
)
SELECT
  ds.day::text AS date,               -- formato 'YYYY-MM-DD'
  COALESCE(dc.calls, 0)::int AS calls -- 0 si no hubo llamadas ese día
FROM date_series ds
LEFT JOIN daily_counts dc ON ds.day = dc.day
ORDER BY ds.day ASC;
-- Resultado: siempre exactamente 30 filas
```

**Parámetros:**
- `:agent_ids` — array de UUIDs. Puede ser `[agentId]` para un agente específico, o todos los agentes del creator
- Zona horaria: **UTC** (consistente con `called_at` en DB)

---

## 4. Interface TypeScript — `CallsChart`

El componente ya existe en `src/features/creator/components/analytics/CallsChart.tsx`.  
Esta es la interface esperada (verificar que coincide con el archivo actual):

```typescript
// Tipos de datos
export interface DayData {
  /** Fecha ISO: 'YYYY-MM-DD' */
  date: string
  /** Llamadas ese día. 0 si no hubo. Siempre entero >= 0 */
  calls: number
}

export interface CallsChartProps {
  /** Serie completa de 30 días, incluyendo días con calls = 0.
   *  Siempre llega ordenada ASC por fecha (día más antiguo primero). */
  series: DayData[]
}

// Comportamiento esperado del componente:
//
// EMPTY STATE (AC-6):
//   if (series.every(d => d.calls === 0)) → renderizar mensaje vacío
//   Ejemplo: "Tu agente no ha recibido llamadas en los últimos 30 días."
//
// LOADING STATE (AC-9):
//   El estado 'loading' se maneja en el wrapper CreatorAnalytics, no aquí.
//   CallsChart solo renderiza cuando ya tiene `series`.
//
// BARRAS CSS (ADR-010):
//   - Sin recharts, sin chart.js — barras con flex + height proporcional
//   - Altura de cada barra = (calls / maxCalls) * 100% del contenedor
//   - Color: bg-[#E84142] (avax-500) opacity-80, hover:opacity-100
//   - Contenedor: h-24 (96px) mínimo
//
// EJE X (AC-2):
//   - Mostrar labels en posición 0 (día más antiguo), mid (~día 15), last (hoy)
//   - Formato: 'MM-DD' (ej. "01-15", "02-01")
//
// RESPONSIVE (AC-7):
//   - flex-wrap: NO — las barras deben comprimir su ancho, no saltar a siguiente línea
//   - min-width de cada barra: 2px para que no desaparezcan en 375px
//   - Overflow: hidden en el contenedor (no scroll horizontal)
```

---

## 5. Posición en el dashboard

**Ya integrado correctamente.** No modificar `page.tsx`.

Orden actual de secciones en `src/app/[locale]/creator/dashboard/page.tsx`:

```
1. Header (título + email del creator)
2. PendingEarningsBanner (condicional — si hay earnings pendientes)
3. Stats cards (grid 4 columnas: llamadas, revenue, agentes, rating)
4. EarningsSection (Suspense — datos on-chain)
5. ← CreatorAnalytics ← UX-06 VIVE AQUÍ
      ├── AlertBanner (condicional)
      ├── SummaryCards (métricas compactas)
      └── CallsChart (← la gráfica)
6. Models table
7. Recent Calls table
8. API quick-start code block
```

`CreatorAnalytics` está sobre la tabla de llamadas recientes. Posición correcta según S0.

---

## 6. Error handling — AC-10

En `CreatorAnalytics`, el estado `'error'` debe renderizar un fallback visible, no una pantalla en blanco.

```tsx
// Verificar que CreatorAnalytics.tsx maneja el error state así:
if (status === 'error') {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      No se pudieron cargar las métricas. Intenta recargar la página.
    </div>
  )
}
// Si no existe este fallback → agregar. Si ya existe → verificar que se ve en UI.
```

---

## 7. Loading state — AC-9

`CreatorAnalytics` debe mostrar un skeleton mientras hace fetch. Verificar que existe algo como:

```tsx
if (status === 'loading') {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-32 rounded bg-gray-200" />
      <div className="h-24 rounded bg-gray-200" />
    </div>
  )
}
```

Si no existe → agregar antes del render del componente real.

---

## 8. Test unitario — `buildDailySeries()`

Si no existe `__tests__/creator/analytics/buildDailySeries.test.ts`, crearlo:

```typescript
import { buildDailySeries } from '@/features/creator/lib/analytics'
// (ajustar el import path según donde esté definida la función)

describe('buildDailySeries', () => {
  it('devuelve siempre 30 días', () => {
    const result = buildDailySeries([])
    expect(result).toHaveLength(30)
  })

  it('rellena días sin datos con calls = 0', () => {
    const result = buildDailySeries([])
    result.forEach(day => expect(day.calls).toBe(0))
  })

  it('suma correctamente las llamadas de un día', () => {
    const today = new Date().toISOString().split('T')[0]
    // Simular 2 registros del mismo día
    const raw = [
      { called_at: `${today}T10:00:00Z` },
      { called_at: `${today}T15:00:00Z` },
    ]
    const result = buildDailySeries(raw as any)
    const todayEntry = result.find(d => d.date === today)
    expect(todayEntry?.calls).toBe(2)
  })

  it('ordena la serie ASC por fecha', () => {
    const result = buildDailySeries([])
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date >= result[i - 1].date).toBe(true)
    }
  })
})
```

---

## 9. Verificación de RLS — AC-8

**Test manual en staging (obligatorio antes de merge):**

1. Crear (o usar) dos cuentas de creator diferentes: `creator_a@test.com` y `creator_b@test.com`
2. Con `creator_a`, registrar un agente y hacer al menos 1 llamada
3. Loguearse como `creator_b` y abrir el dashboard
4. Verificar que la gráfica de `creator_b` no muestra las llamadas de `creator_a`
5. Opcional: en la consola de Supabase, verificar la política RLS de `agent_calls`:
   ```sql
   SELECT policyname, cmd, qual
   FROM pg_policies
   WHERE tablename = 'agent_calls';
   ```

---

## 10. Checklist — Definition of Done

Todos los ítems deben estar en ✅ antes de hacer merge a `main`:

- [ ] **Migration 019 creada** en `supabase/migrations/019_agent_calls_analytics_index.sql` con el contenido de §2
- [ ] **Migration 019 aplicada** en staging — índice `idx_agent_calls_agent_called_at` visible en Supabase
- [ ] **Gráfica renderiza datos reales** — usar un agente con llamadas reales en staging (no mock data)
- [ ] **30 barras siempre presentes** — días sin llamadas aparecen como barras en altura 0 (o espacio vacío) pero el eje X muestra los 30 días
- [ ] **Empty state visible** — agente nuevo (0 llamadas) muestra mensaje, no gráfica vacía silenciosa (AC-6)
- [ ] **Loading skeleton visible** — throttle red a "Slow 3G" en DevTools, se ve skeleton antes de la gráfica (AC-9)
- [ ] **Error fallback visible** — simular error 500 en el API route, el dashboard muestra fallback (no pantalla en blanco) (AC-10)
- [ ] **Responsive verificado** — Chrome DevTools en 375px, 768px, 1280px: sin overflow, sin texto truncado (AC-7)
- [ ] **Filtro por `agent_id` funcional** — creator con 2+ agentes: cambiar agente seleccionado → gráfica cambia (AC-5)
- [ ] **RLS verificado** — test manual con 2 cuentas de creator en staging (AC-8) (§9)
- [ ] **Test unitario de `buildDailySeries`** existe y pasa (`npm test`) (§8)
- [ ] **Sin `any` explícito** en código nuevo (Golden Path: TypeScript strict)
- [ ] **Sin datos hardcodeados** en ningún archivo (regla absoluta del proyecto)
- [ ] **Sin errores en consola** de staging (ni warnings de React, ni errores de red no manejados)
- [ ] **Code review aprobado** por Fer antes de merge a `main`

---

## 11. Dependencias y no-dependencias

### No instalar dependencias nuevas
- ❌ `recharts` — ADR-010: no instalar, usar barras CSS
- ❌ `chart.js` / `react-chartjs-2` — no instalar
- ✅ Cero cambios a `package.json`

### Tablas DB usadas
- `agent_calls` — tabla principal; columnas relevantes:
  - `agent_id` (UUID) — filtro por agente
  - `called_at` (timestamptz) — agrupar por fecha
  - `creator_id` (UUID) — respaldado por RLS
  - `is_trial` (boolean) — para excluir trials si aplica

### Columnas DB — no confundir
- `agent_calls.status` → `'success' | 'error'` (NO `status_code`)
- `agent_calls.latency_ms` → duración en ms (NO `duration_ms`)
- `creator_profiles.id = auth.users.id` (NO hay columna `user_id` separada)

---

## 12. Notas finales para Dev

- **No es una feature nueva.** El componente, el API route y la integración en el dashboard ya existen desde Sprint 2. Este story es hardening + migration.
- **La migration es lo único crítico nuevo.** Sin el índice, la query funciona pero será lenta cuando el creator tenga miles de llamadas.
- **Zona horaria:** `called_at` está en UTC en DB. La gráfica muestra fechas UTC. No se requiere conversión a TZ local del creator en esta versión.
- **El orden de los commits sugerido:** (1) migration 019, (2) fixes responsive/error si necesario, (3) test unitario, (4) test manual RLS.
- **Git push:** `git push origin master master:main` (regla del proyecto)

---

_Story generado por SM Agent — BMAD Method v6 — 2026-02-27_  
_Fuentes: `ux-06-s0.md` + `ux-06-sdd.md` + `project-context.md`_
