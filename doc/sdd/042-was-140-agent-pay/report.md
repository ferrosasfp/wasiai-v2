# Report — SDD #042: Pagos autónomos agente→agente
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-04
**Issue:** WAS-140

## Resumen
Se implementó el flujo de pagos autónomos agente→agente en Fuji (1 hop): un agente con wallet propia puede descubrir, pagar e invocar otro agente automáticamente via x402. El flujo probe → sign ERC-3009 → invoke con X-PAYMENT permite que agentes operen de forma autónoma sin intervención humana.

Se crearon `agentPay.ts` con tipos tipados (`AgentPayError` con códigos específicos), `signAgentPayment` para firma EIP-712 con dominio USDC exacto, e `invokeAgentWithPayment` con balance check previo al probe. La ruta `POST /api/v1/agents/[slug]/invoke-agent` acepta autenticación via `x-agent-key` del creator.

## Archivos principales
- `src/lib/agent-wallets/agentPay.ts` (nuevo)
- `src/app/api/v1/agents/[slug]/invoke-agent/route.ts` (nuevo)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
