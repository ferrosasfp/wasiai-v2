# Work Item #037 — WAS-133: Gas fee dinámico x402 + banner WasiAI Key

| Campo | Valor |
|-------|-------|
| **#** | 037 |
| **HU** | WAS-133 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Mostrar el gas fee dinámico (Chainlink) en la UI del detail page antes de invocar vía x402, y mostrar el banner WasiAI Key con el copy aprobado para usuarios sin key. |
| **Scope IN** | pricing/route.ts (nueva) · models/[slug]/page.tsx · PricingBadge.tsx (nuevo) · WasiKeyBanner.tsx (nuevo) · messages/en.json · messages/es.json |
| **Scope OUT** | overhead.ts, chainlink.ts, invoke/route.ts, flujo Agent Key, flujo de pagos |
| **Gate 1** | HU_APPROVED — 2026-03-03 (con observaciones San) |
| **Gate 2** | SPEC_APPROVED — 2026-03-03 |

## Acceptance Criteria (EARS)

- AC1: WHEN un usuario visita el detail page con price_per_call > 0, THE UI SHALL mostrar el precio total estimado (creator price + gas fee) calculado con Chainlink en tiempo real
- AC2: WHEN el gas fee no puede calcularse (Chainlink down), THE UI SHALL mostrar el precio base sin gas fee (fail-open)
- AC3: WHEN el usuario no tiene WasiAI Key activa, THE detail page SHALL mostrar el banner con copy aprobado
- AC4: WHEN el usuario tiene WasiAI Key activa, THE banner SHALL no mostrarse
