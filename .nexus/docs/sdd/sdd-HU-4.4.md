# SDD — HU-4.4: Reputación con Datos Reales
**Fase:** S1 (Software Design Document)  
**Agente:** Architect — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**HU Fuente:** `.nexus/docs/prd/HU-4.4-s0.md`  
**Estado:** SPEC_PENDING

---

## Hallazgos del Codebase (Pre-diseño)

### ✅ Verificaciones completadas

| Check | Resultado |
|-------|-----------|
| `agent_calls.status` columna | ✅ **EXISTE** — `TEXT NOT NULL DEFAULT 'success'` (migration 003). Valores: `'success'` \| `'error'` |
| `agent_calls.latency_ms` columna | ✅ **EXISTE** — `INT` (migration 003, renombrada en 006). Nullable. |
| `agent_calls.is_trial` columna | ✅ **EXISTE** — `BOOLEAN NOT NULL DEFAULT FALSE` (migration 016) |
| `agent_calls.created_at` columna | ✅ **EXISTE** — `TIMESTAMPTZ DEFAULT NOW()` (migration 003) |
| Índice en `(agent_id, called_at DESC)` | ✅ **EXISTE** — `idx_agent_calls_agent_called_at` (migration 020) |
| Columnas prohibidas | ✅ **NO EXISTEN** — ni `duration_ms` ni `status_code` en el schema |
| Ruta del detail page | ✅ Es `src/app/[locale]/models/[slug]/page.tsx` (no `/agents/[slug]`) |
| `PERCENTILE_CONT` disponible | ⚠️ **DEBE VERIFICARSE** en staging antes de implementar (AC-12) |

### 🚨 Hallazgo crítico: Ruta del detail page

El PRD menciona `/agents/[slug]` pero la ruta real es `/models/[slug]`. El archivo a modificar es:
- `src/app/[locale]/models/[slug]/page.tsx` ← **ruta real**

### 🚨 Hallazgo: `agent_calls.called_at` vs `created_at`

La tabla `agent_calls` tiene columna `called_at` (no `created_at`). Esto es importante para el filtro de 24 horas en la query de reputación. Verificado en migration 006: la tabla original tenía `called_at TIMESTAMPTZ DEFAULT NOW()`.

---

## Arquitectura

### Nuevos Archivos

```
src/
├── lib/
│   └── reputation.ts                          ← getAgentReputation() con cache 1h
└── features/models/components/
    ├── ReputationBadge.tsx                    ← Badge compacto (uptime %) para ModelCard
    └── ReputationMetrics.tsx                  ← Panel completo (4 métricas) para detalle
```

### Archivos Modificados

```
src/features/models/components/ModelCard.tsx   → agregar <ReputationBadge />
src/app/[locale]/models/[slug]/page.tsx        → agregar <ReputationMetrics />
src/messages/en.json                           → agregar reputation.*
src/messages/es.json                           → agregar reputation.*
```

---

## Diseño Detallado

### 1. `src/lib/reputation.ts`

```typescript
// src/lib/reputation.ts
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

export interface ReputationData {
  uptimePct: number | null       // % llamadas exitosas (no trials) en últimas 24h
  p50Ms: number | null           // mediana de latency_ms (o avg si fallback)
  p95Ms: number | null           // p95 de latency_ms (null si fallback activo)
  errorRatePct: number | null    // % llamadas con status='error'
  totalCalls: number             // N total de llamadas pagadas en 24h
  hasData: boolean               // false si totalCalls === 0
  sufficientData: boolean        // false si totalCalls < MIN_CALLS_THRESHOLD
  usingFallback: boolean         // true si PERCENTILE_CONT no está disponible
}

const MIN_CALLS_THRESHOLD = 10

/**
 * Retorna métricas de reputación de un agente calculadas desde agent_calls.
 * Cacheado 1 hora por agentId.
 * 
 * IMPORTANTE: Usa 'called_at' (no 'created_at') para el filtro de 24h.
 * Columnas: status ('success'|'error'), latency_ms (INT, nullable), is_trial (BOOLEAN)
 */
export const getAgentReputation = unstable_cache(
  async (agentId: string): Promise<ReputationData> => {
    const supabase = createServiceClient()

    // ── Paso 1: intentar con PERCENTILE_CONT ──────────────────────────────
    try {
      const { data, error } = await supabase.rpc('get_agent_reputation_percentile', {
        p_agent_id: agentId,
      })

      if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        const totalCalls = Number(row.total_calls ?? 0)

        return {
          uptimePct:      totalCalls > 0 ? Number(row.uptime_pct ?? null) : null,
          p50Ms:          totalCalls > 0 ? Number(row.p50_ms ?? null) : null,
          p95Ms:          totalCalls > 0 ? Number(row.p95_ms ?? null) : null,
          errorRatePct:   totalCalls > 0 ? Number(row.error_rate_pct ?? null) : null,
          totalCalls,
          hasData:        totalCalls > 0,
          sufficientData: totalCalls >= MIN_CALLS_THRESHOLD,
          usingFallback:  false,
        }
      }
    } catch {
      // PERCENTILE_CONT no disponible → caemos al fallback
    }

    // ── Paso 2: fallback con AVG(latency_ms) ─────────────────────────────
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('agent_calls')
      .select('status, latency_ms')
      .eq('agent_id', agentId)
      .eq('is_trial', false)
      .gte('called_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    if (fallbackError || !fallbackData) {
      return {
        uptimePct: null, p50Ms: null, p95Ms: null, errorRatePct: null,
        totalCalls: 0, hasData: false, sufficientData: false, usingFallback: true,
      }
    }

    const totalCalls = fallbackData.length
    if (totalCalls === 0) {
      return {
        uptimePct: null, p50Ms: null, p95Ms: null, errorRatePct: null,
        totalCalls: 0, hasData: false, sufficientData: false, usingFallback: true,
      }
    }

    const successCount = fallbackData.filter(r => r.status === 'success').length
    const errorCount   = fallbackData.filter(r => r.status === 'error').length
    const latencies    = fallbackData.map(r => r.latency_ms).filter((v): v is number => v !== null)
    const avgLatency   = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null

    return {
      uptimePct:      (successCount / totalCalls) * 100,
      p50Ms:          avgLatency,   // aproximación: promedio en lugar de mediana real
      p95Ms:          null,         // no calculable sin PERCENTILE_CONT
      errorRatePct:   (errorCount / totalCalls) * 100,
      totalCalls,
      hasData:        totalCalls > 0,
      sufficientData: totalCalls >= MIN_CALLS_THRESHOLD,
      usingFallback:  true,
    }
  },
  ['agent-reputation'],          // cache key prefix
  { revalidate: 3600 }           // 1 hora
)
```

> **Nota sobre la RPC:** La función `get_agent_reputation_percentile` debe crearse en Supabase SQL Editor como función PostgreSQL. Ver sección "Schema DB" abajo.

---

### 2. Schema DB — Función PostgreSQL para Percentiles

```sql
-- Ejecutar en Supabase SQL Editor (no es migration numerada — es función de DB)
-- El Dev debe verificar primero que PERCENTILE_CONT funciona:
-- SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);
-- Si retorna error → usar solo el fallback AVG, no crear esta función.

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
    COUNT(*)                                                                          AS total_calls,
    COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0)         AS uptime_pct,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)                          AS p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)                          AS p95_ms,
    COUNT(*) FILTER (WHERE status = 'error')  * 100.0 / NULLIF(COUNT(*), 0)          AS error_rate_pct
  FROM agent_calls
  WHERE agent_id  = p_agent_id
    AND is_trial  = false
    AND called_at > NOW() - INTERVAL '24 hours'
$$;
```

**⚠️ Procedimiento obligatorio antes de implementar (AC-12):**
```sql
-- 1. Verificar disponibilidad de PERCENTILE_CONT en staging:
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);
-- Si retorna 1.0 → disponible. Si retorna error → usar solo fallback AVG.

-- 2. Si disponible → crear la función get_agent_reputation_percentile
-- 3. Si no disponible → documentar en el PR: "usingFallback permanente"
```

---

### 3. `src/features/models/components/ReputationBadge.tsx`

```typescript
// src/features/models/components/ReputationBadge.tsx
// Server Component — no necesita 'use client'

import { getAgentReputation } from '@/lib/reputation'

interface ReputationBadgeProps {
  agentId: string
}

export async function ReputationBadge({ agentId }: ReputationBadgeProps) {
  const rep = await getAgentReputation(agentId)

  // Sin datos suficientes → no renderizar badge (no contaminar la card)
  if (!rep.hasData || !rep.sufficientData || rep.uptimePct === null) {
    return null
  }

  // Color semántico por uptime
  const badgeClass =
    rep.uptimePct >= 99   ? 'bg-green-100 text-green-700' :
    rep.uptimePct >= 95   ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
      ↑ {rep.uptimePct.toFixed(1)}%
    </span>
  )
}
```

---

### 4. `src/features/models/components/ReputationMetrics.tsx`

```typescript
// src/features/models/components/ReputationMetrics.tsx
// Server Component

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

  // Sin datos → no renderizar sección
  if (!rep.hasData) return null

  const uptimeBadgeClass =
    rep.uptimePct !== null && rep.uptimePct >= 99   ? 'bg-green-100 text-green-700' :
    rep.uptimePct !== null && rep.uptimePct >= 95   ? 'bg-yellow-100 text-yellow-700' :
    rep.uptimePct !== null                           ? 'bg-red-100 text-red-700' :
                                                       'bg-gray-100 text-gray-500'

  // Helper: formatear valor o mostrar "—"
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

          {/* p50 latency */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">
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

### 5. Integración en `ModelCard.tsx`

```typescript
// Agregar import:
import { Suspense } from 'react'
import { ReputationBadge } from './ReputationBadge'

// Dentro de ModelCard, en el footer (después de calls count):
// ANTES:
<span className="shrink-0">⚡ {remaining.toLocaleString('en-US')} calls</span>

// DESPUÉS: agregar badge inline (Suspense para no bloquear la card si el cache miss)
<span className="shrink-0">⚡ {remaining.toLocaleString('en-US')} calls</span>
<Suspense fallback={null}>
  <ReputationBadge agentId={model.id} />
</Suspense>
```

> **Nota:** `ModelCard` es un Server Component en el contexto de `page.tsx` (ISR). El `Suspense` permite streaming: la card se renderiza inmediatamente y el badge aparece cuando el cache de reputation resuelve.

---

### 6. Integración en `models/[slug]/page.tsx`

```typescript
// Agregar imports:
import { ReputationMetrics } from '@/features/models/components/ReputationMetrics'

// En la sidebar, después del bloque "Quick stats":
{/* Reputation Metrics — HU-4.4 */}
<ReputationMetrics agentId={model.id} />

// Reemplaza o complementa al AgentRating existente (son distintos:
// AgentRating = ratings subjetivos (👍/👎), ReputationMetrics = uptime/latencia objetivos)
```

---

### 7. Traducciones

```json
// src/messages/es.json
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

```json
// src/messages/en.json
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

## Flujo End-to-End

```
1. Visitante abre /models/[slug] o listado del marketplace
   ↓
2. Server: page.tsx (ISR revalidate=300) renderiza
   → ModelCard o ModelDetailPage llaman a ReputationBadge/ReputationMetrics
   ↓
3. unstable_cache intenta resolver getAgentReputation(agentId)
   → Cache HIT (dentro de 1h): retorna ReputationData inmediatamente
   → Cache MISS: ejecuta query a Supabase
     → Intenta PERCENTILE_CONT vía RPC
     → Si falla: fallback AVG(latency_ms) via SDK client-side
   ↓
4. ReputationData llega a los componentes:
   → totalCalls === 0 → no renderizar nada (AC-3)
   → totalCalls < 10  → "Datos insuficientes" (AC-4)
   → totalCalls >= 10 → métricas con badge de color (AC-6)
   ↓
5. HTML generado incluye métricas ya calculadas
   → Sin hidratación de cliente necesaria (Server Components)
   → Sin fetch en browser
```

---

## Implementation Readiness Check

| Item | Estado | Acción Dev |
|------|--------|-----------|
| `agent_calls.status` confirmado | ✅ | Sin acción |
| `agent_calls.latency_ms` confirmado | ✅ | Sin acción |
| `agent_calls.is_trial` confirmado | ✅ | Sin acción |
| `agent_calls.called_at` (no `created_at`) | ✅ Verificado | Usar `called_at` en la query, no `created_at` |
| Índice `(agent_id, called_at DESC)` | ✅ migration 020 | Sin acción |
| Ruta real del detail page | ✅ `/models/[slug]` | Modificar ese archivo, no `/agents/[slug]` |
| PERCENTILE_CONT disponible | ⚠️ Verificar en staging | Ejecutar `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);` ANTES de codear |
| Función RPC PostgreSQL | ❌ No existe | Crear en Supabase SQL Editor si PERCENTILE_CONT disponible |
| `unstable_cache` configurado con `revalidate: 3600` | ❌ No existe | Crear en `src/lib/reputation.ts` |
| Traducciones `reputation.*` | ❌ Ausentes | Agregar en en.json y es.json |
| Columnas prohibidas (`duration_ms`, `status_code`) | ✅ No usadas | Sin acción |

---

## Definition of Done

- [ ] AC-12: Dev ejecutó `SELECT PERCENTILE_CONT(0.5)...` en staging antes de implementar
- [ ] `getAgentReputation()` hace query real a `agent_calls` — sin mocks
- [ ] `agent_calls.called_at` usado (no `created_at`) en el WHERE de 24h
- [ ] Agente con 0 llamadas → `ReputationBadge` retorna `null`, `ReputationMetrics` retorna `null`
- [ ] Agente con < 10 llamadas → "Datos insuficientes" visible
- [ ] Agente con ≥ 10 llamadas → métricas numéricas con badge de color correcto
- [ ] Badge verde para uptime ≥ 99%, amarillo 95–98.9%, rojo < 95%
- [ ] Cache 1 hora: logs de Supabase muestran query ejecutada máximo 1 vez/hora/agente
- [ ] `ModelCard` muestra solo badge compacto (uptime), no panel completo
- [ ] Detail page (`/models/[slug]`) muestra `ReputationMetrics` completo
- [ ] Si `usingFallback=true`: label muestra "~Latencia media", p95 muestra "—"
- [ ] `npm run build` sin errores TypeScript
- [ ] Traducciones `reputation.*` en `en.json` y `es.json`
- [ ] Ninguna columna inexistente referenciada en queries

---

*Generado por Architect — BMAD v6 — 2026-02-27*  
*Gate requerido: Fer escribe `SPEC_APPROVED` después de leer este documento*
