# WAS-248 — Work Item

**Tipo:** BUG FIX | **Clasificación:** HU-MINOR

## Root Cause

`search_agents` RPC usa `websearch_to_tsquery('simple', query)`. El diccionario `simple` solo normaliza a minúsculas — no entiende español. `precio` no matchea `price`, `riesgo` no matchea `risk`. Además el FTS no hace matching parcial en descripciones largas.

## Fix

Añadir un **fallback ILIKE** en el handler de Next.js cuando FTS retorna 0 resultados: buscar `q` como substring en `name`, `description` y `tags` usando `.or('name.ilike.%q%,description.ilike.%q%')`.

No requiere migración DB. No toca la función `search_agents`.

## ACs
- AC-01: `q=precio` → retorna resultados que contengan "price" si existen (fallback ILIKE)
- AC-02: `q=riesgo` → retorna resultados con "risk" en nombre/descripción
- AC-03: `q=oracle` → sigue funcionando (FTS primero, ILIKE como fallback)
- AC-04: `q=chainlink` → sigue retornando los 3 agentes actuales
- AC-05: Resultados del fallback incluyen `search_method: "fallback_ilike"` en el response (para debug)
- AC-06: Fallback solo activa cuando FTS retorna 0 resultados (no siempre)
- AC-07: Rate limit y paginación se preservan

## Files
- `src/app/api/v1/agents/route.ts` — MODIFY (añadir fallback ILIKE)
