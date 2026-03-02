# Report — HU-019 / WAS-70: Ejecución Asíncrona de Pipelines (Jobs + Polling)

**Fecha:** 2026-03-02  
**Sprint:** 15 | **Modo:** QUALITY  
**Issue Linear:** WAS-70

---

## Archivos Creados/Modificados

| Archivo | Acción |
|---------|--------|
| `src/app/api/v1/jobs/route.ts` | Creado — POST crear job |
| `src/app/api/v1/jobs/[id]/route.ts` | Creado — GET polling estado job |
| `src/app/api/v1/jobs/process/[id]/route.ts` | Creado — POST processor interno |
| `src/lib/events.ts` | Modificado — `job.completed`, `job.failed` agregados |
| `supabase/migrations/*_jobs.sql` | Creado — tabla `agent_jobs` |

---

## ACs Status

| AC | Descripción | Estado |
|----|-------------|--------|
| AC-01 | POST /api/v1/jobs → 201 + jobId/status/createdAt | ✅ PASS |
| AC-02 | Agent no encontrado/inactivo → 404 | ✅ PASS |
| AC-03 | Body incompleto → 400 | ✅ PASS |
| AC-04 | Sin auth → 401 | ✅ PASS |
| AC-05 | Processor: pending→processing→completed/failed | ✅ PASS |
| AC-06 | Job completa → webhook job.completed (best-effort) | ✅ PASS |
| AC-07 | Job falla → webhook job.failed + error en columna | ✅ PASS |
| AC-08 | Process sobre job no-pending → 409 (claim atómico) | ✅ PASS |
| AC-09 | Authorization inválido en process → 401 | ✅ PASS |

**Score: 9/9 PASS**

---

## AR Summary

| Bloqueante | Descripción | Resolución |
|------------|-------------|------------|
| B-01 | Rate limit faltante en POST /jobs | Corregido — `checkRateLimit` aplicado |
| B-02 | Race condition en UPDATE final (doble ejecución) | Corregido — claim atómico `WHERE status='pending'` + 409 |

2 BLOQUEANTEs encontrados y resueltos antes de QA final.

---

## Build Final

```
npx tsc --noEmit → ✅ 0 errores
QA: 9/9 PASS
```

**Estado: DONE ✅**
