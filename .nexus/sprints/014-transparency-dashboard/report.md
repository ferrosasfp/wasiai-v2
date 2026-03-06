# Report — SDD #014: Transparency Dashboard
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-74

## Resumen
Se creó la página pública `/en/transparency` con métricas reales del protocolo leídas directamente del contrato on-chain: volumen total USDC, invocaciones totales y platformFeeBps. Incluye tabla con top 5 agentes por número de llamadas con revenue estimado. La página usa ISR con `revalidate = 60` para rendimiento < 2s.

Se agregó un footer (`WasiFooter`) en el layout principal con link a la página de transparencia, visible desde cualquier página del sitio. Se incluyeron traducciones i18n en inglés y español.

## Archivos principales
- `src/app/[locale]/transparency/page.tsx` (nuevo — Server Component ISR)
- `src/components/WasiFooter.tsx` (nuevo)
- `src/app/[locale]/layout.tsx` (modificado — agrega footer)
- `messages/en.json` (modificado — keys de transparency)
- `messages/es.json` (modificado — keys de transparency)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
