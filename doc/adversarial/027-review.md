# Adversarial Review 027 — WAS-72 Escrow

**Fecha:** 2026-03-02  
**Adversary:** San (NexusAgil)  
**Commit:** `52d5ae8`  
**Veredicto:** ✅ **APPROVED** — 0 BLOQUEANTEs · 2 MENOREs · 6 OK

---

## Tabla de hallazgos

| # | Categoría | Resultado | Hallazgo |
|---|-----------|-----------|----------|
| 1 | Reentrancy | ✅ OK | `createEscrow`, `releaseEscrow`, `releaseExpired`, `refundEscrow` tienen `nonReentrant`. Estado actualizado ANTES de transferencias (CEI pattern correcto). |
| 2 | Access control | ✅ OK | `releaseEscrow` y `refundEscrow` son `onlyOperator`. `releaseExpired` es trustless con guard `RELEASE_TIMEOUT`. No hay forma de que un attacker abuse: solo puede liberar al `marketplace` hardcoded, no a una dirección arbitraria. |
| 3 | ERC-3009 signature | ✅ OK | El nonce ERC-3009 es rastreado por el contrato USDC (no reutilizable). El mismo nonce se incluye en el `escrowId`, doble protección. El contrato USDC rechazará replay automáticamente. |
| 4 | Funds stuck | ⚠️ MENOR | `releaseExpired` libera al `marketplace`, no al `payer`. Si el operador desaparece por falla del agente (no completó), el usuario NO recibe refund vía trustless path — recibe release al marketplace. No hay `emergencyWithdraw` del owner. Fondos no quedan eternamente atrapados pero el destino podría no ser el esperado por el usuario. |
| 5 | escrow_id collision | ✅ OK | `keccak256(slug, payer, amount, nonce, chainId)` — colisión prácticamente imposible. Duplicate check on-chain: `require(escrows[escrowId].createdAt == 0)` reverts correctamente con "escrowId exists". |
| 6 | Backend auth | ✅ OK | `release-expired` requiere `Bearer ${INTERNAL_API_SECRET}`; si la env var no está configurada retorna 500 (fail-closed). `invoke-long` valida X-API-Key contra `agent_keys`. Ambos correctos. |
| 7 | viem vs ethers | ✅ OK | `grep -r "ethers"` → 0 imports reales. Solo comentario docstring "NEVER ethers.js". 100% viem v2. |
| 8 | Scope drift | ✅ OK | `WasiAIMarketplace.sol` no fue modificado (diff vacío). `vercel.json` mantiene exactamente 2 crons (settle-key-batches + upkeep-listener). Sin tercer cron. |

---

## Detalle de MENOREs

### MENOR-1: `releaseExpired` libera al Marketplace, no al Payer

**Archivo:** `contracts/src/WasiEscrow.sol:134–142`

```solidity
function releaseExpired(bytes32 escrowId) external nonReentrant ... {
    require(block.timestamp >= escrows[escrowId].createdAt + RELEASE_TIMEOUT, ...);
    _release(escrowId);  // → safeTransfer a marketplace, no a payer
}
```

**Riesgo:** Si el agente falló Y el operador no llama `refundEscrow` (operador caído), después de 24h cualquiera puede ejecutar `releaseExpired` pero los fondos van al marketplace, no devueltos al usuario. El trustless path no protege el capital del payer en caso de falla + operador caído simultáneamente.

**Recomendación:** Documentar explícitamente este comportamiento en el contrato. Considerar para v2 un `releaseExpiredRefund()` alternativo, o que el cron de backend verifique el resultado del agente antes de decidir si ejecuta `releaseExpired` o `refundEscrow`. No es bloqueante porque el flujo principal funciona correctamente y el escenario requiere falla simultánea de agente + operador.

---

### MENOR-2: Agent runner dispatch sin autenticación visible

**Archivo:** `src/app/api/v1/agents/[slug]/invoke-long/route.ts:152–159`

```typescript
fetch(`${APP_URL}/api/v1/internal/agents/${slug}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ escrowId, agentInput }),
}).catch(...)
```

**Riesgo:** El endpoint `/api/v1/internal/agents/[slug]/run` no existe en WAS-72 scope, pero cuando sea implementado (WAS-8x), debe validar `INTERNAL_API_SECRET`. Si se implementa sin auth, cualquiera que conozca la URL puede disparar ejecuciones de agentes sin pagar.

**Recomendación:** Cuando se implemente el agent runner, agregar `Authorization: Bearer ${INTERNAL_API_SECRET}` al fetch. Track en WAS-8x como prerequisito de seguridad.

---

## Verificación forge

```
Ran 10 tests for test/WasiEscrow.t.sol:WasiEscrowTest
[PASS] test_CreateEscrow_DuplicateReverts()
[PASS] test_CreateEscrow_HappyPath()
[PASS] test_CreateEscrow_WrongSignature_Reverts()
[PASS] test_DisputeEscrow()
[PASS] test_RefundEscrow()
[PASS] test_ReleaseAlreadyReleased_Reverts()
[PASS] test_ReleaseEscrow_ToMarketplace()
[PASS] test_ReleaseExpired_After24h()
[PASS] test_ReleaseExpired_Before24h_Reverts()
[PASS] test_Stranger_CannotRelease()

Suite result: ok. 10 passed; 0 failed; 0 skipped
```

10/10 ✅

---

## Conclusión

El contrato `WasiEscrow.sol` y la capa TypeScript implementan correctamente el flujo de escrow para WAS-72. Las protecciones de reentrancy, access control y firma ERC-3009 son sólidas. Los dos MENOREs son observaciones de diseño y no requieren corrección antes de deploy en Fuji testnet.

**APPROVED para continuar a F4 — Validación (QA).**
