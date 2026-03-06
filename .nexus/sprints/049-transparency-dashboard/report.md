# Report — SDD #049: Transparency Dashboard — on-chain economics
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-05
**Issue:** WAS-162

## Resumen
Se implementó un dashboard de transparencia económica que lee datos directamente del contrato WasiAIMarketplace (funciones view) y los muestra en dos superficies: un footer compacto en todas las páginas (volumen total, invocaciones totales, fee del marketplace) y una página dedicada `/transparency` con stats globales y lista de agentes on-chain con precio. Se creó una API route server-side con cache ISR de 60 segundos para evitar RPC calls directos desde el browser. El componente `OnChainStats` consume la API cacheada. Si la llamada al contrato falla, se muestra "—" sin romper la página. Se incluyó botón refresh para actualización inmediata.

## Archivos principales
- `src/app/api/transparency/stats/route.ts` — API cacheada (ISR 60s)
- `src/components/transparency/OnChainStats.tsx` — componente cliente
- `src/app/[locale]/transparency/page.tsx` — server component
- `src/app/[locale]/transparency/TransparencyDashboard.tsx` — client dashboard
- `src/lib/contracts/config.ts` — helper `getContractAddress()`
- `src/lib/contracts/WasiAIMarketplace.ts` — `fromUSDCAtomics()`
- `messages/en.json`, `messages/es.json` — i18n keys

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
