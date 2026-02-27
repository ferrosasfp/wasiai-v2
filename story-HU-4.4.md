# Story — HU-4.4: Reputación con Datos Reales
**Sprint:** 8 | 2026-03-07 → 2026-03-14
**Prioridad:** P1
**Estimación:** M — 3-5 horas
**Autor:** SM (Bob) — BMAD v6 — 2026-02-27

> **⚠️ Este archivo es 100% autocontenido. El Dev NO necesita leer ningún otro documento.**

---

## Historia de Usuario

> Como consumer evaluando un agente en WasiAI, quiero ver las métricas reales de uptime, latencia y tasa de error calculadas desde las llamadas históricas, para poder evaluar si el agente es confiable antes de pagar o integrarlo en mi flujo.

---

## Acceptance Criteria

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| **AC-1** | La página de detalle del agente (`/models/[slug]`) muestra: uptime % (últimas 24h), latencia p50 en ms, latencia p95 en ms, tasa de error %. | Screenshot de ficha con agente que tiene llamadas reales |
| **AC-2** | Todas las métricas se calculan desde `agent_calls` real. Cero hardcodes, cero datos simulados. | Revisar código de `getAgentReputation()`: debe hacer query SQL a `agent_calls` |
| **AC-3** | Si el agente tiene 0 llamadas, todas las métricas muestran "—" (guión largo), no "0%" ni "0ms". | Test con agente recién creado sin llamadas |
| **AC-4** | Si el agente tiene entre 1 y 9 llamadas (N < 10), muestra "Datos insuficientes". La etiqueta "Basado en N llamadas" solo aparece cuando N ≥ 10. | Test con agente de exactamente 8 llamadas y con 10+ llamadas |
| **AC-5** | Las métricas se cachean server-side durante 1 hora (`unstable_cache` con `revalidate: 3600`). No se recalculan en cada page view. | Verificar en logs de Supabase: query ejecutada máximo 1 vez/hora por agente |
| **AC-6** | Badge de uptime con color semántico: uptime < 95% → rojo (`bg-red-100 text-red-700`); 95%–98.9% → amarillo (`bg-yellow-100 text-yellow-700`); ≥ 99% → verde (`bg-green-100 text-green-700`). | Test con 3 agentes forzando los 3 rangos en staging |
| **AC-7** | En la `ModelCard` del listado del marketplace, se muestra **solo** el badge compacto de uptime (porcentaje + color). Sin latencia ni tasa de error en la card. | Screenshot del listado |
| **AC-8** | En la página de detalle (`/models/[slug]`), se muestran las 4 métricas completas: uptime %, p50 ms, p95 ms, error rate %. | Screenshot de detalle |
| **AC-9** | `ReputationBadge` y `ReputationMetrics` son Server Components. No hacen fetch en cliente. | Inspeccionar: no deben tener `'use client'` |
| **AC-10** | Traducciones en `es` y `en`: `reputation.title`, `reputation.uptime`, `reputation.latencyP50`, `reputation.latencyP95`, `reputation.latencyAvg`, `reputation.errorRate`, `reputation.noData`, `reputation.insufficientData`, `reputation.basedOn` | `grep -r "reputation" src/messages/` |
| **AC-11** | La query usa `agent_calls.called_at` (NO `created_at`) para el filtro de 24h. Columnas permitidas: `status` (`'success'`/`'error'`), `latency_ms`, `is_trial`, `called_at`. Columnas prohibidas: `duration_ms`, `status_code`. | Revisar el código — ninguna columna prohibida debe aparecer |
| **AC-12** | **ANTES de implementar**, ejecutar en staging: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);` — si falla, usar solo el fallback `AVG(latency_ms)` y NO crear la función RPC. | Ejecutar la query de verificación en Supabase SQL Editor de staging antes de escribir código |

---

## 🚨 Hallazgos Críticos del Architect (OBLIGATORIO LEER)

### ⚠️ Columna `called_at`, NO `created_at`
La tabla `agent_calls` tiene columna **`called_at`** (verificado en migration 006). El PRD original decía `created_at` pero esto es **INCORRECTO**. Usar `called_at` en todas las queries de esta HU.

### ⚠️ Ruta de detail page: `/models/[slug]`, NO `/agents/[slug]`
El archivo a modificar es `src/app/[locale]/models/[slug]/page.tsx`. No existe `/agents/[slug]`.

### ⚠️ Índice ya existe para la query de reputación
`idx_agent_calls_agent_called_at` sobre `(agent_id, called_at DESC)` — migration 020. No crear índice duplicado.

---

## PASO OBLIGATORIO PREVIO: Verificar `PERCENTILE_CONT` en Staging

**Ejecutar esto en Supabase SQL Editor de staging ANTES de escribir una sola línea de código:**

```sql
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);
```

- **Si retorna `1.0`** → disponible. Crear la función RPC y usar la query principal.
- **Si retorna error** → NO está disponible. Usar solo el fallback AVG. NO crear la función RPC. Documentar en el PR: "usingFallback permanente".

---

## Estructura de Archivos

### CREAR
| Archivo | Descripción |
|---------|-------------|
| `src/lib/reputation.ts` | `getAgentReputation()` con cache 1h |
| `src/features/models/components/ReputationBadge.tsx` | Badge compacto (uptime %). Server Component. |
| `src/features/models/components/ReputationMetrics.tsx` | Panel completo (4 métricas). Server Component. |

### MODIFICAR
| Archivo | Cambio |
|---------|--------|
| `src/features/models/components/ModelCard.tsx` | Agregar `<ReputationBadge agentId={model.id} />` |
| `src/app/[locale]/models/[slug]/page.tsx` | Agregar `<ReputationMetrics agentId={model.id} />` |
| `src/messages/es.json` | Agregar `reputation.*` |
| `src/messages/en.json` | Agregar `reputation.*` |

### Opcional (solo si PERCENTILE_CONT está disponible en staging)
| Acción | Descripción |
|--------|-------------|
| Crear función en Supabase SQL Editor | `get_agent_reputation_percentile(p_agent_id UUID)` |

### NO TOCAR
| Archivo/Recurso | Razón |
|-----------------|-------|
| Tabla `agent_calls` | Solo lectura |
| Contratos Solidity | Fuera de scope |
| Cualquier otra feature | Fuera de scope |

---

## Tipos e Interfaces

```typescript
// src/lib/reputation.ts — tipos

export interface ReputationData {
  uptimePct: number | null       // % llamadas exitosas (no trials) en últimas 24h
  p50Ms: number | null           // mediana de latency_ms (o avg si fallback)
  p95Ms: number | null           // p95 de latency_ms (null si usingFallback = true)
  errorRatePct: number | null    // % llamadas con status='error'
  totalCalls: number             // N total de llamadas pagadas en 24h
  hasData: boolean               // false si totalCalls === 0
  sufficientData: boolean        // false si totalCalls < 10
  usingFallback: boolean         // true si PERCENTILE_CONT no está disponible
}

const MIN_CALLS_THRESHOLD = 10
```

---

## Código de Referencia

### `src/lib/reputation.ts` — Implementación completa

```typescript
// src/lib/reputation.ts
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

export interface ReputationData {
  uptimePct: number | null
  p50Ms: number | null
  p95Ms: number | null
  errorRatePct: number | null
  totalCalls: number
  hasData: boolean
  sufficientData: boolean
  usingFallback: boolean
}

const MIN_CALLS_THRESHOLD = 10

/**
 * Retorna métricas de reputación calculadas desde agent_calls.
 * Cache de 1 hora por agentId.
 * 
 * ⚠️ CRÍTICO: Usa 'called_at' (no 'created_at') para el filtro de 24h.
 * Columnas permitidas: status ('success'|'error'), latency_ms, is_trial, called_at
 * Columnas PROHIBIDAS: duration_ms, status_code (no existen en el schema)
 */
export const getAgentReputation = unstable_cache(
  async (agentId: string): Promise<ReputationData> => {
    const supabase = createServiceClient()

    // ── INTENTO 1: PERCENTILE_CONT via RPC (solo si fue creada en staging) ──
    // Si PERCENTILE_CONT no está disponible, este bloque lanza error → caemos al fallback
    try {
      const { data, error } = await supabase.rpc('get_agent_reputation_percentile', {
        p_agent_id: agentId,
      })

      if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        const totalCalls = Number(row?.total_calls ?? 0)

        return {
          uptimePct:     totalCalls > 0 ? Number(row.uptime_pct ?? null) : null,
          p50Ms:         totalCalls > 0 ? Number(row.p50_ms ?? null) : null,
          p95Ms:         totalCalls > 0 ? Number(row.p95_ms ?? null) : null,
          errorRatePct:  totalCalls > 0 ? Number(row.error_rate_pct ?? null) : null,
          totalCalls,
          hasData:        totalCalls > 0,
          sufficientData: totalCalls >= MIN_CALLS_THRESHOLD,
          usingFallback:  false,
        }
      }
    } catch {
      // PERCENTILE_CONT no disponible o RPC no existe → caemos al fallback
    }

    // ── FALLBACK: AVG(latency_ms) ─────────────────────────────────────────
    // ⚠️ CRÍTICO: filtrar por called_at (NO created_at)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: rows, error } = await supabase
      .from('agent_calls')
      .select('status, latency_ms')
      .eq('agent_id', agentId)
      .eq('is_trial', false)
      .gte('called_at', cutoff)    // ← called_at, NO created_at

    if (error || !rows) {
      return {
        uptimePct: null, p50Ms: null, p95Ms: null, errorRatePct: null,
        totalCalls: 0, hasData: false, sufficientData: false, usingFallback: true,
      }
    }

    const totalCalls = rows.length
    if (totalCalls === 0) {
      return {
        uptimePct: null, p50Ms: null, p95Ms: null, errorRatePct: null,
        totalCalls: 0, hasData: false, sufficientData: false, usingFallback: true,
      }
    }

    const successCount = rows.filter(r => r.status === 'success').length
    const errorCount   = rows.filter(r => r.status === 'error').length
    const latencies    = rows.map(r => r.latency_ms).filter((v): v is number => v !== null)
    const avgLatency   = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null

    return {
      uptimePct:     (successCount / totalCalls) * 100,
      p50Ms:         avgLatency,    // aprox: promedio, no mediana real
      p95Ms:         null,          // no calculable sin PERCENTILE_CONT
      errorRatePct:  (errorCount / totalCalls) * 100,
      totalCalls,
      hasData:        totalCalls > 0,
      sufficientData: totalCalls >= MIN_CALLS_THRESHOLD,
      usingFallback:  true,
    }
  },
  ['agent-reputation'],
  { revalidate: 3600 }   // 1 hora
)
```

---

### Función PostgreSQL (SOLO si PERCENTILE_CONT disponible en staging)

```sql
-- Ejecutar en Supabase SQL Editor SOLO si la verificación de AC-12 pasó
-- NO ejecutar si PERCENTILE_CONT no está disponible

CREATE OR REPLACE FUNCTION get_agent_reputation_percentile(p_agent_id UUID)
RETURNS TABLE (
  total_calls    BIGINT,
  uptime_pct     NUMERIC,
  p50_ms         NUMERIC,
  p95_ms         NUMERIC,
  error_rate_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)                                                                  AS total_calls,
    COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0) AS uptime_pct,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)                  AS p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)                  AS p95_ms,
    COUNT(*) FILTER (WHERE status = 'error')  * 100.0 / NULLIF(COUNT(*), 0)  AS error_rate_pct
  FROM agent_calls
  WHERE agent_id  = p_agent_id
    AND is_trial  = false
    AND called_at > NOW() - INTERVAL '24 hours'   -- ← called_at, NO created_at
$$;
```

---

### `src/features/models/components/ReputationBadge.tsx`

```typescript
// src/features/models/components/ReputationBadge.tsx
// Server Component — SIN 'use client'

import { getAgentReputation } from '@/lib/reputation'

interface ReputationBadgeProps {
  agentId: string
}

export async function ReputationBadge({ agentId }: ReputationBadgeProps) {
  const rep = await getAgentReputation(agentId)

  // Sin datos suficientes → no renderizar (no contaminar la card)
  if (!rep.hasData || !rep.sufficientData || rep.uptimePct === null) {
    return null
  }

  // Color semántico: verde ≥ 99%, amarillo 95-98.9%, rojo < 95%
  const badgeClass =
    rep.uptimePct >= 99 ? 'bg-green-100 text-green-700' :
    rep.uptimePct >= 95 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
      ↑ {rep.uptimePct.toFixed(1)}%
    </span>
  )
}
```

---

### `src/features/models/components/ReputationMetrics.tsx`

```typescript
// src/features/models/components/ReputationMetrics.tsx
// Server Component — SIN 'use client'

import { getTranslations } from 'next-intl/server'
import { getAgentReputation } from '@/lib/reputation'

interface ReputationMetricsProps {
  agentId: string
}

export async function ReputationMetrics({ agentId }: ReputationMetricsProps) {
  const [rep, t] = await Promise.all([
    getAgentReputation(agentId),
    getTranslations('reputation'),
  ])

  // Sin datos → sección invisible
  if (!rep.hasData) return null

  const uptimeBadgeClass =
    rep.uptimePct !== null && rep.uptimePct >= 99 ? 'bg-green-100 text-green-700' :
    rep.uptimePct !== null && rep.uptimePct >= 95 ? 'bg-yellow-100 text-yellow-700' :
    rep.uptimePct !== null                         ? 'bg-red-100 text-red-700' :
                                                     'bg-gray-100 text-gray-500'

  function fmt(value: number | null, suffix = ''): string {
    if (value === null) return '—'
    return `${Math.round(value)}${suffix}`
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('title')}
        </h3>
        {rep.sufficientData ? (
          <span className="text-xs text-gray-400">
            {t('basedOn', { n: rep.totalCalls })}
          </span>
        ) : (
          <span className="text-xs text-amber-600 font-medium">
            {t('insufficientData')}
          </span>
        )}
      </div>

      {!rep.sufficientData ? (
        <p className="text-sm text-gray-500">{t('insufficientData')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          {/* Uptime */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{t('uptime')}</span>
            <span className={`inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-sm font-semibold ${uptimeBadgeClass}`}>
              {fmt(rep.uptimePct, '%')}
            </span>
          </div>

          {/* Error Rate */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{t('errorRate')}</span>
            <span className="font-semibold text-gray-900">
              {fmt(rep.errorRatePct, '%')}
            </span>
          </div>

          {/* p50 / avg latency */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">
              {/* Si fallback: mostrar "Latencia media" en lugar de "p50" — honesto con el consumer */}
              {rep.usingFallback ? t('latencyAvg') : t('latencyP50')}
            </span>
            <span className="font-semibold text-gray-900">
              {fmt(rep.p50Ms, ' ms')}
              {rep.usingFallback && rep.p50Ms !== null && (
                <span className="text-xs text-gray-400 ml-1">(aprox)</span>
              )}
            </span>
          </div>

          {/* p95 latency */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{t('latencyP95')}</span>
            <span className="font-semibold text-gray-900">
              {/* p95 no disponible en fallback → mostrar "—" */}
              {rep.usingFallback ? '—' : fmt(rep.p95Ms, ' ms')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

### Integración en `ModelCard.tsx`

Localizar el footer de `ModelCard`. Agregar el badge con `Suspense` para no bloquear el render de la card:

```typescript
// Agregar imports al inicio del archivo:
import { Suspense } from 'react'
import { ReputationBadge } from './ReputationBadge'

// En el JSX del footer de la card (después del contador de calls o precio):
<Suspense fallback={null}>
  <ReputationBadge agentId={model.id} />
</Suspense>
```

> **Nota:** Si `ModelCard` es un Client Component (`'use client'`), `ReputationBadge` no puede ser Server Component dentro de él. En ese caso, usar `dynamic(() => import('./ReputationBadge'), { ssr: true })` o convertir `ModelCard` a Server Component. Verificar la implementación actual antes de integrar.

---

### Integración en `models/[slug]/page.tsx`

```typescript
// Agregar import:
import { ReputationMetrics } from '@/features/models/components/ReputationMetrics'

// En la página de detalle, en la sección de stats/info del agente:
{/* HU-4.4: Métricas de reputación con datos reales */}
<ReputationMetrics agentId={model.id} />
```

---

### Traducciones

**`src/messages/es.json`** — agregar al objeto raíz:
```json
"reputation": {
  "title": "Confiabilidad",
  "uptime": "Uptime (24h)",
  "latencyP50": "Latencia p50",
  "latencyP95": "Latencia p95",
  "latencyAvg": "Latencia media",
  "errorRate": "Tasa de error",
  "noData": "—",
  "insufficientData": "Datos insuficientes",
  "basedOn": "Basado en {n} llamadas"
}
```

**`src/messages/en.json`** — agregar al objeto raíz:
```json
"reputation": {
  "title": "Reliability",
  "uptime": "Uptime (24h)",
  "latencyP50": "Latency p50",
  "latencyP95": "Latency p95",
  "latencyAvg": "Avg latency",
  "errorRate": "Error rate",
  "noData": "—",
  "insufficientData": "Insufficient data",
  "basedOn": "Based on {n} calls"
}
```

---

## Notas de Implementación

### ¿Por qué `called_at` y no `created_at`?
La tabla `agent_calls` usa `called_at` como timestamp de la llamada (migration 006). `created_at` no existe en esta tabla. Confundir las dos columnas causará un error en runtime — SQL query silencioso que retorna 0 rows o error de columna.

### ¿Por qué `is_trial = false`?
Las llamadas de trial se excluyen de las métricas de reputación porque:
1. Son gratuitas y pueden ser de baja calidad o tener latencias atípicas
2. Distorsionarían el uptime real que pagaría un consumer

### ¿Por qué `unstable_cache` con 1 hora?
Las métricas de reputación son históricas, no en tiempo real. Un consumer que ve el detalle del agente no necesita el dato actualizado al segundo. 1 hora de cache reduce significativamente la carga en la DB sin impacto perceptible en la UX.

### Comportamiento del fallback `usingFallback = true`
Si `PERCENTILE_CONT` no está disponible:
- `p50Ms` → promedio de latencias (aproximación honesta)
- `p95Ms` → `null` → se muestra `"—"` en la UI
- El label de p50 cambia de `"Latencia p50"` a `"Latencia media"` para ser honesto con el consumer
- El valor de `p50Ms` incluye `(aprox)` al lado

Esto cumple con ADR-007 (no datos simulados) — mostrar la mejor aproximación disponible con transparencia es correcto.

---

## DoD Checklist

- [ ] **AC-12 completado PRIMERO:** `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float)` ejecutado en staging
- [ ] Resultado documentado en el PR: disponible (función RPC creada) o no disponible (solo fallback)
- [ ] `getAgentReputation()` hace query real a `agent_calls` — sin mocks ni datos simulados
- [ ] Columna `called_at` usada en el filtro de 24h (no `created_at`)
- [ ] Columnas prohibidas (`duration_ms`, `status_code`) no aparecen en ninguna query
- [ ] Agente con 0 llamadas → `ReputationBadge` retorna `null`, `ReputationMetrics` retorna `null`
- [ ] Agente con 1-9 llamadas → "Datos insuficientes" visible en `ReputationMetrics`
- [ ] Agente con ≥ 10 llamadas → métricas numéricas con badge de color correcto
- [ ] Badge verde para uptime ≥ 99%, amarillo 95–98.9%, rojo < 95%
- [ ] Cache 1 hora activo (`revalidate: 3600`)
- [ ] `ModelCard` muestra solo badge compacto (uptime), envuelto en `Suspense`
- [ ] Detail page (`/models/[slug]`) muestra `ReputationMetrics` completo
- [ ] Si `usingFallback = true`: label p50 es "Latencia media", p95 muestra "—"
- [ ] Traducciones `reputation.*` en `en.json` y `es.json`
- [ ] `npm run build` sin errores TypeScript

---

*Story generado por SM (Bob) — BMAD v6 — Sprint 8 — 2026-02-27*
*Basado en: HU-4.4-s0.md (PRD) + sdd-HU-4.4.md (SDD)*
*Correcciones críticas del Architect incluidas: called_at (no created_at), ruta /models/[slug] (no /agents/[slug]), verificación PERCENTILE_CONT obligatoria antes de implementar, fallback AVG documentado*
