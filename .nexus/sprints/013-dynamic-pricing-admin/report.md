# Report — SDD #013: Modelo de precios dinámico + Panel Admin
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-73

## Resumen
Se separó `price_per_call` en `creator_price` (estático) + `platform_overhead` (dinámico calculado con Chainlink AVAX/USD + gasPrice). El overhead se calcula en tiempo real con cache Redis (TTL 60s) y es fail-open: si Chainlink o gasPrice fallan, overhead = 0 y las llamadas nunca se bloquean.

Se creó el panel admin `/en/admin` como centro de control operativo con verificación por wallet (owner/operator): fees on-chain, balances AVAX, toggle Vercel/Chainlink para settlement, y settlement manual. Incluye circuit breaker automático si el overhead supera al creator_price (503 + Retry-After).

## Archivos principales
- `supabase/migrations/026_creator_price_overhead.sql`
- `src/lib/pricing/overhead.ts`
- `src/app/api/v1/models/[slug]/invoke/route.ts` (modificado)
- `src/app/[locale]/admin/page.tsx` (nuevo)
- `src/app/[locale]/admin/layout.tsx` (nuevo)
- `src/app/api/admin/fee/route.ts` (nuevo)
- `src/app/api/admin/settlement/route.ts` (nuevo)
- `src/app/api/admin/status/route.ts` (nuevo)
- `src/app/api/cron/settle-key-batches/route.ts` (modificado)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
