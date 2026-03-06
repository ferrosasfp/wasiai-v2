# Report — SDD #024: Circuit Breaker
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-103

## Resumen
Se implementó un circuit breaker con 3 estados (closed, open, half-open) para proteger contra fallos de proveedores externos (OpenAI, Anthropic, etc.). El estado persiste en Upstash Redis (no en memoria) porque Vercel mata procesos entre requests. Umbral: 5 fallos consecutivos en 120s → open; después de 30s → half-open permite 1 request de prueba.

Se expuso `wrapWithCircuitBreaker<T>()` como wrapper genérico para cualquier llamada a proveedor, y APIs admin para consultar estados (`GET /api/v1/admin/circuit-breakers`) y reset manual (`POST /api/v1/admin/circuit-breakers/:id/reset`).

## Archivos principales
- `src/lib/circuit-breaker/CircuitBreaker.ts` (nuevo)
- `src/app/api/v1/admin/circuit-breakers/route.ts` (nuevo — GET)
- `src/app/api/v1/admin/circuit-breakers/[id]/reset/route.ts` (nuevo — POST)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
