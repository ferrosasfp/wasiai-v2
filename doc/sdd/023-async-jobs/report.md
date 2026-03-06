# Report — SDD #023: Async Jobs
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-103

## Resumen
Se implementó un sistema de jobs asíncronos para pipelines complejos o agentes lentos que no pueden responder dentro del timeout de 60s de Vercel. La arquitectura usa Supabase como persistencia con polling: `POST /api/v1/jobs` inserta el job y retorna `jobId` en < 500ms, mientras el procesamiento ocurre non-blocking en la misma request. `GET /api/v1/jobs/:id` consulta el estado (pending, processing, completed, failed).

Se incluyó migración SQL con tabla `jobs` con RLS, índices para queries por usuario/status, y una ruta de cleanup para marcar como fallidos los jobs en estado `processing` por más de 5 minutos (limitación conocida de Vercel serverless).

## Archivos principales
- `supabase/migrations/027_async_jobs.sql` (nuevo)
- `src/app/api/v1/jobs/route.ts` (nuevo — POST)
- `src/app/api/v1/jobs/[id]/route.ts` (nuevo — GET)
- `src/app/api/v1/admin/jobs/cleanup/route.ts` (nuevo)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
