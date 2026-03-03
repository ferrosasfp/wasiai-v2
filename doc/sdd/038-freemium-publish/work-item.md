# Work Item #038 — WAS-131: Freemium publish con listing fee x402 real

| Campo | Valor |
|-------|-------|
| **#** | 038 |
| **HU** | WAS-131 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Modelo freemium: primer agente gratis, segundo en adelante paga listing fee real en USDC vía EIP-712. Fee configurable en system_config sin redeploy. |
| **Scope IN** | migration 035 · publish-gate/route.ts · listing-fee-pay/route.ts · PublishForm.tsx · ListingFeeModal.tsx |
| **Scope OUT** | register/route.ts, invoke/route.ts, flujo Agent Key, contratos on-chain |
| **Gate 1** | HU_APPROVED — 2026-03-03 |
| **Gate 2** | SPEC_APPROVED — 2026-03-03 |

## Acceptance Criteria (EARS)

- AC1: WHEN creator publica primer agente (0 agentes con status IN ('active','reviewing')), THE flujo SHALL ser idéntico al actual
- AC2: WHEN creator publica segundo agente o más, THE UI SHALL mostrar listing_fee_usdc y requerir firma EIP-712
- AC3: WHEN listing_fee_usdc = 0 en system_config, THE sistema SHALL omitir firma y publicar directo
- AC4: WHEN creator no tiene wallet y fee > 0, THE UI SHALL solicitar configurar wallet
- AC5: WHEN transferencia USDC exitosa, THE agente SHALL activarse
- AC6: WHEN transferencia USDC falla, THE agente SHALL permanecer en draft con error claro
