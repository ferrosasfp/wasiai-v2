# Report — SDD #011: Sentry error tracking en WasiAI
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-01
**Issue:** WAS-68

## Resumen
Se instaló y configuró `@sentry/nextjs` para captura automática de errores en producción (server, client y edge). La configuración es fail-silent: si `SENTRY_DSN` no está definido, la app arranca sin errores. Session replay está deshabilitado por privacidad (`replaysSessionSampleRate: 0`).

Source maps se suben a Sentry durante el build de Vercel con `hideSourceMaps: true` para que no sean accesibles públicamente. Se agregaron las variables de entorno necesarias a `.env.local.example`.

## Archivos principales
- `sentry.server.config.ts`
- `sentry.client.config.ts`
- `sentry.edge.config.ts`
- `instrumentation.ts` (modificado)
- `next.config.mjs` (modificado — wrapeado con `withSentryConfig`)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
