# Work Item #002 — [BUG] Analytics completamente vacío (web y mobile)

> Fecha: 2026-02-27
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/002-analytics-vacio
> Artefactos: doc/sdd/002-analytics-vacio/

---

## Work Item #002

| Campo | Valor |
|-------|-------|
| **#** | 002 |
| **Tipo** | bugfix |
| **SDD_MODE** | bugfix |
| **Objetivo** | Identificar la causa raíz por la cual el creator dashboard muestra tarjetas de analytics completamente vacías (sin títulos, métricas ni gráficos) en web y mobile, y corregirla de forma que los datos reales se rendericen correctamente desde la API `/api/creator/analytics`. |
| **Actual vs Esperado** | **Actual:** Las tarjetas de analytics en el creator dashboard están completamente vacías — sin títulos, sin métricas numéricas, sin gráficos. El problema persiste en web y mobile después de un hotfix previo (`force-dynamic`). **Esperado:** Las tarjetas muestran métricas reales (total calls, revenue, agentes activos), el gráfico `CallsChart` renderiza barras con datos reales del período, y en ausencia de datos se muestra un estado vacío con mensaje informativo. |
| **Scope IN** | Diagnóstico y fix del pipeline de datos analytics: API route `/api/creator/analytics`, componente `CreatorAnalytics.tsx`, componente `CallsChart.tsx`. |
| **Scope OUT** | Rediseño visual del dashboard, nuevas métricas no existentes, cambios a otras secciones del creator dashboard, modificación del modelo de datos de `agent_calls`. |
| **Missing Inputs** | N/A |

---

## Acceptance Criteria (EARS)

1. **WHEN** un creator autenticado abre su dashboard, **THE** sección de analytics **SHALL** mostrar al menos los valores numéricos de total calls, revenue total y agentes activos — aunque sean cero si no hay actividad.

2. **WHEN** el endpoint `/api/creator/analytics` retorna datos válidos, **THE** componente `CreatorAnalytics` **SHALL** propagar esos datos al componente `CallsChart` y este **SHALL** renderizar las barras CSS correspondientes al período seleccionado.

3. **IF** `/api/creator/analytics` retorna un error HTTP (4xx/5xx) o un payload malformado, **THEN THE** dashboard **SHALL** mostrar un estado de error explícito con mensaje al usuario en lugar de tarjetas vacías silenciosas.

4. **WHILE** los datos de analytics están cargando, **THE** tarjetas **SHALL** mostrar un skeleton loader visible, no contenido en blanco.

5. **WHEN** el creator no tiene ninguna llamada registrada, **THE** sección de analytics **SHALL** mostrar ceros con un mensaje "Sin actividad aún" — nunca tarjetas completamente vacías sin texto.

---

## Repro Steps

1. Autenticarse como creator
2. Navegar al creator dashboard (web desktop y mobile)
3. **Actual:** Las tarjetas de la sección analytics están completamente vacías — sin títulos, sin números, sin gráfico

---

## Archivos probables

| Archivo | Rol probable |
|---------|-------------|
| `src/app/api/creator/analytics/route.ts` | API route — puede estar fallando silenciosamente, retornando shape incorrecto, o teniendo error de auth |
| `src/features/creator/components/CreatorAnalytics.tsx` | Consumidor de la API — puede no estar manejando correctamente la respuesta o pasando props incorrectas a `CallsChart` |
| `src/features/creator/components/analytics/CallsChart.tsx` | Gráfico de barras CSS (ADR-010) — puede fallar si recibe datos vacíos sin guard |

---

## Contexto relevante (ADRs)

- **ADR-007**: Métricas fake = 0. No datos simulados en producción — si la API falla, se muestra 0, no datos inventados.
- **ADR-010**: `CallsChart` usa barras CSS (sin recharts). Si recibe array vacío puede no renderizar nada.
- Columnas críticas: `agent_calls.status`, `agent_calls.latency_ms`, `creator_profiles.id = auth.users.id` (sin columna `user_id` separada).

---

## Sizing

| Dimensión | Estimación |
|-----------|-----------|
| Archivos a modificar | 2–3 |
| Complejidad | Media–Alta (causa raíz desconocida, requiere investigación) |
| Esfuerzo estimado | 4–8 horas |
| Riesgo de regresión | Medio (toca API y componentes de dashboard) |

---

*Work Item generado por NexusAgil — Analyst + Architect — Sprint 9*
