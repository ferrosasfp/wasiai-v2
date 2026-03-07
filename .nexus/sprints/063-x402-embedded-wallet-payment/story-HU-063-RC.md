# Story File — #063-RC: Route C — USDC.transfer + tx hash verification (Smart Accounts)

> SDD: .nexus/sprints/063-x402-embedded-wallet-payment/sdd.md
> Plan: .claude/plans/velvet-giggling-tiger.md
> Fecha: 2026-03-07
> Branch: claude/eloquent-jones

---

## Goal

Habilitar pagos x402 para thirdweb embedded wallets (smart accounts via Google/email login) usando USDC.transfer directo + verificacion on-chain del tx hash. Los EOA wallets (Core, MetaMask) siguen usando EIP-3009 sin cambios.

## Acceptance Criteria (EARS)

1. WHEN un usuario con thirdweb embedded wallet (smart account) invoca un agente pagado, THE sistema SHALL ejecutar `USDC.transfer(operator, amount)` directamente (1 firma, gas sponsored) y enviar el tx hash al server via header `X-PAYMENT-TX`.

2. WHEN el server recibe un header `X-PAYMENT-TX`, THE sistema SHALL verificar on-chain que existe un Transfer event de USDC al OPERATOR_ADDRESS por amount >= totalPrice, usando `verifyUsdcTransfer()`.

3. WHEN el server recibe un `X-PAYMENT-TX` con un tx_hash ya usado, THE sistema SHALL rechazar con HTTP 402 y code `payment_replay`.

4. WHEN un usuario con EOA wallet (Core, MetaMask) invoca un agente pagado, THE sistema SHALL seguir usando EIP-3009 (sin cambios, sin regresion).

5. IF el Transfer event no se encuentra en 15 segundos o amount < required, THEN THE sistema SHALL rechazar con HTTP 402 y code `payment_invalid`.

## Files to Modify/Create

| # | Archivo | Accion | Que hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 0 | `supabase/migrations/020_unique_tx_hash.sql` | Crear | UNIQUE partial index en agent_calls.tx_hash | Migration 012_key_receipts.sql |
| 1 | `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Agregar Route C handler (X-PAYMENT-TX) antes de Route B, import verifyUsdcTransfer, CORS header | Route B existente (linea 359-411) |
| 2 | `src/features/payments/hooks/useWalletPayment.ts` | Modificar | Detectar isThirdweb, USDC.transfer directo, enviar X-PAYMENT-TX, estado transferring | Flujo EIP-3009 existente (linea 74-206) |

## Exemplars

### Exemplar 1: Route B (x402 EIP-3009 settlement) — server-side
**Archivo**: `src/app/api/v1/models/[slug]/invoke/route.ts` lineas 359-411
**Usar para**: Archivo #1 (Route C handler)
**Patron clave**:
- Header extraction: `request.headers.get('x-payment-tx')`
- Verification → error response con status 402 y code
- Post-settlement: `callUpstream()` → `logCall()` → `triggerAgentEvent()` → `buildResponse()`
- txHash se pasa a `logCall()` como cuarto argumento y a `buildResponse()` como tercer argumento

### Exemplar 2: EIP-3009 signing flow — client-side
**Archivo**: `src/features/payments/hooks/useWalletPayment.ts` lineas 74-206
**Usar para**: Archivo #2 (smart account transfer branch)
**Patron clave**:
- Probe del endpoint (lineas 78-103): fetch sin headers de pago, check status 402
- Parse requirements (linea 105-107)
- State transitions: `setFlowState('signing_eip3009')` → try/catch → success/error
- Response handling (lineas 173-181): parse JSON, setResult, setTxHash, setFlowState
- Error handling (lineas 183-205): check code 4001 (user cancel), technical failures

### Exemplar 3: verifyUsdcTransfer — ya implementado
**Archivo**: `src/lib/contracts/verifyUsdcTransfer.ts` (105 lineas)
**Usar para**: Archivo #1 (import y llamada)
**Patron clave**:
- `verifyUsdcTransfer(txHash: string, expectedAmountUsdc: number)` → `{ verified: boolean; from?: string; error?: string }`
- Verifica: receipt.status === 'success', Transfer event a OPERATOR_ADDRESS, amount >= expected
- Retry 5 veces con 3s delay para tx no minadas

## Contrato de Integracion BLOQUEANTE

### Client → Server (Route C)

**Request:**
```
POST /api/v1/models/{slug}/invoke
Headers:
  Content-Type: application/json
  X-PAYMENT-TX: 0x<txHash>   // tx hash del USDC.transfer on-chain
Body:
  { "input": "string — prompt del usuario" }
```

**Response exitoso (200):**
```json
{
  "result": "respuesta del agente",
  "meta": {
    "model": "slug",
    "tx_hash": "0x...",
    "status": "success",
    "charged": 0.001
  }
}
```

**Errores:**
| HTTP | Code | Cuando |
|------|------|--------|
| 402 | `payment_replay` | tx_hash ya usado en agent_calls |
| 402 | `payment_invalid` | Transfer event no encontrado o amount insuficiente |

## Constraint Directives

### OBLIGATORIO
- Seguir patron de Route B para Route C (misma estructura post-settlement)
- Import solo modulos que EXISTEN: `verifyUsdcTransfer` de `@/lib/contracts/verifyUsdcTransfer`
- Usar `isThirdweb` de `useWallet()` para detectar smart account (no inventar deteccion)
- `USDC_ABI_TRANSFER` junto a `USDC_ABI_APPROVE` existente
- `unifiedWriteContract` para el USDC.transfer (ya maneja thirdweb + wagmi)
- Anti-replay: SELECT antes de verificacion + UNIQUE index como backup atomico

### PROHIBIDO
- NO agregar dependencias nuevas
- NO tocar `usdcSettler.ts` (flujo EOA intacto)
- NO tocar `operatorSettler.ts` (no se usa)
- NO tocar `FallbackApproveFlow.tsx` ni `payment-flow.types.ts`
- NO modificar archivos fuera de la tabla
- NO hardcodear direcciones, usar constantes de `fuji.ts`
- NO activar el flujo transfer para EOA wallets (solo `isThirdweb`)

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Crear migracion `020_unique_tx_hash.sql` — UNIQUE partial index
- [ ] W0.2: Verificar typecheck pasa (`npx tsc --noEmit`)

### Wave 1 (Server — Route C handler)
- [ ] W1.1: Import `verifyUsdcTransfer` en route.ts
- [ ] W1.2: Agregar `X-PAYMENT-TX` a CORS headers
- [ ] W1.3: Route C handler: header check → anti-replay → verify → callUpstream → logCall → buildResponse
- [ ] W1.4: Verificar typecheck pasa

### Wave 2 (Client — Smart account detection + transfer)
- [ ] W2.1: Agregar `USDC_ABI_TRANSFER` constante
- [ ] W2.2: Import `isThirdweb` de `useWallet()`
- [ ] W2.3: Branch `isThirdweb` en `pay()` → USDC.transfer → X-PAYMENT-TX header → response handling
- [ ] W2.4: Agregar `'transferring'` a `deriveState()` guard
- [ ] W2.5: Verificar typecheck pasa

### Wave 3 (Final)
- [ ] W3.1: Full typecheck `npx tsc --noEmit`
- [ ] W3.2: Adversarial review de seguridad
- [ ] W3.3: Commit + push

### Verificacion Incremental

| Wave | Verificacion al completar |
|------|--------------------------|
| W0 | typecheck pasa |
| W1 | typecheck pasa, Route C handler completo |
| W2 | typecheck pasa, flujo completo |
| W3 | full QA, commit |

## Out of Scope

- `usdcSettler.ts` — flujo EOA intacto
- `operatorSettler.ts` — no se usa en Route C
- `FallbackApproveFlow.tsx` — UI de fallback para EOA
- `payment-flow.types.ts` — `'transferring'` ya existe
- `verifyUsdcTransfer.ts` — ya implementado, no tocar
- `PayToCallButton.tsx` — estados ya cubiertos, no requiere cambios
- NO "mejorar" codigo adyacente
- NO agregar tests (se haran en sprint separado)

## Escalation Rule

> **Si algo no esta en este Story File, Dev PARA y pregunta a Architect.**
> No inventar. No asumir. No improvisar.

---

*Story File generado por NexusAgil — F2.5*
