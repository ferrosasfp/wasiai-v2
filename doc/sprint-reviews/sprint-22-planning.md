# Sprint 22 — Planning
**Fecha:** 2026-03-04  
**Goal:** Pagos autónomos agente→agente (Fuji, 1 hop)

## HUs del Sprint

| HU | Descripción | Tamaño | Modo |
|----|-------------|--------|------|
| WAS-140 | Pagos autónomos agente→agente — wallet del agente paga servicios de otros agentes | XL | QUALITY |

## Waves WAS-140

| # | Wave | Entregable |
|---|------|------------|
| 1 | agentPay.ts | `invokeAgentWithPayment()` — EIP-712 firma server-side con agentWalletClient |
| 2 | invoke-agent endpoint | `POST /api/v1/agents/[slug]/invoke-agent` |
| 3 | Balance guard | Verificar USDC suficiente antes de firmar |
| 4 | Error handling | insufficient_balance, timeout, sig_failed |
| 5 | Tests | Unit tests + mock Fuji |

## Fundamentos ya existentes
- `getAgentWalletClient()` — listo en agentWallet.ts (Fase 1)
- `logCall(caller_type='agent')` — schema BD ya soporta A2A
- `settlePaymentDirectly()` — WAS-134, settlement on-chain funcional
- EIP-712 signing — portarlo de useWalletPayment.ts (client) a server-side

## Velocidad referencial
- Sprint 21: 4 HUs
- Sprint 22: 1 HU XL (sprint dedicado)
