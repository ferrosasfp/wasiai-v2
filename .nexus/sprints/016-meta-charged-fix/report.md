# Report — SDD #016: meta.charged = totalPrice
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-116

## Resumen
Se corrigió `meta.charged` en la respuesta de invocaciones para reflejar el `totalPrice` real (creator_price + platform_overhead) en vez del `price_per_call` histórico. Se agregó `meta.charged_breakdown: { creator, overhead }` para desglose del cargo. En caso de error, `meta.charged = 0`.

Se hizo bump del SDK `@wasiai/sdk` a versión 0.2.1 con CHANGELOG documentando el cambio de semántica de `meta.charged` y la guía de migración para developers.

## Archivos principales
- `src/app/api/v1/models/[slug]/invoke/route.ts` (modificado — buildResponse)
- `wasiai-sdk/package.json` (bump a 0.2.1)
- `wasiai-sdk/CHANGELOG.md` (nuevo/actualizado)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
