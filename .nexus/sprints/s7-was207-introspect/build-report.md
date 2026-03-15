# Build Report — SDD S7-04 / WAS-207

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | Re-validación OK. Todos los archivos de referencia existen y son compatibles. logCall firma con nonce en pos 9 confirmada. |
| Wave 1 | ✅ DONE | ✅ PASS | `src/lib/introspect/buildCOB.ts` — COB builder + EIP-712-style signature usando viem |
| Wave 2 | ✅ DONE | ✅ PASS | `src/app/api/v1/agents/[slug]/introspect/route.ts` — endpoint principal con auth dual + 402 flow |

## Commit
- Hash: `079731c46`
- Message: `feat(S7-04): POST /introspect endpoint + COB builder [WAS-207]`
- Files changed: 2

## Archivos creados
- `src/lib/introspect/buildCOB.ts` — `assembleCOB()`, `signCOB()`, `buildCOB()`
- `src/app/api/v1/agents/[slug]/introspect/route.ts` — `POST`, `OPTIONS`

## Implementación

### Pricing
```typescript
{ shallow: 0.10, mid: 0.25, full: 0.50 }  // USDC
```

### Auth dual
- **Path A (agent key):** `x-agent-key` header → budget check → deduct via `check_and_deduct_budget` RPC
- **Path B (x402):** `X-PAYMENT` header → `settlePaymentDirectly()` → COB generado

### COB signature
- `keccak256(JSON.stringify(cob))` firmado con operator wallet vía `privateKeyToAccount` (viem)
- No-fatal: si falla, `operator_signature: null`

### logCall
- Firma: `logCall(supabase, model, callerType, txHash, result, keyId, agentSlug, nonce)`
- `nonce = null` en ambos paths (SDD §4.5 + S7-03 nota)

### Constraints verificadas
- ✅ `endpoint_url` NO expuesto en COB response
- ✅ NO storage persistente de COBs
- ✅ NO llamada upstream sin payment válido
- ✅ NO dependencias nuevas (solo viem ya disponible)
- ✅ CORS headers idénticos a invoke
- ✅ `memory_diffs` incremental para shallow/mid (full → raw upstream)
- ✅ `truncated: true` cuando timeout upstream (AC6)

## Discrepancias encontradas
- **Wave 0:** `supabase.rpc(...).catch()` no es válido en tipos Supabase — usé `Promise.resolve(supabase.rpc(...)).catch()` en su lugar (mismo patrón que invoke usa para `increment_pending_earnings`).

## Notas para QA/Auditor
- El campo `erc8004_identity` usa `creator_wallet` si el agente está `on_chain_registered`, string vacío si no.
- El upstream recibe el body original con `__introspect: true` extra para señalar modo introspección.
- Si el agente upstream no implementa introspect (responde con error), el COB retorna `state_snapshots=[], call_trace=[], memory_diffs=[]` con `truncated=false` (risk mitigation del SDD: "COB vacío válido").
