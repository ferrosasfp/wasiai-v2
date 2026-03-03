# Story File — WAS-82: Upkeep Listener (Chainlink → Settlement trigger)

**Sprint:** WAS-82  
**Modo:** QUALITY  
**Fecha:** 2026-03-02  
**SDD de referencia:** `doc/sdd/025-upkeep-listener/sdd.md`

---

## Objetivo

Cuando Chainlink Automation ejecuta `performUpkeep()` en el contrato WasiAIMarketplace, el settlement off-chain (Supabase: marcar `settled_at`, distribuir earnings) no se dispara — porque el cron existente (`settle-key-batches`) hace skip cuando `settlement_mode = 'chainlink'`.

**Esta historia crea un nuevo Vercel Cron** que cada 5 minutos:
1. Llama `checkUpkeep()` on-chain (view function, sin gas)
2. Si `upkeepNeeded = true` → ejecuta el pipeline de settlement para todas las keys con llamadas pendientes
3. Si `upkeepNeeded = false` → no hace nada

---

## Acceptance Criteria

| # | AC | Verificación |
|---|----|----|
| AC-1 | El sistema detecta y procesa un upkeep pendiente en **≤ 5 minutos** desde `performUpkeep` | `vercel.json` tiene `"*/5 * * * *"` para `/api/cron/upkeep-listener` |
| AC-2 | Cuando `checkUpkeep()` devuelve `false` → responde `{ ok: true, settled: 0, reason: 'upkeep_not_needed' }` | Branch en route.ts |
| AC-3 | Cuando `checkUpkeep()` devuelve `true` → ejecuta settlement y responde `{ ok: true, settled: N, keys: M }` | Test manual en Fuji |
| AC-4 | Requests sin `Authorization: Bearer CRON_SECRET` → HTTP 401 | Auth check en route.ts |
| AC-5 | `npm run build` pasa sin errores TypeScript | Build CI/local |
| AC-6 | Si `checkUpkeep()` lanza error RPC → responde HTTP 500 con mensaje, no bloquea | Try/catch en route.ts |

---

## Archivos a Crear

### `src/app/api/cron/upkeep-listener/route.ts` ← CREAR NUEVO

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { PENDING_WALLET_SENTINEL } from '@/lib/settlement/immediateSettlement'
import { logger } from '@/lib/logger'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'

const BATCH_SIZE_LIMIT = 500

function getPublicClient() {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

export async function GET(request: NextRequest) {
  // Auth — idéntico a settle-key-batches
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    logger.error('[upkeep-listener] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[upkeep-listener] Unauthorized attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
    logger.warn('[upkeep-listener] Contract not configured')
    return NextResponse.json({ skipped: true, reason: 'contract_not_configured' })
  }

  // 1. Verificar si Chainlink necesita upkeep
  let upkeepNeeded = false
  try {
    const pub = getPublicClient()
    const result = await pub.readContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'checkUpkeep',
      args:         ['0x'],
    }) as [boolean, `0x${string}`]
    upkeepNeeded = result[0]
    logger.info('[upkeep-listener] checkUpkeep result', { upkeepNeeded })
  } catch (err) {
    logger.error('[upkeep-listener] checkUpkeep RPC error', { err: String(err).slice(0, 300) })
    return NextResponse.json({ error: 'checkUpkeep RPC failed', detail: String(err).slice(0, 200) }, { status: 500 })
  }

  if (!upkeepNeeded) {
    return NextResponse.json({ ok: true, settled: 0, reason: 'upkeep_not_needed' })
  }

  // 2. upkeepNeeded = true → ejecutar settlement pipeline
  logger.info('[upkeep-listener] upkeepNeeded=true — running settlement')

  // [PEGAR AQUÍ el pipeline completo de settle-key-batches desde L36 hasta L298]
  // El pipeline es idéntico, excepto que NO tiene el check de settlement_mode
  // (este cron SOLO corre cuando Chainlink ya ejecutó, independiente del modo)

  // ... (ver settle-key-batches/route.ts para el pipeline completo)

  return NextResponse.json({ ok: true, settled: totalSettled, keys: byKey.size, results })
}
```

> **Nota para Dev:** El pipeline de settlement (pasos 1-3 con Supabase: buscar unsettled calls, agrupar por key, llamar `settleKeyBatchOnChain`) es **idéntico** al de `settle-key-batches/route.ts` desde la línea 36 hasta la 298, con la única diferencia de que **no tiene el bloque de skip por `settlement_mode`** (líneas 39-48 de ese archivo). Copiar esa lógica directamente.

---

## Archivos a Modificar

### `vercel.json` ← AGREGAR entry en `crons[]`

**Antes:**
```json
{
  "crons": [
    {
      "path": "/api/cron/settle-key-batches",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Después:**
```json
{
  "crons": [
    {
      "path": "/api/cron/settle-key-batches",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/cron/upkeep-listener",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

> ⚠️ Vercel Hobby permite máximo 2 crons. Estamos usando exactamente 2. No agregar más sin upgrade a Pro.

---

## Pattern viem `readContract` para `checkUpkeep`

Basado en el patrón de `marketplaceClient.ts:L228-244` (`simulateContract`):

```typescript
import { createPublicClient, http } from 'viem'
import { avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'

const pub = createPublicClient({
  chain: avalancheFuji,
  transport: http(process.env.NEXT_PUBLIC_RPC_TESTNET),
})

// checkUpkeep es view function — no requiere cuenta/wallet
const [upkeepNeeded, performData] = await pub.readContract({
  address:      '0x...' as `0x${string}`,
  abi:          WASIAI_MARKETPLACE_ABI,
  functionName: 'checkUpkeep',
  args:         ['0x'],  // checkData vacío
}) as [boolean, `0x${string}`]
```

**ABI de referencia** (`WasiAIMarketplace.ts:L206-214`):
```typescript
{
  name: 'checkUpkeep',
  type: 'function',
  stateMutability: 'view',
  inputs:  [{ name: 'checkData', type: 'bytes' }],
  outputs: [
    { name: 'upkeepNeeded', type: 'bool'  },
    { name: 'performData',  type: 'bytes' },
  ],
},
```

---

## Constraint Directives

### OBLIGATORIO
- Verificar `CRON_SECRET` antes de cualquier lógica (patrón idéntico a `settle-key-batches:L24-34`)
- Usar `publicClient.readContract` (no `walletClient`) para `checkUpkeep` — es view function
- Importar `settleKeyBatchOnChain` desde `@/lib/contracts/marketplaceClient`
- Usar `logger.*` para todos los eventos (importar de `@/lib/logger`)
- Retornar `{ ok: boolean }` en todos los paths de éxito
- Schedule en `vercel.json`: `"*/5 * * * *"` (exactamente)

### PROHIBIDO
- `watchContractEvent` — requiere proceso persistente, viola zero-infra-cost
- Llamar `performUpkeep()` desde el cron — eso es rol exclusivo de Chainlink
- Modificar `settle-key-batches/route.ts` — no tocar el cron existente
- Hardcodear address del contrato o private keys
- Agregar terceros servicios (Railway, Fly.io, etc.)
- Más de 2 entries en `vercel.json crons[]` sin upgrade de plan

---

## Waves de Implementación

### W0 — Serial (prereq)
1. Leer `src/app/api/cron/settle-key-batches/route.ts` completo (ya tienes el código)
2. Leer `src/lib/contracts/marketplaceClient.ts` L1-60 (patrón `getOperatorClient`)

### W1 — Implementación
1. Crear `src/app/api/cron/upkeep-listener/route.ts`
   - Auth check
   - `readContract` → `checkUpkeep`
   - Pipeline de settlement (copiar de settle-key-batches, sin el block de settlement_mode)
2. Modificar `vercel.json` — agregar entry cron

### W2 — Verificación
1. `npm run build` → 0 errores
2. Test manual en Fuji (ver sección abajo)

---

## Verificación

### Build
```bash
cd wasiai-v2
npm run build
# Esperado: ✓ Compiled successfully, 0 TypeScript errors
```

### Test manual en Fuji

**Setup:** Asegurarse de tener unsettled calls en la DB de Fuji (`agent_calls` con `settled_at IS NULL`).

```bash
# Test con upkeep pendiente
curl -X GET https://wasiai-v2.vercel.app/api/cron/upkeep-listener \
  -H "Authorization: Bearer $CRON_SECRET"

# Respuesta esperada si hay unsettled:
# { "ok": true, "settled": 5, "keys": 2, "results": [...] }

# Respuesta esperada si no hay unsettled o checkUpkeep=false:
# { "ok": true, "settled": 0, "reason": "upkeep_not_needed" }

# Test auth
curl -X GET https://wasiai-v2.vercel.app/api/cron/upkeep-listener
# Esperado: HTTP 401 { "error": "Unauthorized" }
```

### Test local (dev)
```bash
npm run dev
curl -X GET http://localhost:3000/api/cron/upkeep-listener \
  -H "Authorization: Bearer test-secret"
```

---

## Archivos Esperados al Final

```
✅ src/app/api/cron/upkeep-listener/route.ts   ← NUEVO
✅ vercel.json                                  ← MODIFICADO (+1 cron entry)
```

**NO se tocan:** `settle-key-batches/route.ts`, `marketplaceClient.ts`, `WasiAIMarketplace.ts`
