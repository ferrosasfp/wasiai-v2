# Report — SDD #047: EPIC Dual Registration Off-chain + On-chain (ERC-8004)
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-05
**Issue:** WAS-160

## Resumen
Se implementó el modelo de registro dual para agentes WasiAI: registro off-chain gratuito (solo Supabase) como default para creators sin wallet, y registro on-chain opcional (ERC-8004, gas pagado por creator) para creators con wallet conectada. Los agentes off-chain mantienen funcionalidad completa (discovery, invocación, pagos, keys). Se creó un flujo de upgrade voluntario de off-chain a on-chain con modal de estimación de gas, confirmación de wallet, y minteo de token ERC-8004. Los agentes on-chain reciben badge "On-chain Verified" y boost de ranking en discovery. El EPIC se dividió en múltiples story-files (160a-160g) cubriendo: detección de wallet, 3 paths de registro, upgrade modal, badge UI, discovery boost, y migración de schema.

## Archivos principales
- `src/app/api/creator/agents/[slug]/status/route.ts` — lógica de registro condicional
- `src/app/api/v1/agents/register/route.ts` — registro API con path dual
- `src/lib/contracts/marketplaceClient.ts` — `registerAgentOnChain()`
- `src/app/[locale]/publish/PublishForm.tsx` — detección de wallet y elección on/off-chain
- `src/app/api/v1/agents/discover/route.ts` — boost on-chain en discovery
- `src/features/models/types/models.types.ts` — tipo Agent con `registration_type`
- `supabase/migrations/` — schema migration para campos dual registration

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
