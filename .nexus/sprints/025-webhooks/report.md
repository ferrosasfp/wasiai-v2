# Report — SDD #025: Webhooks y eventos para agentes
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-82

## Resumen
Se implementó la Fase 1 del sistema de webhooks: CRUD completo de endpoints (max 5 por usuario free tier), delivery con firma HMAC-SHA256 en header `X-WasiAI-Signature`, y evento `credits.low` que se dispara cuando el balance del usuario baja de un umbral. Incluye endpoint de test para verificar la conectividad del webhook.

Se crearon las tablas `webhooks` y `webhook_deliveries` en Supabase con RLS, el servicio `deliverWebhook` con timeout de 10s y fire-and-forget, y validación de HTTPS obligatorio en producción. La Fase 2 (eventos job.completed/job.failed) queda fuera de scope como trabajo separado post-WAS-70.

## Archivos principales
- `supabase/migrations/028_webhooks.sql` (nuevo)
- `src/lib/webhooks/deliverWebhook.ts` (nuevo)
- `src/lib/webhooks/triggerCreditsLow.ts` (nuevo)
- `src/app/api/v1/webhooks/route.ts` (nuevo — GET + POST)
- `src/app/api/v1/webhooks/[id]/route.ts` (nuevo — PUT + DELETE)
- `src/app/api/v1/webhooks/[id]/test/route.ts` (nuevo — POST)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
