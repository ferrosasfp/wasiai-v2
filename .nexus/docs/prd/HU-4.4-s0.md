# S0 — HU-4.4: Reputación con Datos Reales
**Fase:** Discovery (S0)  
**Agente:** PM (John) — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**Prioridad:** P1  
**Estado:** PENDIENTE `HU_APPROVED`  

---

## Historia de Usuario

> Como consumer evaluando un agente en WasiAI, quiero ver las métricas reales de uptime, latencia y tasa de error calculadas desde las llamadas históricas, para poder evaluar si el agente es confiable antes de pagar o integrarlo en mi flujo.

---

## Contexto y Motivación

Hasta hoy las fichas de agentes no muestran indicadores de confiabilidad. Un consumer no puede saber si un agente tiene 99.9% de uptime o falla 1 de cada 5 llamadas. Con `agent_calls` ya siendo la tabla central de toda la actividad del marketplace, los datos existen — solo hay que calcularlos y presentarlos.

Esta HU cierra el gap entre "marketplace con búsqueda" (Sprint 7) y "marketplace con señales de calidad", que es lo que convierte la exploración en decisión de compra.

**Regla crítica de WasiAI:** `ADR-007 — Métricas fake = 0`. Nunca mostrar datos simulados. Si no hay datos reales, mostrar "—" o "Datos insuficientes".

---

## Acceptance Criteria

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| **AC-1** | La ficha de detalle del agente (`/agents/[slug]`) muestra: uptime % (últimas 24h), latencia p50 en ms, latencia p95 en ms, tasa de error %. | Screenshot de ficha con agente que tiene llamadas reales |
| **AC-2** | Todas las métricas se calculan desde `agent_calls` real. Cero hardcodes, cero datos simulados. | Revisar el código de `getAgentReputation()`: debe hacer query SQL a `agent_calls` |
| **AC-3** | Si el agente tiene 0 llamadas, todas las métricas muestran "—" (guión largo), no "0%" ni "0ms". | Test con agente recién creado sin llamadas |
| **AC-4** | Si el agente tiene entre 1 y 9 llamadas (N < 10), muestra "Datos insuficientes" en lugar de las métricas numéricas. La etiqueta indica "Basado en N llamadas" cuando N ≥ 10. | Test con agente de exactamente 8 llamadas y con 10+ llamadas |
| **AC-5** | Las métricas se cachean server-side durante 1 hora (`unstable_cache` de Next.js con `revalidate: 3600`). No se recalculan en cada page view. | Verificar en logs de Supabase: la query SQL se ejecuta máximo 1 vez por hora por agente |
| **AC-6** | Badge de uptime con color semántico: uptime < 95% → rojo (`bg-red-100 text-red-700`); 95%–98.9% → amarillo (`bg-yellow-100 text-yellow-700`); ≥ 99% → verde (`bg-green-100 text-green-700`). | Test con 3 agentes forzando los 3 rangos en staging |
| **AC-7** | En la `ModelCard` del listado del marketplace, se muestra **solo** el badge compacto de uptime (porcentaje + color). Sin latencia ni tasa de error en la card. | Screenshot del listado |
| **AC-8** | En la página de detalle (`/agents/[slug]`), se muestran las 4 métricas completas: uptime %, p50 ms, p95 ms, error rate %. | Screenshot de detalle |
| **AC-9** | El componente `ReputationBadge` acepta `agentId` y hace fetch server-side. No hace fetch en client en cada render. | Revisar si es Server Component o usa `unstable_cache` |
| **AC-10** | Traducciones en `es` y `en` para todas las etiquetas: `reputation.uptime`, `reputation.latencyP50`, `reputation.latencyP95`, `reputation.errorRate`, `reputation.noData`, `reputation.insufficientData`, `reputation.basedOn` | `grep -r "reputation" src/messages/` |
| **AC-11** | La query de `agent_calls` usa la columna `status` (valores `'success'` / `'error'`) y `latency_ms`. No usa columnas que no existen (`duration_ms`, `status_code`). | Revisar `project-context.md` > columnas críticas y confirmar en migration |
| **AC-12** | **Antes de implementar**, verificar que `PERCENTILE_CONT` está disponible en el plan Supabase actual del proyecto. Ejecutar en staging: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);` — si falla, aplicar el fallback documentado en la sección "Decisiones Técnicas". | Ejecutar la query de verificación en Supabase SQL Editor de staging antes de escribir código |

---

## Scope

### Archivos a CREAR

| Archivo | Descripción |
|---------|-------------|
| `src/features/models/components/ReputationBadge.tsx` | Badge compacto (uptime % + color). Para usar en `ModelCard`. Server Component preferido. |
| `src/features/models/components/ReputationMetrics.tsx` | Panel completo con las 4 métricas. Para usar en detalle del agente. |
| `src/lib/reputation.ts` | Función `getAgentReputation(agentId: string)` con cache de 1 hora. Devuelve `ReputationData | null`. |

### Archivos a MODIFICAR

| Archivo | Cambio |
|---------|--------|
| `src/features/models/components/ModelCard.tsx` | Agregar `<ReputationBadge agentId={agent.id} />` en la card |
| `src/app/[locale]/agents/[slug]/page.tsx` | Agregar `<ReputationMetrics agentId={agent.id} />` en la ficha de detalle |
| `src/messages/en.json` | Agregar claves `reputation.*` |
| `src/messages/es.json` | Agregar claves `reputation.*` |

### Archivos a NO TOCAR

- Contratos Solidity
- Tabla `agent_calls` — solo lectura
- Cualquier otra feature

---

## Tipos (referencia para Dev/S1)

```typescript
// src/lib/reputation.ts

export interface ReputationData {
  uptimePct: number | null        // % llamadas exitosas últimas 24h
  p50Ms: number | null            // mediana latencia
  p95Ms: number | null            // p95 latencia
  errorRatePct: number | null     // % errores
  totalCalls: number              // N total de llamadas
  hasData: boolean                // false si totalCalls === 0
  sufficientData: boolean         // false si totalCalls < 10
}

// Umbral mínimo para mostrar métricas
const MIN_CALLS_THRESHOLD = 10
```

---

## Decisiones Técnicas

### DT-1: Disponibilidad de `PERCENTILE_CONT` en Supabase

**Contexto (observación San):** `PERCENTILE_CONT` es SQL estándar de PostgreSQL 9.4+. Sin embargo, algunos planes de Supabase free o configuraciones restrictas pueden no tenerla disponible como función de agregado de orden.

**Decisión:**
1. El Dev **verifica primero** en staging con: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);`
2. **Si está disponible** → usar la query original con `PERCENTILE_CONT` (ver abajo)
3. **Si NO está disponible (fallback)** → usar `AVG(latency_ms)` como aproximación de p50, y el percentil 95 no se calcula (se muestra "—"). El campo `p50Ms` en `ReputationData` contendrá el promedio, y el display debe indicar "(aprox)" al lado.

**Fallback SQL:**
```sql
-- Usar si PERCENTILE_CONT no está disponible
SELECT
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0) AS uptime_pct,
  AVG(latency_ms) AS p50_ms,      -- aproximación: promedio en lugar de mediana real
  NULL AS p95_ms,                  -- no calculable sin PERCENTILE_CONT; mostrar "—"
  COUNT(*) FILTER (WHERE status = 'error') * 100.0 / NULLIF(COUNT(*), 0) AS error_rate_pct
FROM agent_calls
WHERE agent_id = $1
  AND created_at > NOW() - INTERVAL '24 hours'
  AND is_trial = false
```

**Nota de display:** Si se usa el fallback, `ReputationMetrics` debe mostrar el label p50 como "~Latencia media" (no "p50") para ser honesto con el consumer.

---

## Query SQL de referencia

```sql
-- src/lib/reputation.ts → getAgentReputation(agentId)
-- Columnas: status ('success'|'error'), latency_ms, created_at
-- IMPORTANTE: usar NULLIF para evitar división por cero

SELECT
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0) AS uptime_pct,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
  COUNT(*) FILTER (WHERE status = 'error') * 100.0 / NULLIF(COUNT(*), 0) AS error_rate_pct
FROM agent_calls
WHERE agent_id = $1
  AND created_at > NOW() - INTERVAL '24 hours'
  AND is_trial = false  -- solo llamadas de pago para métricas de confiabilidad
```

**Nota sobre `is_trial`:** Las llamadas de trial se excluyen de las métricas de reputación porque pueden ser de baja calidad o tener latencias atípicas. Si esta decisión cambia, el Dev debe consultar con PM antes de modificar la query.

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Agentes nuevos o con pocas llamadas dan métricas engañosas | Alta | Alto | AC-3 y AC-4 lo resuelven con "—" y "Datos insuficientes" |
| `PERCENTILE_CONT` puede no estar disponible en el plan Supabase free | Baja | Alto | **[RIESGO MITIGADO — observación San]** AC-12 obliga a verificar en staging antes de escribir código. Fallback completo documentado en sección "Decisiones Técnicas > DT-1": usar `AVG(latency_ms)` como p50 aproximado, p95 muestra "—", label cambia a "~Latencia media". Sin sorpresas en prod. |
| Cache de 1 hora puede mostrar datos desactualizados en incidentes | Media | Bajo | Aceptable para métricas de reputación histórica. Si se necesita tiempo real en el futuro, es upgrade separado. |
| Query costosa si un agente tiene millones de llamadas | Baja | Medio | Filtro `created_at > NOW() - INTERVAL '24 hours'` acota el scan. El índice `(agent_id, created_at)` debe existir en `agent_calls`. Verificar en S1. |
| `is_trial = false` excluye demasiados datos en agentes nuevos | Media | Bajo | Si N < 10 tras excluir trials, se muestra "Datos insuficientes". El Dev puede incluir trials si N < 10, pero requiere aprobación de PM. |

---

## Estimación

**Tamaño:** M — 3-5 horas de desarrollo  
**Complejidad:** Media (query SQL con percentiles, cache server-side, 2 presentaciones diferentes)  
**Dependencias:** Ninguna técnica. Independiente de otras HUs del sprint.

---

## Definition of Done (para QA)

- [ ] `getAgentReputation()` hace query real a `agent_calls` — sin mocks
- [ ] Agente con 0 llamadas → muestra "—" en todas las métricas
- [ ] Agente con < 10 llamadas → "Datos insuficientes"
- [ ] Agente con ≥ 10 llamadas → métricas numéricas con badge de color correcto
- [ ] Cache 1 hora verificado (logs de Supabase o APM)
- [ ] `ModelCard` muestra solo badge compacto de uptime
- [ ] Detalle del agente muestra las 4 métricas completas
- [ ] `npm run build` sin errores TypeScript
- [ ] Traducciones `reputation.*` en `en.json` y `es.json`
- [ ] No hay ninguna columna inexistente referenciada en la query (`duration_ms`, `status_code` están prohibidos)

---

*Generado por PM (John) — BMAD v6 — 2026-02-27*  
*Revisado por San (orquestradora) — 2026-02-27: Observaciones técnicas integradas (AC-12 verificación PERCENTILE_CONT, DT-1 fallback a AVG(latency_ms) documentado, riesgo de percentiles marcado como mitigado)*  
*Gate requerido: Fer escribe `HU_APPROVED` después de leer este documento*
