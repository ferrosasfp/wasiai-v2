# Work Item #036 — WAS-134: Facilitador x402 propio en mainnet

| Campo | Valor |
|-------|-------|
| **#** | 036 |
| **HU** | WAS-134 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Extender usdcSettler.ts para ser el facilitador x402 en mainnet, eliminando la dependencia de FacilitatorClient (UltravioletaDAO). settlePaymentDirectly() ya soporta ambas chains — solo hay que unificar el routing en settleX402() e inlinar las utilidades del SDK. |
| **Scope IN** | invoke/route.ts · usdcSettler.ts (comentario) · .env.example |
| **Scope OUT** | marketplaceClient.ts, flujo Agent Key, usdcSettler lógica de firma, package.json |
| **Gate 1** | HU_APPROVED — 2026-03-03 |
| **Gate 2** | SPEC_APPROVED — 2026-03-03 |

## Acceptance Criteria (EARS)

- AC1: WHEN chainId es 43114 (mainnet), THE sistema SHALL usar settlePaymentDirectly() en lugar de FacilitatorClient
- AC2: WHEN chainId es 43113 (Fuji), THE comportamiento SHALL ser idéntico al actual
- AC3: IF el import de uvd-x402-sdk se elimina de invoke/route.ts, THE build SHALL pasar sin errores TS
- AC4: WHEN X402_FACILITATOR_URL está en .env.example, THE variable SHALL estar marcada como deprecated
