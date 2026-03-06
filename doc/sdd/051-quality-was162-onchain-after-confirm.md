# Story File — SDD #051: No marcar on_chain antes de confirmación tx
**Sprint TBD | WAS-162**
**Classification: QUALITY**
**Source of truth: this file only. Read every file before modifying.**

## Context

`/api/v1/agents/register/route.ts` inserta `registration_type: 'on_chain'` en la DB **antes** de que `registerAgentOnChain()` confirme la transacción. Si la tx falla (gas insuficiente, revert, RPC timeout), la DB dice `on_chain` pero el contrato no tiene el agente registrado.

La llamada a `registerAgentOnChain` es fire-and-forget (`.catch(err => logger.error(...))`), así que nunca actualiza la DB si falla.

**Riesgo: MEDIUM** — inconsistencia DB/contrato.

## Acceptance Criteria

1. El agente se inserta siempre como `registration_type: 'off_chain'` inicialmente
2. Solo después de que `registerAgentOnChain()` confirme exitosamente, se actualiza a `on_chain`
3. Si `registerAgentOnChain()` falla, el agente queda como `off_chain` (consistente)
4. El response al cliente indica `registration_type: 'pending_onchain'` cuando se solicitó on-chain pero aún no confirma
5. Log de error existente se mantiene
6. Build pasa sin errores

## Wave 1 — Cambiar flujo de registro

**Archivo:** `src/app/api/v1/agents/register/route.ts`

1. Cambiar `agentPayload.registration_type` a siempre `'off_chain'`
2. Hacer `registerAgentOnChain()` con await y actualizar DB si exitoso:

```typescript
// WAS-160b: Register on-chain AFTER DB insert, update only on success
if (registerOnChain && data.creator_wallet) {
  // Don't await in the response path — but DO update DB on success
  registerAgentOnChain({
    slug:             data.slug,
    pricePerCallUSDC: data.price_per_call,
    creatorWallet:    data.creator_wallet,
  })
    .then(async (txHash) => {
      if (txHash) {
        await serviceClient
          .from('agents')
          .update({
            registration_type: 'on_chain',
            on_chain_registered: true,
            chain_registered_at: new Date().toISOString(),
          })
          .eq('id', agent.id)
        logger.info('[register] on-chain confirmed, DB updated', { slug: data.slug, txHash })
      }
    })
    .catch(err => logger.error('[register] on-chain failed, agent stays off_chain', { err }))
}
```

3. Actualizar el response para reflejar estado real:

```typescript
on_chain_registered: false, // always false initially
registration_type: (registerOnChain && data.creator_wallet) ? 'pending_onchain' : 'off_chain',
```

## Wave 2 — Commit + Push

```bash
git add -A
git commit -m "fix(NG-103): register as off_chain first, upgrade after tx confirms [WAS-162]"
git push
```

## Critical Constraints

- La llamada on-chain sigue siendo non-blocking (no aumentar latencia del endpoint)
- El agente DEBE estar accesible inmediatamente (no esperar confirmación on-chain)
- NO romper el contrato de la API response (agregar `pending_onchain` como nuevo valor)
- El update a `on_chain` usa `serviceClient` (bypass RLS)
