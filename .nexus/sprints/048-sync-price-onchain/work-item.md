# Work Item #048 — WAS-161: Sync precio on-chain al editar agente

> Fecha: 2026-03-05
> Tipo: feature
> SDD_MODE: full
> Branch: feat/048-sync-price-onchain

---

## Work Item

| Campo | Valor |
|-------|-------|
| **#** | 048 |
| **Linear** | WAS-161 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Cuando un creator edita el precio de un agente on-chain, sincronizar automáticamente con el contrato vía `updateAgent()`. Evitar desincronización entre Supabase y el contrato. |
| **Reglas de negocio** | RN-1 a RN-3 (ver abajo) |
| **Scope IN** | Sync precio en PATCH `/api/creator/agents/[slug]`, sync status on-chain al pausar/activar |
| **Scope OUT** | Edición de precio client-side (creator firma) — se usa operator server-side como en el flujo actual |
| **Missing Inputs** | N/A |

---

## Reglas de Negocio

### RN-1: Sync condicional
- Solo sincronizar on-chain si el agente tiene `registration_type = 'on_chain'`.
- Agentes off-chain no tocan el contrato.

### RN-2: Qué se sincroniza
| Campo | Supabase → On-chain |
|-------|---------------------|
| `price_per_call` | `updateAgent(slug, newPrice, active)` |
| `status` (active/paused) | `updateAgent(slug, price, active=true/false)` |

### RN-3: Fire-and-forget
- La sync on-chain es **fire-and-forget** (como `registerAgentOnChain` hoy).
- Si falla, el precio en Supabase queda actualizado, el on-chain queda desincronizado.
- Se loggea el error pero no se bloquea la respuesta al usuario.
- Razón: el operator paga gas para la sync, no el creator. No podemos bloquear la UX por un fallo de gas.
- Nota: `updateAgent()` acepta calls del creator, operator, u owner. Se usa operator server-side para no requerir firma del creator en cada edición de precio — consistente con `recordInvocation` y `settleKeyBatch`.

---

## Acceptance Criteria (EARS)

1. **WHEN** un creator edita `price_per_call` de un agente con `registration_type = 'on_chain'`, **THE** sistema **SHALL** llamar `updateAgent(slug, newPrice, active)` on-chain vía operator (fire-and-forget).
2. **WHEN** un creator cambia el status de un agente on-chain (active ↔ paused), **THE** sistema **SHALL** llamar `updateAgent(slug, price, newActive)` on-chain vía operator (fire-and-forget).
3. **IF** el agente es `registration_type = 'off_chain'`, **THEN THE** sistema **SHALL** no hacer ninguna llamada on-chain al editar precio o status.
4. **IF** la sync on-chain falla, **THEN THE** sistema **SHALL** loggear el error y retornar éxito al usuario (Supabase ya fue actualizado).

---

## Scope IN
- Agregar `updateAgentOnChain()` en `marketplaceClient.ts`
- Llamar sync en PATCH `/api/creator/agents/[slug]/route.ts` cuando cambia `price_per_call`
- Llamar sync en PATCH `/api/creator/agents/[slug]/status/route.ts` cuando cambia `status`
- Solo para agentes `on_chain`

## Scope OUT
- Creator firma client-side (operator lo hace server-side)
- Sync de otros campos (endpoint, capabilities — no existen on-chain)
- Retry o queue de syncs fallidos (futuro)

---

*Work Item generado por NexusAgil — F1*
*Pendiente: HU_APPROVED para avanzar a F2 (SDD)*
