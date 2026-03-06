# Story File — SDD-042 WAS-140
**Pagos autónomos agente→agente (Fuji, 1 hop)**  
**Fecha:** 2026-03-04 | **Modo:** QUALITY

## Archivos a crear
1. `src/lib/agent-wallets/agentPay.ts`
2. `src/app/api/v1/agents/[slug]/invoke-agent/route.ts`

## Archivos de referencia (NO modificar)
- `src/lib/agent-wallets/agentWallet.ts` — getAgentWalletClient, getAgentWalletUsdcBalance
- `src/lib/contracts/usdcSettler.ts` — USDC_DOMAIN, TRANSFER_TYPES (copiar exacto)
- `src/app/api/v1/models/[slug]/invoke/route.ts` — formato X-PAYMENT, logCall pattern
- `src/lib/constants.ts` — SITE_URL

## Wave 1 — agentPay.ts: tipos + signAgentPayment

```ts
// Tipos
interface Requirements402 {
  maxAmountRequired: string  // atomic USDC units
  payTo: string              // marketplace contract
  asset: string              // USDC address
  network: string
  scheme: string
}

class AgentPayError extends Error {
  code: 'no_agent_wallet' | 'insufficient_balance' | 
        'target_not_found' | 'payment_failed' | 'probe_failed'
}

// signAgentPayment(agentId, requirements, callerAddress)
// - walletClient = getAgentWalletClient(agentId)
// - nonce = 0x + crypto.randomBytes(32).toString('hex')
// - validBefore = Math.floor(Date.now()/1000) + 300
// - signTypedData con USDC_DOMAIN exacto de usdcSettler
// - retorna X-PAYMENT header base64
```

## Wave 2 — agentPay.ts: invokeAgentWithPayment

```ts
// invokeAgentWithPayment(callerAgentId, targetSlug, input)
// 1. getAgentWalletAddress(callerAgentId) → null → AgentPayError('no_agent_wallet')
// 2. getAgentWalletUsdcBalance(address) → parse → check
// 3. Probe: POST SITE_URL/api/v1/models/[targetSlug]/invoke sin header
//    → si status !== 402 → AgentPayError('probe_failed')
// 4. requirements = await probeRes.json()
// 5. Balance check: balanceUsdc < parseFloat(requirements.maxAmountRequired)/1e6
//    → AgentPayError('insufficient_balance')
// 6. paymentHeader = await signAgentPayment(callerAgentId, requirements, address)
// 7. Retry POST con X-PAYMENT: btoa(JSON.stringify(paymentHeader))
// 8. Retornar { result, meta, receipt } o AgentPayError('payment_failed')
```

## Wave 3 — invoke-agent/route.ts

```ts
// POST /api/v1/agents/[slug]/invoke-agent
// Body: { targetSlug: string, input: string }
// Auth: x-agent-key (creator key) → lookup → ownership check

// 1. rawKey = headers.get('x-agent-key') → hash → lookup agent_keys
// 2. Lookup agents WHERE slug=[slug] AND creator_id matches key owner
// 3. Lookup target agent: active?
// 4. invokeAgentWithPayment(caller.id, targetSlug, input)
// 5. Map AgentPayError codes → HTTP:
//    no_agent_wallet → 402
//    insufficient_balance → 402
//    target_not_found → 404
//    probe_failed → 502
//    payment_failed → 502
```

## Wave 4 — Tests

```ts
// src/app/api/v1/agents/__tests__/invoke-agent.test.ts
// Mocks: agentPay, supabase, agentWallet
// Tests:
// - 401 sin x-agent-key
// - 404 caller no encontrado
// - 402 no_agent_wallet
// - 402 insufficient_balance  
// - 200 éxito con result + meta
// - 502 payment_failed
```

## Constraint Directives
- CD-1: USDC_DOMAIN = { name:'USD Coin', version:'2', chainId:CHAIN_ID_NUM, verifyingContract:USDC_ADDR }
- CD-2: No reimplementar getAgentWalletClient — importar de agentWallet.ts
- CD-3: Probe es POST (no GET)
- CD-4: X-PAYMENT = btoa(JSON.stringify(paymentHeader)) — igual que useWalletPayment.ts:164
- CD-5: Balance check ANTES del probe
- CD-6: AgentPayError con códigos tipados
- CD-7: SITE_URL de @/lib/constants
- CD-8: caller_agent_id en logCall = slug del agente invocador
- CD-9: Requirements402 type tiene maxAmountRequired, payTo, asset, network, scheme
- CD-10: Auth = x-agent-key del creator (no sesión Supabase)

## ACs
- AC-1: USDC suficiente → pago exitoso → { result, meta.tx_hash }
- AC-2: Sin wallet → 402 insufficient_agent_balance
- AC-3: USDC insuficiente → 402 insufficient_agent_balance
- AC-4: targetSlug no activo → 404
- AC-5: Firma EIP-712 fallida → 502
- AC-6: logCall caller_type='agent' registrado
