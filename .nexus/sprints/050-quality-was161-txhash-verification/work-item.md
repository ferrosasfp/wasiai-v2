# Story File — SDD #050: Verificar txHash es selfRegisterAgent al contrato correcto
**Sprint TBD | WAS-161**
**Classification: QUALITY**
**Source of truth: this file only. Read every file before modifying.**

## Context

`upgrade-onchain/route.ts` solo verifica que `receipt.status !== 'reverted'`. No valida:
1. Que la tx sea dirigida al contrato `MARKETPLACE_CONTRACT_ADDRESS`
2. Que la tx llame a `selfRegisterAgent`
3. Que emita el evento `AgentRegistered` con el slug correcto

Esto permite que un usuario envíe cualquier tx exitosa (incluso a otro contrato) y obtenga el badge on-chain falso.

**Riesgo: CRITICAL** — cualquier tx exitosa otorga badge on-chain.

## Acceptance Criteria

1. El endpoint verifica que `receipt.to` === `MARKETPLACE_CONTRACT_ADDRESS` (case-insensitive)
2. El endpoint decodifica los logs y verifica que exista al menos un evento `AgentRegistered`
3. El evento `AgentRegistered` debe tener `slug` === el slug del agente siendo upgradeado
4. Si cualquier verificación falla, retorna 422 con mensaje descriptivo
5. Tests unitarios cubren: tx a contrato incorrecto, tx sin evento, tx con slug incorrecto, tx válida
6. Build pasa sin errores

## Wave 1 — Agregar validación de receipt

**Archivo:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`

Después de verificar `receipt.status !== 'reverted'`, agregar:

```typescript
import { decodeEventLog } from 'viem'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'

// NG-101: Verify tx target is the correct marketplace contract
const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS
if (!contractAddress) {
  return NextResponse.json(
    { error: 'Marketplace contract not configured' },
    { status: 500 },
  )
}

if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
  logger.warn('[upgrade-onchain] TX target mismatch', {
    slug,
    expected: contractAddress,
    actual: receipt.to,
  })
  return NextResponse.json(
    { error: 'Transaction is not directed to the WasiAI Marketplace contract' },
    { status: 422 },
  )
}

// NG-101: Verify AgentRegistered event with correct slug
const agentRegisteredEvent = receipt.logs
  .map(log => {
    try {
      return decodeEventLog({
        abi: WASIAI_MARKETPLACE_ABI,
        data: log.data,
        topics: log.topics,
      })
    } catch {
      return null
    }
  })
  .find(
    decoded =>
      decoded?.eventName === 'AgentRegistered' &&
      (decoded.args as { slug?: string })?.slug === slug,
  )

if (!agentRegisteredEvent) {
  logger.warn('[upgrade-onchain] AgentRegistered event not found for slug', {
    slug,
    txHash: result.data.txHash,
    logCount: receipt.logs.length,
  })
  return NextResponse.json(
    { error: 'Transaction does not contain a valid AgentRegistered event for this agent' },
    { status: 422 },
  )
}
```

## Wave 2 — Tests

**Archivo:** `src/app/api/creator/agents/[slug]/upgrade-onchain/__tests__/route.test.ts` (crear)

Tests con mocks de `viem` publicClient:
1. **Reject: tx to wrong contract** — `receipt.to` !== contract address → 422
2. **Reject: no AgentRegistered event** — logs vacíos → 422
3. **Reject: AgentRegistered with wrong slug** — evento con slug diferente → 422
4. **Accept: valid tx** — to correcto + evento con slug correcto → 200
5. **Reject: contract not configured** — env var missing → 500

## Wave 3 — Commit + Push

```bash
git add -A
git commit -m "fix(NG-101): verify txHash target + AgentRegistered event [WAS-161]"
git push
```

## Critical Constraints

- NO modificar la lógica de `waitForTransactionReceipt` existente
- NO cambiar el schema de request/response
- La comparación de addresses DEBE ser case-insensitive
- El decode de logs DEBE usar try/catch (logs de otros contratos pueden fallar)
- `decodeEventLog` de viem ya está disponible como dependencia
