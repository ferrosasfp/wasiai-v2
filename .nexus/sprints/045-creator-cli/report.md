# Report — SDD #045: Creator CLI — wasiai discover + publish + stats
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-05
**Issue:** WAS-154

## Resumen
Se agregaron tres subcomandos al CLI existente en wasiai-sdk: `wasiai discover` (búsqueda pública de agentes por categoría/precio), `wasiai publish` (registro de agentes vía API con autenticación por API key), y `wasiai stats` (estadísticas del creator). Cada subcomando soporta `--output json` para integración programática. En el backend se creó el endpoint `GET /api/v1/creator/stats` con autenticación vía header `x-agent-key` y validación Zod. Los módulos SDK siguen el patrón existente de `invoke.ts` con `DEFAULT_BASE_URL` y clases de error compartidas.

## Archivos principales
- `wasiai-sdk/src/discover.ts` — módulo de descubrimiento
- `wasiai-sdk/src/publish.ts` — módulo de publicación
- `wasiai-sdk/src/stats.ts` — módulo de estadísticas
- `wasiai-sdk/src/cli/index.ts` — registro de subcomandos
- `wasiai-v2/src/app/api/v1/creator/stats/route.ts` — endpoint backend

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
