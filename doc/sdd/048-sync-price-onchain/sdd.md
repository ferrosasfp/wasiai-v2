# SDD #048: Sync precio y status on-chain al editar agente

> SPEC_APPROVED: yes (2026-03-05)
> Fecha: 2026-03-05
> Tipo: feature
> SDD_MODE: full
> Branch: feat/048-sync-price-onchain

---

## 1. Resumen

Actualmente, editar precio o status de un agente on-chain solo actualiza Supabase. El contrato queda desincronizado. Este feature agrega sync automático vía `updateAgent()` del contrato, usando el operator server-side (fire-and-forget).

## 2. Acceptance Criteria

- **AC1**: WHEN creator edita `price_per_call` de agente on-chain → `updateAgent()` on-chain fire-and-forget.
- **AC2**: WHEN creator cambia status de agente on-chain (active↔paused) → `updateAgent()` on-chain fire-and-forget.
- **AC3**: IF agente off-chain → no llamar contrato.
- **AC4**: IF sync falla → log error, retornar éxito (Supabase ya actualizado).

## 3. Context Map

| Archivo | Por qué | Patrón |
|---------|---------|--------|
| `src/lib/contracts/marketplaceClient.ts` | Ya tiene `registerAgentOnChain()` — patrón a seguir | simulate + write + catch |
| `src/app/api/creator/agents/[slug]/route.ts` | PATCH de campos del agente — aquí se edita precio | Zod partial + ownership + serviceClient |
| `src/app/api/creator/agents/[slug]/status/route.ts` | PATCH de status — ya modificado en WAS-160b | Zod + CSRF + ownership + fire-and-forget |
| `contracts/src/WasiAIMarketplace.sol` — `updateAgent()` | Función existente: `(slug, newPrice, active)` — callable por operator | No se modifica |

## 4. Diseño técnico

### 4.1 Nueva función en marketplaceClient.ts

```typescript
export async function updateAgentOnChain({
  slug,
  pricePerCallUSDC,
  active,
}: {
  slug: string
  pricePerCallUSDC: number
  active: boolean
}): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping updateAgent')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()

    const { request } = await pub.simulateContract({
      address: contractAddress,
      abi: WASIAI_MARKETPLACE_ABI,
      functionName: 'updateAgent',
      args: [slug, toUSDCAtomics(pricePerCallUSDC), active],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] updateAgent tx', { txHash, slug })
    return txHash
  } catch (err) {
    logger.error('[marketplace] updateAgent failed', { err: String(err).slice(0, 300) })
    return null
  }
}
```

Sigue exactamente el patrón de `registerAgentOnChain()`.

### 4.2 Sync en PATCH /api/creator/agents/[slug]/route.ts

Después del update exitoso en Supabase, si el agente es on-chain y `price_per_call` cambió:

```typescript
// After successful DB update
if (agent.registration_type === 'on_chain' && result.data.price_per_call !== undefined) {
  updateAgentOnChain({
    slug,
    pricePerCallUSDC: result.data.price_per_call,
    active: agent.status === 'active',
  }).catch(err => logger.error('[agent-patch] updateAgentOnChain failed', { err }))
}
```

### 4.3 Sync en PATCH /api/creator/agents/[slug]/status/route.ts

Después del update exitoso, si el agente es on-chain:

```typescript
// After successful DB update — sync status on-chain for EXISTING on-chain agents
// Skip if registration_type was just set in this request (WAS-160b already handled registration)
const isExistingOnChain = existing.registration_type === 'on_chain' && !result.data.registration_type
if (isExistingOnChain) {
  const { data: agentData } = await serviceClient
    .from('agents')
    .select('price_per_call')
    .eq('id', existing.id)
    .single()

  if (agentData) {
    updateAgentOnChain({
      slug,
      pricePerCallUSDC: agentData.price_per_call,
      active: result.data.status === 'active',
    }).catch(err => logger.error('[status] updateAgentOnChain failed', { err }))
  }
}
```

Clave: `!result.data.registration_type` excluye requests donde se acaba de registrar on-chain (WAS-160b flow), evitando double-call.

### 4.4 ABI — ya existe

`updateAgent` ya está en `WASIAI_MARKETPLACE_ABI` en `WasiAIMarketplace.ts`. No requiere cambios.

## 5. Constraint Directives

### OBLIGATORIO
- Patrón fire-and-forget con `.catch()` — como `registerAgentOnChain`
- Verificar `registration_type === 'on_chain'` antes de llamar contrato
- Usar `toUSDCAtomics()` para convertir precio
- Import `updateAgentOnChain` desde marketplaceClient

### PROHIBIDO
- NO bloquear response esperando tx confirmation
- NO llamar contrato para agentes off-chain
- NO modificar el contrato
- NO agregar dependencias nuevas

---

*SDD generado por NexusAgil — F2*
*Pendiente: SPEC_APPROVED para generar Story File*
