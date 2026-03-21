# WAS-259 — Reputation endpoint: 7 awaits secuenciales → Promise.all

**Tipo:** improvement  
**Clasificación:** FAST-FIX  
**Fecha:** 2026-03-20  
**Archivo:** `src/app/api/v1/agents/[slug]/reputation/route.ts`

## Problema

El handler GET del endpoint `/api/v1/agents/[slug]/reputation` ejecuta 7 queries a Supabase de forma secuencial. Dado que la mayoría son independientes entre sí (o solo dependen de `agent.id`), el tiempo de respuesta es la suma de todas las latencias en vez del máximo.

## Solución

Reorganizar en 2 olas de Promise.all:

**Ola 1 — Paralelo (independientes entre sí):**
- `agent` query (necesita `slug`)
- `windowSetting` query (no depende de nada)

**Ola 2 — Paralelo (todas necesitan `agent.id` y `availableWindowDays`):**
- `metricsRaw` (RPC `get_agent_percentile_metrics`)
- `lastCall` (última invocación)
- `recentCalls` (actividad reciente en ventana configurable)
- `callsBreakdown` (calls últimos 30 días)
- `calcTrend` (función async, necesita `agent.id`)

## Acceptance Criteria

- AC1: Ola 1 SHALL run agent + windowSetting via Promise.all
- AC2: Ola 2 SHALL run metricsRaw + lastCall + recentCalls + callsBreakdown + calcTrend via Promise.all
- AC3: IF agent not found AFTER Ola 1 SHALL return 404 (gate entre olas)
- AC4: All downstream logic SHALL remain identical (no behavioral changes)
- AC5: TypeScript build SHALL pass

## Archivos a modificar

- `src/app/api/v1/agents/[slug]/reputation/route.ts`

## Rollback

`git revert` del commit. Cambio es puramente estructural, sin efecto en schema ni DB.
