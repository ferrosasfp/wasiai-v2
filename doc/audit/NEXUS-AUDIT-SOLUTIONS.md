# WasiAI v2.1 — Audit Solutions Guide

**Fecha:** 2026-03-05
**Companion de:** `NEXUS-AUDIT-REPORT.md` (16 findings)
**Instrucciones:** Cada solucion tiene codigo sugerido listo para implementar. El equipo de desarrollo aplica los fixes — este documento es solo guia.

---

## Indice por Prioridad

| Prioridad | IDs | Esfuerzo Total |
|-----------|-----|----------------|
| INMEDIATA | NG-101 | 2h |
| ALTA | NG-102, NG-103, NG-104, NG-105, NA-301, NA-302 | 4.5h |
| MEDIA | NG-106, NG-107, NG-108, NA-303, NA-304 | 1.5h |
| INFO | NG-109, NG-110, NA-305, NA-306 | No requiere accion |

**Total estimado: ~8 horas de desarrollo**

---

## [NG-101] CRITICAL: Verificar txHash es selfRegisterAgent al Contrato Correcto

**Archivo:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`
**Lineas a modificar:** 60-95

### Solucion

Despues de obtener el receipt, verificar que:
1. La transaccion fue enviada al contrato WasiAI Marketplace (`receipt.to`)
2. Los logs del receipt contienen el evento `AgentRegistered` con el slug correcto

```typescript
// upgrade-onchain/route.ts — REEMPLAZAR el bloque try/catch de verificacion (lineas 60-95)

import { decodeEventLog } from 'viem'
import { getContractAddress } from '@/lib/contracts/config'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'

// Dentro del handler, despues de obtener el receipt:
try {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const contractAddress = getContractAddress()

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: result.data.txHash as `0x${string}`,
    timeout: 30_000,
  })

  if (receipt.status === 'reverted') {
    return NextResponse.json(
      { error: 'Transaction was reverted on-chain' },
      { status: 422 },
    )
  }

  // NG-101 FIX: Verificar que la tx fue al contrato correcto
  if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
    return NextResponse.json(
      { error: 'Transaction was not sent to the WasiAI Marketplace contract' },
      { status: 422 },
    )
  }

  // NG-101 FIX: Verificar que el evento AgentRegistered fue emitido con el slug correcto
  let agentRegisteredFound = false
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: WASIAI_MARKETPLACE_ABI,
        data: log.data,
        topics: log.topics,
      })
      if (
        decoded.eventName === 'AgentRegistered' &&
        (decoded.args as { slug?: string }).slug === slug
      ) {
        agentRegisteredFound = true
        break
      }
    } catch {
      // Log no es del ABI del marketplace — skip
    }
  }

  if (!agentRegisteredFound) {
    return NextResponse.json(
      { error: 'Transaction does not contain AgentRegistered event for this slug' },
      { status: 422 },
    )
  }

  logger.info('[upgrade-onchain] Receipt verified', {
    slug,
    txHash: result.data.txHash,
    blockNumber: receipt.blockNumber.toString(),
  })
} catch (err) {
  // ... existing catch
}
```

**Imports adicionales necesarios:**
```typescript
import { decodeEventLog } from 'viem'
import { getContractAddress } from '@/lib/contracts/config'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
```

---

## [NG-102] MEDIUM: Rate Limiting en upgrade-onchain

**Archivo:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`
**Lineas a modificar:** 19-24

### Solucion

Agregar rate limiting al inicio del handler. Reusar `getRegisterLimit()` ya que upgrade-onchain es similar en frecuencia a register.

```typescript
// upgrade-onchain/route.ts — AGREGAR despues de la linea 9 (imports)
import { getRegisterLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

// AGREGAR al inicio del handler POST (despues de validateCsrf):
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  // NG-102 FIX: Rate limiting
  const rlHit = await checkRateLimit(getRegisterLimit(), getIdentifier(req))
  if (rlHit) return rlHit

  // ... resto del handler
```

---

## [NG-103] MEDIUM: No Retornar on_chain_registered:true Sin Confirmacion

**Archivo:** `src/app/api/v1/agents/register/route.ts`
**Lineas a modificar:** 194, 250-257, 272-273

### Solucion

Cambiar la logica para que:
1. El agente se inserte con `registration_type: 'off_chain'` siempre
2. Solo se marque como `'on_chain'` despues de que la tx on-chain confirme
3. La response indique `on_chain_registered: 'pending'` en vez de `true`

```typescript
// register/route.ts — CAMBIAR linea 194
// ANTES:
registration_type: (registerOnChain && data.creator_wallet) ? 'on_chain' : 'off_chain',
// DESPUES (NG-103 FIX):
registration_type: 'off_chain', // Siempre empieza off-chain, se actualiza cuando la tx confirme

// register/route.ts — CAMBIAR lineas 250-257
// ANTES:
if (registerOnChain && data.creator_wallet) {
  registerAgentOnChain({...}).catch(err => logger.error('[register] on-chain failed', { err }))
}
// DESPUES (NG-103 FIX):
if (registerOnChain && data.creator_wallet) {
  registerAgentOnChain({
    slug:             data.slug,
    pricePerCallUSDC: data.price_per_call,
    creatorWallet:    data.creator_wallet,
  }).then(async (txHash) => {
    if (txHash) {
      // Solo marcar on-chain si la tx tuvo exito
      await serviceClient
        .from('agents')
        .update({
          registration_type: 'on_chain',
          on_chain_registered: true,
          chain_registered_at: new Date().toISOString(),
        })
        .eq('slug', data.slug)
      logger.info('[register] on-chain confirmed', { slug: data.slug, txHash })
    }
  }).catch(err => logger.error('[register] on-chain failed', { err }))
}

// register/route.ts — CAMBIAR linea 272
// ANTES:
on_chain_registered: registerOnChain && !!data.creator_wallet,
// DESPUES (NG-103 FIX):
on_chain_registered: false, // Se actualizara async cuando la tx confirme
on_chain_registration_requested: registerOnChain && !!data.creator_wallet,
```

---

## [NG-104] MEDIUM: Cambiar discover_agents_v2 a SECURITY INVOKER

**Archivo:** Nueva migracion SQL (ej: `supabase/migrations/040_fix_discover_security.sql`)

### Solucion

Cambiar la funcion de `SECURITY DEFINER` a `SECURITY INVOKER` y limitar las columnas retornadas.

```sql
-- 040_fix_discover_security.sql

-- NG-104 FIX: Cambiar SECURITY DEFINER a SECURITY INVOKER
-- y limitar columnas retornadas (no retornar endpoint_url, metadata, etc.)

CREATE OR REPLACE FUNCTION discover_agents_v2(
  p_category TEXT DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  category TEXT,
  price_per_call NUMERIC,
  currency TEXT,
  chain TEXT,
  agent_type TEXT,
  registration_type registration_type,
  capabilities JSONB,
  total_calls BIGINT,
  avg_rating NUMERIC,
  is_featured BOOLEAN,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER  -- NG-104: Respetar RLS del caller
AS $$
  SELECT
    a.id, a.name, a.slug, a.description, a.category,
    a.price_per_call, a.currency, a.chain, a.agent_type,
    a.registration_type, a.capabilities, a.total_calls,
    a.avg_rating, a.is_featured, a.status, a.created_at
  FROM agents a
  WHERE a.status = 'active'
    AND (p_category IS NULL OR a.category = p_category)
    AND (p_max_price IS NULL OR a.price_per_call <= p_max_price)
  ORDER BY
    CASE WHEN a.registration_type = 'on_chain' THEN 1 ELSE 0 END DESC,
    a.total_calls DESC
  LIMIT p_limit;
$$;
```

**Nota:** Si RLS no permite lectura publica de `agents`, agregar una policy:
```sql
CREATE POLICY "Public can read active agents"
  ON agents FOR SELECT
  USING (status = 'active');
```

---

## [NG-105] MEDIUM: Redis Mutex Fail-Closed o Log+Alert

**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`
**Lineas a modificar:** 248-251

### Solucion

Opcion A (Recomendada): Fail-closed — retornar 503 si Redis no esta disponible:

```typescript
// invoke/route.ts — REEMPLAZAR lineas 248-251
} catch (redisErr) {
  // NG-105 FIX: fail-closed — sin mutex no hay proteccion contra double-spend
  logger.error('[invoke] Redis mutex unavailable — blocking invocation', {
    keyId: keyRow.id,
    err: String(redisErr).slice(0, 200)
  })
  return NextResponse.json(
    { error: 'Service temporarily unavailable', code: 'mutex_unavailable' },
    { status: 503, headers: { 'Retry-After': '5' } }
  )
}
```

Opcion B (Alternativa): Fail-open con alerta:

```typescript
// invoke/route.ts — REEMPLAZAR lineas 248-251
} catch (redisErr) {
  // NG-105 ALT: fail-open pero con alarma
  logger.error('[invoke] ALERT: Redis mutex unavailable — proceeding WITHOUT double-spend protection', {
    keyId: keyRow.id,
    severity: 'HIGH',
  })
  // TODO: Integrar con monitoring (PagerDuty, Slack alert)
}
```

---

## [NA-301] MEDIUM: Mitigacion Slug Squatting en selfRegisterAgent

**Archivo:** `contracts/src/WasiAIMarketplace.sol`
**Lineas a modificar:** 229-247

### Solucion

Agregar una de estas mitigaciones (en orden de recomendacion):

**Opcion A (Recomendada): Registration Fee**

```solidity
// WasiAIMarketplace.sol — agregar estado
uint256 public selfRegistrationFee = 1e6; // 1 USDC

event SelfRegistrationFeeUpdated(uint256 oldFee, uint256 newFee);

// Modificar selfRegisterAgent:
function selfRegisterAgent(
    string  calldata slug,
    uint256 pricePerCall,
    uint64  erc8004Id
) external whenNotPaused {
    require(bytes(slug).length > 0,  "WasiAI: empty slug");
    require(bytes(slug).length <= 80, "WasiAI: slug too long");  // NA-303 fix
    require(pricePerCall >= 1000,     "WasiAI: price too low");  // NA-304 fix ($0.001 min)
    require(pricePerCall <= 100e6,    "WasiAI: price too high"); // NA-304 fix ($100 max)
    require(
        agents[slug].creator == address(0),
        "WasiAI: slug taken"
    );

    // NA-301: Require registration fee to prevent spam
    if (selfRegistrationFee > 0) {
        usdc.safeTransferFrom(msg.sender, treasury, selfRegistrationFee);
    }

    agents[slug] = Agent({
        creator:       msg.sender,
        pricePerCall:  pricePerCall,
        erc8004Id:     erc8004Id
    });

    emit AgentRegistered(slug, msg.sender, pricePerCall, erc8004Id);
}

// Admin function para ajustar fee
function setSelfRegistrationFee(uint256 newFee) external onlyOwner {
    require(newFee <= 100e6, "WasiAI: fee too high"); // max 100 USDC
    uint256 old = selfRegistrationFee;
    selfRegistrationFee = newFee;
    emit SelfRegistrationFeeUpdated(old, newFee);
}
```

**Opcion B (Mas Simple): Slug Length Limit + Price Bounds Only**

```solidity
function selfRegisterAgent(
    string  calldata slug,
    uint256 pricePerCall,
    uint64  erc8004Id
) external whenNotPaused {
    require(bytes(slug).length > 0,   "WasiAI: empty slug");
    require(bytes(slug).length <= 80, "WasiAI: slug too long");  // NA-303
    require(pricePerCall >= 1000,     "WasiAI: price too low");  // NA-304 ($0.001)
    require(pricePerCall <= 100e6,    "WasiAI: price too high"); // NA-304 ($100)
    require(
        agents[slug].creator == address(0),
        "WasiAI: slug taken"
    );
    // ... rest unchanged
}
```

---

## [NA-302] MEDIUM: Reconciliacion On-chain/Off-chain

**Archivos:** `src/app/api/v1/agents/register/route.ts`, nueva migracion o cron

### Solucion

Agregar un cron job que reconcilie el estado DB con el estado on-chain:

```typescript
// src/app/api/cron/reconcile-onchain/route.ts (NUEVO)
import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { getContractAddress } from '@/lib/contracts/config'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { Address } from 'viem'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const client = createPublicClient({ chain, transport: http() })
  const contractAddress = getContractAddress()

  // Find agents marked as on_chain in DB
  const { data: onChainAgents } = await supabase
    .from('agents')
    .select('id, slug, registration_type')
    .eq('registration_type', 'on_chain')

  let fixed = 0
  for (const agent of onChainAgents ?? []) {
    try {
      const onChainAgent = await client.readContract({
        address: contractAddress,
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'getAgent',
        args: [agent.slug],
      }) as { creator: Address }

      // If creator is zero address, agent is NOT registered on-chain
      if (onChainAgent.creator === '0x0000000000000000000000000000000000000000') {
        await supabase
          .from('agents')
          .update({ registration_type: 'off_chain', on_chain_registered: false })
          .eq('id', agent.id)
        logger.warn('[reconcile] Agent marked on_chain but not found on-chain', { slug: agent.slug })
        fixed++
      }
    } catch (err) {
      logger.error('[reconcile] Error checking agent', { slug: agent.slug, err: String(err).slice(0, 200) })
    }
  }

  return NextResponse.json({ checked: onChainAgents?.length ?? 0, fixed })
}
```

---

## [NG-106] LOW: Sanitizar Error Messages de RPC

**Archivo:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`
**Lineas a modificar:** 88-94

### Solucion

```typescript
// upgrade-onchain/route.ts — REEMPLAZAR lineas 88-94
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  logger.error('[upgrade-onchain] Receipt verification failed', { slug, err: msg })
  // NG-106 FIX: No exponer mensaje interno de RPC al usuario
  return NextResponse.json(
    { error: 'Could not verify transaction on-chain. Please try again or contact support.' },
    { status: 422 },
  )
}
```

---

## [NG-107] LOW: Popular token_id en Upgrade Flow

**Archivo:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`
**Lineas a modificar:** 98-106

### Solucion

Extraer el `erc8004Id` del evento `AgentRegistered` y guardarlo como `token_id`:

```typescript
// upgrade-onchain/route.ts — AGREGAR despues de verificar el evento AgentRegistered
// (requiere que NG-101 ya este implementado)

// Extraer token_id del evento
let tokenId: bigint | null = null
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({
      abi: WASIAI_MARKETPLACE_ABI,
      data: log.data,
      topics: log.topics,
    })
    if (decoded.eventName === 'AgentRegistered') {
      const args = decoded.args as { erc8004Id?: bigint }
      tokenId = args.erc8004Id ?? null
      break
    }
  } catch { /* skip */ }
}

// MODIFICAR el update para incluir token_id
const { error } = await serviceClient
  .from('agents')
  .update({
    registration_type: 'on_chain',
    on_chain_registered: true,
    chain_registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    token_id: tokenId ? Number(tokenId) : null, // NG-107 FIX
  })
  .eq('id', existing.id)
```

---

## [NG-108] LOW: Rate Limit en Stats Endpoint

**Archivo:** `src/app/api/transparency/stats/route.ts`
**Lineas a modificar:** 1-9

### Solucion

```typescript
// transparency/stats/route.ts — AGREGAR imports y rate limiting

import { type NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, fromUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
import { getContractAddress } from '@/lib/contracts/config'
// NG-108 FIX: Rate limiting
import { checkRateLimit, getIdentifier } from '@/lib/ratelimit'
import { Ratelimit } from '@upstash/ratelimit'
import { getSharedRedis } from '@/lib/ratelimit'

let _statsLimit: Ratelimit | null = null
function getStatsLimit() {
  return _statsLimit ??= new Ratelimit({
    redis: getSharedRedis(),
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:stats',
  })
}

export const revalidate = 60

// CAMBIAR signature para aceptar request
export async function GET(request: NextRequest) {
  // NG-108 FIX: Rate limiting
  const rlHit = await checkRateLimit(getStatsLimit(), getIdentifier(request))
  if (rlHit) return rlHit

  try {
    // ... existing logic
```

---

## [NA-303] LOW: Max Slug Length en selfRegisterAgent

**Archivo:** `contracts/src/WasiAIMarketplace.sol`
**Lineas a modificar:** 234

### Solucion

```solidity
// WasiAIMarketplace.sol:234 — AGREGAR despues del check de empty slug
require(bytes(slug).length > 0,   "WasiAI: empty slug");
require(bytes(slug).length <= 80, "WasiAI: slug too long");  // NA-303 FIX
```

**Nota:** Aplicar el mismo fix a `registerAgent()` (linea 208) por consistencia:
```solidity
// WasiAIMarketplace.sol:208 — AGREGAR
require(bytes(slug).length > 0, "WasiAI: empty slug");
require(bytes(slug).length <= 80, "WasiAI: slug too long");  // NA-303 FIX
```

---

## [NA-304] LOW: Min/Max pricePerCall en selfRegisterAgent

**Archivo:** `contracts/src/WasiAIMarketplace.sol`
**Lineas a modificar:** 229-247

### Solucion

```solidity
// WasiAIMarketplace.sol — AGREGAR despues del slug length check
function selfRegisterAgent(
    string  calldata slug,
    uint256 pricePerCall,
    uint64  erc8004Id
) external whenNotPaused {
    require(bytes(slug).length > 0,    "WasiAI: empty slug");
    require(bytes(slug).length <= 80,  "WasiAI: slug too long");     // NA-303
    require(pricePerCall >= 1000,      "WasiAI: price too low");     // NA-304 ($0.001 min)
    require(pricePerCall <= 100_000_000, "WasiAI: price too high");  // NA-304 ($100 max)
    // ... rest unchanged
```

**Nota:** Estos limites deben ser consistentes con el schema Zod del backend:
```typescript
// register/route.ts ya tiene:
price_per_call: z.number().min(0.001).max(100)
// 0.001 * 1e6 = 1000 atomics, 100 * 1e6 = 100_000_000 atomics — consistente
```

---

## Resumen de Archivos a Modificar

| Archivo | Findings | Tipo |
|---------|----------|------|
| `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts` | NG-101, NG-102, NG-106, NG-107 | MODIFY |
| `src/app/api/v1/agents/register/route.ts` | NG-103 | MODIFY |
| `supabase/migrations/040_fix_discover_security.sql` | NG-104 | NEW |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | NG-105 | MODIFY |
| `src/app/api/transparency/stats/route.ts` | NG-108 | MODIFY |
| `contracts/src/WasiAIMarketplace.sol` | NA-301, NA-303, NA-304 | MODIFY |
| `src/app/api/cron/reconcile-onchain/route.ts` | NA-302 | NEW |

---

## Orden de Implementacion Recomendado

1. **NG-101** (CRITICAL) — Sin esto, el badge on-chain es falsificable
2. **NG-102** + **NG-108** — Rate limiting (rapido, 15min cada uno)
3. **NA-303** + **NA-304** — Input validation on-chain (requiere redeploy)
4. **NG-103** — Consistencia registration_type
5. **NG-104** — SECURITY INVOKER migration
6. **NG-105** — Redis mutex decision (fail-closed vs alert)
7. **NA-301** — Slug squatting mitigation (requiere redeploy)
8. **NA-302** — Cron de reconciliacion
9. **NG-106** + **NG-107** — Mejoras menores

**Nota sobre redeploy:** NA-301, NA-303, NA-304 requieren redeploy del smart contract. Se recomienda agrupar estos cambios en un solo redeploy para minimizar gas y riesgo.

---

*Soluciones generadas para NEXUS-AUDIT-REPORT.md v2.1*
*Cada solucion tiene codigo sugerido concreto con archivo:linea*
*El equipo de desarrollo implementa — este documento es guia, no implementacion*
