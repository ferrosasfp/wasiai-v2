# Story File — #002: [BUG] Analytics completamente vacío (WAS-64)

> SDD: doc/sdd/002-analytics-vacio/sdd.md
> Fecha: 2026-02-27
> Branch: fix/002-analytics-vacio

---

## Goal

El creator dashboard muestra la sección de analytics completamente vacía — sin texto de título visible, sin tarjetas de métricas, sin gráfico. Hay que identificar la causa raíz exacta (API retornando error, o estado de carga colgado) y aplicar fixes defensivos en `CreatorAnalytics.tsx` para garantizar que el usuario siempre vea un estado legible.

## Nota de diagnóstico pre-implementación (leer antes de tocar código)

El Architect verificó lo siguiente **antes de generar este Story File**:

| Verificación | Resultado |
|-------------|----------|
| Namespace `analytics` en `messages/es.json` | ✅ EXISTE — tiene `title`, `all_agents`, `errorLoading`, `empty_state` y más |
| Namespace `analytics` en `messages/en.json` | ✅ EXISTE — completo |
| `NextIntlClientProvider` en `/app/[locale]/layout.tsx` | ✅ Presente sin props adicionales (next-intl v3 auto-include) |
| Causa A (i18n namespace faltante) | ❌ DESCARTADA — las claves existen |

**La causa raíz no es i18n.** El bug está en otra parte. Dev DEBE verificar:
1. Si la API `/api/creator/analytics` retorna 200 o error en DevTools → Network
2. Si el componente queda en `status: 'loading'` indefinidamente
3. Si hay un shape mismatch entre la respuesta de la API y lo que espera `SummaryCards`

## Acceptance Criteria (EARS)

1. **WHEN** un creator autenticado abre su dashboard, **THE** sección de analytics **SHALL** mostrar al menos el título "Analítica" (ES) / "Analytics" (EN) y los valores numéricos de total calls, revenue total y agentes activos — aunque sean cero.

2. **WHEN** el endpoint `/api/creator/analytics` retorna datos válidos, **THE** componente `CreatorAnalytics` **SHALL** propagar esos datos a `SummaryCards` y `CallsChart`, y este último **SHALL** renderizar barras CSS o el mensaje "Sin llamadas todavía".

3. **IF** `/api/creator/analytics` retorna un error HTTP (4xx/5xx), **THEN THE** dashboard **SHALL** mostrar un banner de error con texto legible al usuario — nunca una caja vacía o en blanco.

4. **WHILE** los datos de analytics están cargando, **THE** tarjetas **SHALL** mostrar 5 skeleton loaders visibles (`animate-pulse`), no contenido en blanco.

5. **WHEN** el creator no tiene ninguna llamada registrada, **THE** sección de analytics **SHALL** mostrar ceros con el mensaje "Sin actividad aún" visible — nunca tarjetas completamente vacías sin texto.

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/features/creator/components/CreatorAnalytics.tsx` | Modificar | Fix B: agregar texto fallback en banner de error. Fix C: agregar optional chaining `state.data?.summary`. Fix D (si diagnóstico lo requiere): agregar `console.error` en el catch para identificar la causa en production logs. | Mismo archivo — patrón del banner de error existente (línea ~84) |

**Archivos de mensajes i18n — NO modificar** (las claves ya existen y son correctas).

## Exemplars

### Exemplar 1: Componente CreatorAnalytics.tsx completo (estado actual)

**Archivo**: `src/features/creator/components/CreatorAnalytics.tsx`
**Usar para**: entender la estructura antes de modificar

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { SummaryCards } from './analytics/SummaryCards'
import { CallsChart } from './analytics/CallsChart'
import { AlertBanner } from './analytics/AlertBanner'

// ... interfaces ...

export function CreatorAnalytics({ agents }: Props) {
  const t = useTranslations('analytics')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [state, setState] = useState<State>({ status: 'loading', data: null })
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    const url = selectedAgentId
      ? `/api/creator/analytics?agent_id=${selectedAgentId}`
      : '/api/creator/analytics'

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<AnalyticsData>
      })
      .then(d => {
        if (activeRef.current) setState({ status: 'success', data: d })
      })
      .catch(() => {
        if (activeRef.current) setState({ status: 'error', data: null })
      })

    // ... interval polling ...
  }, [selectedAgentId])

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-gray-900">{t('title')}</h2>
        {/* dropdown */}
      </div>

      {state.status === 'loading' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 h-20 animate-pulse" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('errorLoading')}  {/* ← PROBLEMA: si t() falla por cualquier razón, caja vacía */}
        </div>
      )}

      {state.status === 'success' && state.data && (
        <>
          {state.data.alerts.length > 0 && <AlertBanner alerts={state.data.alerts} />}
          <SummaryCards summary={state.data.summary} />  {/* ← PROBLEMA: sin optional chaining */}
          <CallsChart series={state.data.dailySeries} />
          {state.data.summary.totalCalls === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
              <p className="text-sm text-gray-500">{t('empty_state')}</p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
```

### Exemplar 2: Claves i18n que existen en messages/es.json (NO agregar, solo referencia)

**Archivo**: `messages/es.json` (línea ~277)
**Estado**: completo — NO requiere modificación

```json
"analytics": {
  "title": "Analítica",
  "calls_24h": "Llamadas (24h)",
  "total_calls": "Total de llamadas",
  "avg_latency": "Latencia promedio",
  "uptime": "Uptime (24h)",
  "earnings": "Ganancias",
  "chart_title": "Llamadas por día",
  "alert_error_rate": "Alta tasa de error en {agent}. Revisa tu endpoint.",
  "alert_no_activity": "{agent} sin actividad en 7 días. ¿Está activo?",
  "empty_state": "Aún no hay llamadas. Comparte tu agente o intégralo via API.",
  "all_agents": "Todos los agentes",
  "errorLoading": "Error cargando analytics. Intenta recargar la página."
}
```

### Exemplar 3: Fix resultante en CreatorAnalytics.tsx (código final esperado)

**Sección a modificar — fetch catch y render del error + success:**

```tsx
// ── FETCH — agregar console.error para diagnóstico ──────────────────────────
    .catch((err) => {
      // Fix D: loguear el error para identificar la causa en production logs
      console.error('[CreatorAnalytics] fetch error:', err)
      if (activeRef.current) setState({ status: 'error', data: null })
    })

// ── RENDER ERROR — Fix B: fallback de texto ─────────────────────────────────
      {state.status === 'error' && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('errorLoading') || 'Error cargando analytics. Intenta recargar la página.'}
        </div>
      )}

// ── RENDER SUCCESS — Fix C: optional chaining en summary ───────────────────
      {state.status === 'success' && state.data?.summary && (
        <>
          {state.data.alerts.length > 0 && <AlertBanner alerts={state.data.alerts} />}
          <SummaryCards summary={state.data.summary} />
          <CallsChart series={state.data.dailySeries} />
          {state.data.summary.totalCalls === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
              <p className="text-sm text-gray-500">{t('empty_state') || 'Sin actividad aún.'}</p>
            </div>
          )}
        </>
      )}
```

**Patrón clave:**
- Fix B: `{t('errorLoading') || 'fallback texto'}` — el `||` garantiza texto visible si t() retorna string vacío
- Fix C: `state.data && (...)` → `state.data?.summary && (...)` — evita crash si API retorna shape inesperado
- Fix D: `console.error('[CreatorAnalytics] fetch error:', err)` en el catch — permite diagnosticar en DevTools/logs

## Pasos de diagnóstico obligatorios (W0 — ANTES de escribir código)

Dev DEBE ejecutar estos pasos y documentar el resultado:

### Paso D1: Verificar respuesta real de la API
Abrir DevTools → Network → navegar al creator dashboard → buscar `GET /api/creator/analytics`:
- ¿Retorna 200? → Anotar el payload (¿tiene `summary`, `dailySeries`, `alerts`?)
- ¿Retorna 401/403/404/500? → Hay un bug en el API route (escalar a Architect, no arreglar solo)

### Paso D2: Verificar estado del componente
En DevTools → Console → buscar errores de React o mensajes de `[CreatorAnalytics]`

### Paso D3: Verificar si el estado queda en 'loading' indefinidamente
Agregar temporalmente `console.log('[CreatorAnalytics] state:', state.status)` en el render y observar:
- ¿Cambia de 'loading' a 'success' o 'error'?
- ¿Se queda en 'loading' para siempre? → Puede ser un problema de CORS, cookies, o autenticación en el fetch

### Documentar el diagnóstico
Antes de escribir los fixes, anotar en el PR / en el reporte:
```
DIAGNÓSTICO WAS-64:
- API retorna: [200 / 4xx / 5xx]
- Estado final del componente: [loading / error / success]
- Causa raíz identificada: [descripción]
```

## Constraint Directives

### OBLIGATORIO
- Aplicar **Fix B** (fallback en error banner) y **Fix C** (optional chaining en success render) — siempre, independientemente del diagnóstico
- Aplicar **Fix D** (console.error en catch) — siempre, para permitir diagnóstico en producción
- Seguir el patrón de i18n existente: `t('key') || 'fallback'` — no crear nuevo mecanismo
- Ejecutar los pasos de diagnóstico D1/D2/D3 y documentar el resultado antes de hacer commit

### PROHIBIDO
- NO refactorizar `CreatorAnalytics.tsx` más allá de los 3 fixes descritos (B, C, D)
- NO tocar `CallsChart.tsx` — su lógica es correcta
- NO tocar `SummaryCards.tsx` — no es scope de este fix
- NO modificar `messages/es.json` ni `messages/en.json` — las claves ya existen y son correctas
- NO modificar la lógica de fetch, el polling interval ni el `activeRef`
- NO agregar dependencias nuevas (next-intl ya está instalado)
- NO cambiar el esquema de la API response en `route.ts`
- NO agregar recharts u otras librerías de gráficos — ADR-010 dice CSS bars
- NO tocar `WasiNavBar.tsx` ni ningún otro componente fuera del scope

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| N/A para este fix | — | — | — |

### Criterio Test-First

| Tipo de cambio | Test-first? |
|----------------|-------------|
| Fix B (fallback texto error) | No — es 1 operador `\|\|` |
| Fix C (optional chaining) | No — es 1 carácter `?` |
| Fix D (console.error en catch) | No — es logging para diagnóstico |

**No se requieren tests automáticos.** Verificación manual en el dashboard del creator.

## Waves

### Wave 0 (Serial — diagnóstico, obligatorio antes de cualquier código)
- [ ] W0.1: Abrir DevTools → Network → navegar a creator dashboard → inspeccionar `GET /api/creator/analytics` → anotar status code y payload
- [ ] W0.2: Inspeccionar Console → buscar errores de React o mensajes de red
- [ ] W0.3: Verificar si el componente queda en estado 'loading' o transiciona a 'error'/'success'
- [ ] W0.4: Documentar la causa raíz identificada

### Wave 1 (Implementación de fixes — después de W0)
- [ ] W1.1: **Fix B** — Agregar `|| 'fallback'` en el banner de error de `CreatorAnalytics.tsx`
- [ ] W1.2: **Fix C** — Cambiar `state.data &&` por `state.data?.summary &&` en el render de success
- [ ] W1.3: **Fix D** — Agregar `console.error('[CreatorAnalytics] fetch error:', err)` en el catch

### Wave 2 (Verificación)
- [ ] W2.1: `npm run type-check` o `tsc --noEmit` — confirmar sin errores TypeScript
- [ ] W2.2: Verificación visual manual — AC1 a AC5 en el creator dashboard
- [ ] W2.3: Si el diagnóstico W0 reveló una causa raíz adicional fuera del scope de este Story File → **escalar a Architect antes de continuar**

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | Diagnóstico documentado con causa raíz identificada |
| W1 | TypeScript compila sin errores |
| W2 | AC1–AC5 verificados manualmente en creator dashboard |

## Out of Scope

> Dev NO debe tocar esto bajo ninguna circunstancia.

- `messages/es.json` y `messages/en.json` — las claves i18n ya existen y son correctas
- `src/features/creator/components/analytics/CallsChart.tsx` — lógica correcta
- `src/features/creator/components/analytics/SummaryCards.tsx` — no es scope
- `src/features/creator/components/analytics/AlertBanner.tsx` — no es scope
- `src/app/api/creator/analytics/route.ts` — no modificar (solo diagnosticar la respuesta)
- `src/app/[locale]/layout.tsx` — NextIntlClientProvider ya está configurado
- `src/app/[locale]/creator/dashboard/page.tsx` — no modificar
- Cualquier refactor de la lógica de fetch o polling
- Cambios de diseño, nuevas métricas, nuevos componentes
- Lógica de auth, Supabase, o cualquier archivo no listado en Files to Modify

## DoD (Definition of Done)

- [ ] Pasos de diagnóstico D1/D2/D3 ejecutados y causa raíz documentada en PR
- [ ] `npm run type-check` pasa sin errores
- [ ] En creator dashboard autenticado: título "Analítica" visible y legible
- [ ] En creator dashboard autenticado: tarjetas de summary muestran números (aunque sean ceros)
- [ ] En creator dashboard autenticado: `CallsChart` renderiza barras CSS o mensaje de empty state
- [ ] Estado de error muestra texto explícito en rojo, nunca caja vacía
- [ ] Estado de carga muestra 5 skeleton loaders `animate-pulse`, nunca blanco
- [ ] Sin regresiones en mobile (verificar viewport móvil)
- [ ] AC1–AC5 verificados manualmente en Chrome desktop y mobile

## Escalation Rule

> **Si algo no está en este Story File, Dev PARA y pregunta a Architect.**
> No inventar. No asumir. No improvisar.

Situaciones de escalation **críticas** para este bug:
- El diagnóstico W0 revela que la API retorna 401 o 403 → problema de auth/RLS en Supabase — No tocar, escalar
- El diagnóstico W0 revela que la API retorna 404 → problema de routing o creator_profile inexistente — escalar
- El diagnóstico W0 revela que el estado queda en 'loading' para siempre sin error en Network → problema de fetch/cookies — escalar
- El shape de la respuesta de la API difiere de `AnalyticsData` (falta `summary`, `dailySeries` o `alerts`) — no adaptar el componente, escalar para corregir el API
- Los fixes B/C/D no resuelven el bug visible — documentar los resultados del diagnóstico y escalar

---

*Story File generado por NexusAgil — F2.5 — Architect — Sprint 9*
