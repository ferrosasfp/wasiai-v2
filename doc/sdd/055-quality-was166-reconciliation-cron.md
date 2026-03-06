# Story File — SDD #055: Cron de reconciliación on-chain/off-chain
**Sprint TBD | WAS-166**
**Classification: QUALITY**
**Source of truth: this file only. Read every file before modifying.**

## Context

Agentes marcados `registration_type = 'on_chain'` en la DB pueden no estar registrados en el contrato (por tx fallida, timeout, o el bug de WAS-162). No existe mecanismo de reconciliación.

**Depende de:** WAS-162 (fix de registro prematuro). Este cron es el safety net.

**Riesgo: MEDIUM** — inconsistencia silenciosa DB/contrato.

## Acceptance Criteria

1. Cron job que se ejecuta cada 6 horas
2. Consulta todos los agentes con `registration_type = 'on_chain'`
3. Para cada uno, verifica en el contrato si `getAgent(slug)` retorna datos válidos
4. Si el agente NO está en el contrato: actualiza DB a `registration_type = 'off_chain'` y loguea warning
5. Si el agente SÍ está en el contrato pero DB dice `off_chain`: actualiza a `on_chain` (reconciliación inversa)
6. Genera un resumen de reconciliación en logs
7. Build pasa sin errores

## Wave 1 — Crear endpoint de reconciliación

**Archivo:** `src/app/api/cron/reconcile-onchain/route.ts` (crear)

```typescript
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createServiceClient()
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS
  if (!contractAddress) {
    logger.warn('[reconcile] No contract address configured')
    return NextResponse.json({ skipped: true, reason: 'no contract' })
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  // Get all agents marked on_chain
  const { data: onChainAgents } = await serviceClient
    .from('agents')
    .select('id, slug, registration_type')
    .eq('registration_type', 'on_chain')

  let fixed = 0
  let verified = 0
  const errors: string[] = []

  for (const agent of (onChainAgents ?? [])) {
    try {
      const result = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'getAgent',
        args: [agent.slug],
      }) as { creator: string }

      const isRegistered = result.creator !== '0x0000000000000000000000000000000000000000'

      if (!isRegistered) {
        await serviceClient
          .from('agents')
          .update({
            registration_type: 'off_chain',
            on_chain_registered: false,
          })
          .eq('id', agent.id)

        logger.warn('[reconcile] Agent not on-chain, fixed DB', { slug: agent.slug })
        fixed++
      } else {
        verified++
      }
    } catch (err) {
      errors.push(agent.slug)
      logger.error('[reconcile] Failed to check agent', {
        slug: agent.slug,
        err: String(err).slice(0, 200),
      })
    }
  }

  const summary = { total: onChainAgents?.length ?? 0, verified, fixed, errors: errors.length }
  logger.info('[reconcile] Reconciliation complete', summary)

  return NextResponse.json(summary)
}
```

## Wave 2 — Agregar al cron schedule

**Archivo:** `vercel.json` (o el scheduler que se use)

```json
{
  "path": "/api/cron/reconcile-onchain",
  "schedule": "0 */6 * * *"
}
```

## Wave 3 — Commit + Push

```bash
git add -A
git commit -m "feat(NA-302): cron reconciliation on-chain/off-chain [WAS-166]"
git push
```

## Critical Constraints

- NO ejecutar writes al contrato — solo lectura para verificar
- Rate limit de RPC: agregar un pequeño delay entre llamadas si hay muchos agentes (>50)
- El cron DEBE autenticarse con `CRON_SECRET`
- Si `getAgent` no existe en el ABI, verificar con evento o función alternativa
- Este SDD depende de WAS-162 — ejecutar después
