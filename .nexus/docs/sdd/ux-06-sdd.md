# S1 — SDD: UX-06 — Gráfica de llamadas por día en dashboard creator

**Estado:** `DRAFT` — pendiente SPEC_APPROVED de Fer  
**Fecha:** 2026-02-27  
**Autor:** San (PM Agent, BMAD Method v6)  
**Referencia S0:** `.nexus/docs/prd/ux-06-s0.md`  
**ADR relevante:** ADR-010 (CallsChart = barras CSS, sin recharts)

---

## 0. Diagnóstico: ¿Qué ya existe?

> **Hallazgo crítico:** La infraestructura de UX-06 fue implementada parcialmente en Sprint 2 (HU-1.4 — Creator Analytics). El componente `CallsChart` ya existe y el API route ya devuelve `dailySeries`.

| Elemento | Estado |
|----------|--------|
| `GET /api/creator/analytics` | ✅ Existe — devuelve `dailySeries: DayData[]` |
| `CallsChart` component | ✅ Existe — barras CSS puras, sin recharts |
| `CreatorAnalytics` wrapper | ✅ Integrado en `page.tsx` |
| `buildDailySeries()` con relleno de 0s | ✅ Implementado en JS (client-side) |
| Filtro por `agent_id` | ✅ Soportado via query param |
| Loading state | ✅ Status `'loading'` en `CreatorAnalytics` |
| Empty state | ✅ Renderiza mensaje cuando todos los días son 0 |
| Responsive | ⚠️ Pendiente verificar en 375px |
| Índice `(agent_id, called_at)` en DB | ❌ **Falta** — crear en migration 019 |
| Error boundary / fallback | ⚠️ Partial — status `'error'` existe pero UI de fallback no verificada |
| Tests en `__tests__/` | ⚠️ No confirmado — revisar en Dev phase |

**Conclusión:** UX-06 requiere principalmente: (1) migration con índice DB, (2) verificación/refinamiento de ACs pendientes, (3) posible ajuste de UI para responsive.

---

## 1. Archivos a crear o modificar

### Crear

| Path | Propósito |
|------|-----------|
| `supabase/migrations/019_agent_calls_analytics_index.sql` | Índice compuesto `(agent_id, called_at)` para la query de analytics |

### Modificar (si hay gaps vs ACs)

| Path | Qué revisar / ajustar |
|------|-----------------------|
| `src/features/creator/components/analytics/CallsChart.tsx` | Verificar responsive en 375px; ajustar gap/overflow si necesario |
| `src/features/creator/components/analytics/CallsChart.tsx` | AC-10: agregar `try/catch` o `ErrorBoundary` en `CreatorAnalytics` si no existe |
| `src/features/creator/components/CreatorAnalytics.tsx` | Confirmar que el error state renderiza un fallback visible (no pantalla en blanco) |
| `src/app/api/creator/analytics/route.ts` | Verificar: query actual usa `.select('called_at').gte('called_at', since30d)` — funciona pero no es SQL GROUP BY (ver §2) |

### No modificar

| Path | Razón |
|------|-------|
| `src/app/[locale]/creator/dashboard/page.tsx` | `<CreatorAnalytics>` ya integrado correctamente |
| `package.json` | Sin dependencias nuevas (ADR-010 confirmado: no recharts) |

---

## 2. Query SQL exacta — llamadas por día (últimos 30 días)

### Implementación actual (JS-side grouping)
El API route actual hace:
```typescript
// Trae todos los called_at de los últimos 30 días y agrupa en memoria
svc.from('agent_calls').select('called_at').in('agent_id', agentIds).gte('called_at', since30d)
```
Luego `buildDailySeries()` en JS hace el group-by y rellena los días vacíos.

**Problema a escala:** Si un creator tiene miles de llamadas, este fetch es costoso (trae N rows para solo calcular un count por día).

### Query SQL recomendada (más eficiente — implementar en Dev si se opta por Server-Side)
```sql
-- Paso 1: Serie de 30 días (todos los días, incluyendo vacíos)
WITH date_series AS (
  SELECT generate_series(
    CURRENT_DATE - INTERVAL '29 days',
    CURRENT_DATE,
    INTERVAL '1 day'
  )::date AS day
),
-- Paso 2: Conteo real desde agent_calls
daily_counts AS (
  SELECT
    DATE(called_at AT TIME ZONE 'UTC') AS day,
    COUNT(*) AS calls
  FROM agent_calls
  WHERE
    agent_id = ANY(:agent_ids)   -- filtro por array de IDs del creator
    AND called_at >= NOW() - INTERVAL '30 days'
  GROUP BY DATE(called_at AT TIME ZONE 'UTC')
)
-- Paso 3: LEFT JOIN para rellenar días vacíos con 0
SELECT
  ds.day::text AS date,
  COALESCE(dc.calls, 0)::int AS calls
FROM date_series ds
LEFT JOIN daily_counts dc ON ds.day = dc.day
ORDER BY ds.day ASC;
```

**Parámetros:**
- `:agent_ids` — array de UUIDs de los agentes del creator (o uno solo si se filtra por `agent_id`)
- Zona horaria: **UTC** (consistente con `called_at` en DB; se documenta en UI como "últimas 30 días UTC")

**Decisión para Dev:** La implementación actual (JS grouping) es funcional para el MVP. Migrar a SQL server-side queda como mejora de performance en sprint futuro, a menos que el creator tenga >10k llamadas y se note lentitud.

---

## 3. Migration SQL

### Archivo: `supabase/migrations/019_agent_calls_analytics_index.sql`

```sql
-- Migration 019: Índice para query de analytics de llamadas por día
-- UX-06: Gráfica de llamadas por día en dashboard creator
-- Mejora significativa de performance en la query:
--   SELECT called_at FROM agent_calls WHERE agent_id = ANY(:ids) AND called_at >= NOW() - INTERVAL '30 days'

CREATE INDEX IF NOT EXISTS idx_agent_calls_agent_called_at
  ON agent_calls (agent_id, called_at DESC);

-- Nota: El índice parcial WHERE called_at > NOW() - INTERVAL '30 days' no es estático en Postgres,
-- por lo que se usa índice completo. El planner lo usará con el filtro de fecha en la query.
```

**Número de migration:** `019` (confirmado: migrations 000–018 aplicadas; project-context.md decía 017 pero el FS muestra 017 y 018 ya presentes → próxima es 019).

> ⚠️ Verificar con `ls supabase/migrations/` antes de aplicar — si ya existe 019, usar 020.

---

## 4. Interface TypeScript del componente CallsChart

```typescript
// src/features/creator/components/analytics/CallsChart.tsx

export interface DayData {
  /** Fecha en formato ISO 'YYYY-MM-DD' */
  date: string
  /** Número de llamadas en ese día (0 si no hubo) */
  calls: number
}

export interface CallsChartProps {
  /** Serie completa de 30 días, incluyendo días con calls = 0 */
  series: DayData[]
}

// Comportamiento esperado:
// - Si todos los días tienen calls = 0 → renderiza empty state con mensaje
// - Si hay al menos un día con calls > 0 → renderiza barras CSS
// - Tooltip al hover: muestra fecha y número de llamadas
// - Eje X: labels en posiciones 0, mid, last (formato 'MM-DD')
// - Eje Y: implícito en altura relativa de barras (max = 100% del contenedor)
// - Altura del contenedor: 96px (h-24) — ajustable
// - Color de barras: #E84142 (avax-500) con opacity-80, hover opacity-100
```

---

## 5. Decisión: recharts vs alternativa

### ✅ Decisión: Barras CSS puras (sin recharts, sin chart.js)

**Evidencia:**
- `grep -i "recharts\|chart.js" package.json` → exit code 1 (no instalado)
- ADR-010 ya tomó esta decisión en Sprint 2: "CallsChart = barras CSS — Cero dependencias nuevas; entrega más rápida"
- El componente `CallsChart` ya implementa barras CSS funcionales

**Justificación:**
| Criterio | Barras CSS | recharts |
|----------|-----------|---------|
| Dependencias nuevas | 0 | +recharts bundle (~300KB) |
| Tiempo de implementación | Ya hecho | Reescritura completa |
| Responsive | Manual con flex | Automático |
| Customización visual | Total | Limitada por API |
| Tooltips | Implementados | Nativos |
| ACs de UX-06 | Todos cubiertos | Todos cubiertos |

**Veredito:** Mantener implementación CSS. No instalar recharts.

---

## 6. Integración en el dashboard — posición exacta

### Posición actual (ya integrada correctamente)
En `src/app/[locale]/creator/dashboard/page.tsx`:

```tsx
{/* Orden de secciones en el dashboard */}
1. Header (título + email)
2. PendingEarningsBanner (condicional)
3. Stats cards (grid 4 columnas)
4. EarningsSection (Suspense — on-chain data)
5. ← CreatorAnalytics (UX-06 vive aquí) ← POSICIÓN CORRECTA
6. Models table
7. Recent Calls table
8. API quick-start code block
```

`CreatorAnalytics` renderiza internamente:
- `AlertBanner` (si hay alertas de salud)
- `SummaryCards` (métricas compactas)
- `CallsChart` ← la gráfica de UX-06

**No se necesita cambiar la posición.** Ya está sobre la tabla de llamadas recientes, que es lo solicitado en S0.

---

## 7. Definition of Done

- [ ] **Migration 019 aplicada** en staging y prod (`idx_agent_calls_agent_called_at` visible en Supabase)
- [ ] **Gráfica renderiza datos reales** — sin mock data, con agente que tenga llamadas reales
- [ ] **Días con 0 llamadas rellenados** — verificar con agente nuevo (30 barras, 29 en 0)
- [ ] **Filtro por `agent_id` funcional** — creator con 2+ agentes puede seleccionar uno y la gráfica cambia
- [ ] **Empty state visible** — cuando todos los días son 0, muestra mensaje (no barras vacías)
- [ ] **Loading skeleton visible** — estado `'loading'` renderiza indicator mientras se fetch
- [ ] **Error fallback visible** — si el API falla, no se muestra pantalla en blanco
- [ ] **Responsive verificado** en 375px, 768px, 1280px (Chrome DevTools)
- [ ] **RLS verificado** — creator A no puede ver datos de creator B (probar con 2 cuentas)
- [ ] **Sin errores en consola** en staging y prod
- [ ] **Code review aprobado** antes de merge a main

---

## 8. Implementation Readiness Check

| Check | Estado | Acción requerida |
|-------|--------|-----------------|
| S0 con HU_APPROVED de Fer | ⚠️ Pendiente | Fer debe confirmar HU_APPROVED antes de que Dev implemente |
| Componente CallsChart existe | ✅ | Ninguna — verificar ACs |
| API route `/api/creator/analytics` existe | ✅ | Ninguna — verificar filtro por agent_id |
| `dailySeries` devuelta por API | ✅ | Ninguna |
| Integración en dashboard | ✅ | Ninguna — `<CreatorAnalytics>` ya en page.tsx |
| recharts instalado | ❌ No necesario | ADR-010: barras CSS, no instalar |
| Migration 019 creada | ❌ Pendiente | Dev crea `019_agent_calls_analytics_index.sql` |
| Índice `(agent_id, called_at)` en DB | ❌ Pendiente | Aplicar migration 019 en staging primero |
| Responsive 375px verificado | ⚠️ No confirmado | Dev verifica con Chrome DevTools |
| Error boundary en CreatorAnalytics | ⚠️ Partial | Dev confirma que status `'error'` muestra fallback visible |
| Tests unitarios de buildDailySeries | ⚠️ No confirmado | Dev agrega test en `__tests__/creator/analytics/` |
| RLS verificado con 2 creators | ⚠️ Pendiente | Dev hace test manual con 2 cuentas en staging |

### Resumen de trabajo real para Dev

**La mayor parte ya está hecha.** El trabajo pendiente es:
1. Crear y aplicar migration 019 (índice DB) — ~10 min
2. Verificar/ajustar responsive en 375px — ~20 min
3. Confirmar que el error state muestra un fallback visible — ~15 min
4. Test manual de RLS con 2 creators — ~20 min
5. Agregar test unitario de `buildDailySeries` si no existe — ~30 min

**Estimado total Dev:** ~2h (no es una feature nueva, es verificación + hardening)

---

## 9. Preguntas resueltas (del S0)

| Pregunta | Respuesta |
|----------|-----------|
| ¿Gráfica filtra por agente o todos? | Filtra por agente seleccionado vía `agent_id` param; si no se especifica, agrega todos los agentes del creator |
| ¿Zona horaria? | UTC — consistente con `called_at` en DB; nota visible en UI opcional |
| ¿Barras o línea? | Barras CSS (ADR-010) |
| ¿Existe índice `(agent_id, called_at)`? | No existe — crear en migration 019 |
| ¿recharts instalado? | No — no instalar (ADR-010) |

---

_Requiere **SPEC_APPROVED explícito de Fer** antes de crear Story y avanzar a Dev._
