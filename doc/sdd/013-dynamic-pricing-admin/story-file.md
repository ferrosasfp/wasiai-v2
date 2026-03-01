# Story File #013 — WAS-78: Modelo de precios dinámico + Panel Admin
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Separar `price_per_call` en `creator_price` (estático) + `platform_overhead` (dinámico via Chainlink AVAX/USD + gasPrice). Panel admin `/en/admin` como centro de control operativo: fees on-chain, balances, toggle Vercel/Chainlink, settlement manual.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN el consumer invoca un agente via x402, THE challenge SHALL incluir `creator_price + platform_overhead` calculado en tiempo real |
| AC2 | WHEN el gas sube >2x el baseline, THE platform_overhead SHALL ajustarse automáticamente con Chainlink AVAX/USD |
| AC3 | WHEN el overhead supera al creator_price, THE sistema SHALL responder 503 con header `Retry-After: 300` (circuit breaker) |
| AC4 | WHEN el owner accede a `/en/admin` con wallet conectada, THE panel SHALL verificar que es el owner — lectura sin firma, escritura con wallet signature |
| AC5 | WHEN el owner cambia el `platformFeeBps`, THE tx SHALL ejecutarse on-chain y el nuevo valor SHALL reflejarse en el panel |
| AC6 | WHEN el balance AVAX del operator < 0.5, THE panel SHALL mostrar alerta roja |
| AC7 | WHEN el owner activa modo Chainlink en el toggle, THE Vercel cron SHALL detectarlo y omitirse |
| AC8 | WHEN el owner fuerza settlement manual, THE tx SHALL ejecutarse inmediatamente |
| AC9 | WHEN se completa una invocación, THE response SHALL incluir campo `pricing: { creator_price, platform_overhead, total, breakdown }` |

---

## Archivos a crear / modificar

| Archivo | Acción | Notas |
|---|---|---|
| `supabase/migrations/026_creator_price_overhead.sql` | CREAR | columna creator_price + tabla system_config |
| `src/lib/pricing/overhead.ts` | CREAR | calcPlatformOverhead() con cache Redis |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | MODIFICAR | inyectar overhead en Route A y Route B |
| `src/app/[locale]/admin/page.tsx` | CREAR | panel admin UI |
| `src/app/[locale]/admin/layout.tsx` | CREAR | layout protegido por owner |
| `src/app/api/admin/fee/route.ts` | CREAR | cambiar platformFeeBps on-chain |
| `src/app/api/admin/settlement/route.ts` | CREAR | forzar settlement + toggle modo |
| `src/app/api/admin/status/route.ts` | CREAR | balances AVAX, modo activo, último settlement |
| `src/app/api/cron/settle-key-batches/route.ts` | MODIFICAR | detectar modo Chainlink y omitirse |

---

## Wave 0 — Migration (serial, PRIMERO)

### supabase/migrations/026_creator_price_overhead.sql
```sql
-- Migration 026: creator_price separation + system_config
-- Idempotente: IF NOT EXISTS + ON CONFLICT DO NOTHING

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS creator_price NUMERIC(18,6);

-- Backfill: el precio histórico era 100% del creator
UPDATE agents
  SET creator_price = price_per_call
  WHERE creator_price IS NULL;

-- Tabla de configuración del sistema (toggle settlement, etc.)
CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: solo service role
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON system_config
  USING (false) WITH CHECK (false);

-- Seed: modo default = vercel
INSERT INTO system_config (key, value)
  VALUES ('settlement_mode', 'vercel')
  ON CONFLICT (key) DO NOTHING;
```

---

## Wave 1 — overhead.ts (serial, después de migration)

### src/lib/pricing/overhead.ts
```typescript
import { getPublicClient }   from '@/shared/lib/web3/client'
import { readChainlinkFeed } from '@/lib/defi-risk/chainlink'
import { getRedis }          from '@/lib/ratelimit'   // reusar singleton Redis

const CACHE_KEY = 'wasiai:overhead:cache'
const CACHE_TTL = 60  // segundos

export interface OverheadResult {
  overhead:        number
  breakdown:       { gas: number; inference: number; buffer: number }
  circuitBreaker:  boolean
  cached:          boolean
}

export async function calcPlatformOverhead(creatorPrice: number): Promise<OverheadResult> {
  // 1. Intentar cache Redis (TTL 60s — evita 2 calls on-chain por request)
  try {
    const cached = await getRedis().get<OverheadResult>(CACHE_KEY)
    if (cached) {
      return {
        ...cached,
        circuitBreaker: cached.overhead > creatorPrice,
        cached: true,
      }
    }
  } catch { /* cache miss — continuar */ }

  // 2. Calcular con timeout de 2s — FAIL-OPEN si falla
  try {
    const result = await Promise.race([
      _calculate(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('overhead timeout')), 2000)
      ),
    ])
    if (!result) throw new Error('timeout')

    // 3. Cachear en Redis
    try {
      await getRedis().set(CACHE_KEY, result, { ex: CACHE_TTL })
    } catch { /* cache write falla — no bloquear */ }

    return { ...result, circuitBreaker: result.overhead > creatorPrice, cached: false }
  } catch {
    // FAIL-OPEN: si Chainlink o gasPrice fallan, overhead = 0
    // Las llamadas nunca se bloquean por fallo del cálculo
    return {
      overhead:       0,
      breakdown:      { gas: 0, inference: 0, buffer: 0 },
      circuitBreaker: false,
      cached:         false,
    }
  }
}

async function _calculate(): Promise<Omit<OverheadResult, 'circuitBreaker' | 'cached'>> {
  const client = getPublicClient()

  const [gasPrice, chainlinkResult] = await Promise.all([
    client.getGasPrice(),
    readChainlinkFeed(process.env.CHAINLINK_AVAX_USD_FEED!),
  ])

  const avaxUsd   = chainlinkResult.currentPrice
  const GAS_UNITS = 80_000n
  const gasCostAvax = Number(gasPrice * GAS_UNITS) / 1e18
  const gasCostUsdc = gasCostAvax * avaxUsd

  const INFERENCE_COST = Number(process.env.INFERENCE_COST_USDC ?? '0.001')
  const base   = gasCostUsdc + INFERENCE_COST
  const buffer = base * 0.20

  return {
    overhead:  Math.round((base + buffer) * 1_000_000) / 1_000_000,
    breakdown: { gas: gasCostUsdc, inference: INFERENCE_COST, buffer },
  }
}
```

⚠️ IMPORTANTE: `getRedis()` se importa de `@/lib/ratelimit` — es el singleton compartido. No crear nueva instancia de Redis.

---

## Wave 2 — Modificar invoke route

### Exemplar: src/app/api/v1/models/[slug]/invoke/route.ts

Agregar import al top:
```typescript
import { calcPlatformOverhead } from '@/lib/pricing/overhead'
```

**Reemplazar línea ~201:**
```typescript
// ANTES:
const priceStr = String(model.price_per_call)

// DESPUÉS:
const creatorPrice = Number(model.creator_price ?? model.price_per_call)
const { overhead, breakdown, circuitBreaker } = await calcPlatformOverhead(creatorPrice)

if (circuitBreaker) {
  return NextResponse.json(
    {
      error:               'agent_temporarily_unavailable',
      code:                'operational_cost_exceeds_price',
      retry_after_seconds: 300,
    },
    { status: 503, headers: { 'Retry-After': '300' } },
  )
}

const totalPrice = Math.round((creatorPrice + overhead) * 1_000_000) / 1_000_000
const priceStr   = totalPrice.toFixed(6)
```

**Route A — línea ~216 (Agent Key budget check):**
```typescript
// ANTES:
if (remaining < model.price_per_call) {
  ...
  needed: model.price_per_call,

// DESPUÉS:
if (remaining < totalPrice) {
  ...
  needed: totalPrice,
```

**Route A — línea ~275 (increment spend):**
```typescript
// ANTES:
p_amount: model.price_per_call,

// DESPUÉS:
p_amount: totalPrice,
```

**Route A — signReceipt (línea ~251):**
```typescript
// signReceipt recibe amountUsdc = creatorPrice (NO totalPrice)
// El receipt certifica lo que va al creator, no el overhead
amountUsdc: creatorPrice,   // ← NO totalPrice
```

**buildResponse — agregar campo pricing:**
```typescript
// En buildResponse(), agregar en el JSON response:
pricing: {
  creator_price:     creatorPrice,
  platform_overhead: overhead,
  total:             totalPrice,
  overhead_breakdown: breakdown,
},
```
⚠️ NO modificar `meta.charged` — mantenerlo como está para compatibilidad del SDK.

---

## Wave 3 — APIs admin (paralelo)

### src/app/api/admin/status/route.ts
```typescript
// GET — sin auth requerida para lectura (el panel verifica owner en cliente)
// Retorna: { platformFeeBps, avaxBalance, settlementMode, lastSettlement, pendingRecordings }
// avaxBalance: getPublicClient().getBalance({ address: OPERATOR_ADDRESS })
// platformFeeBps: readContract({ functionName: 'platformFeeBps' })
// settlementMode: SELECT value FROM system_config WHERE key = 'settlement_mode'
// lastSettlement: SELECT MAX(created_at) FROM agent_calls WHERE settled_on_chain = true
// pendingRecordings: SELECT COUNT(*) FROM pending_recordings WHERE resolved_at IS NULL
```

### src/app/api/admin/fee/route.ts
```typescript
// POST — requiere header X-Admin-Signature (wallet sig del owner)
// Body: { bps: number }
// Validar: bps entre 0 y 3000
// Ejecutar: writeContract setPlatformFee(bps) con OPERATOR_PRIVATE_KEY
// Solo el operator wallet puede llamar setPlatformFee (ya protegido en contrato)
```

### src/app/api/admin/settlement/route.ts
```typescript
// POST — requiere X-Admin-Signature
// Body: { action: 'run' | 'toggle', mode?: 'vercel' | 'chainlink' }
// toggle: UPDATE system_config SET value = mode WHERE key = 'settlement_mode'
// run: llamar directamente settleKeyBatchOnChain() de @/lib/contracts/marketplaceClient
```

---

## Wave 4 — Panel admin UI

### src/app/[locale]/admin/layout.tsx
```typescript
// Server component — verificar que el usuario tiene wallet conectada
// La verificación de owner se hace en el cliente (JS)
// Si no hay sesión de Supabase → redirect a /en
```

### src/app/[locale]/admin/page.tsx
```typescript
'use client'
// Secciones:
// 1. Header con wallet address + badge "Owner" / "Not authorized"
//    → verificar: connectedAddress.toLowerCase() === process.env.NEXT_PUBLIC_OPERATOR_ADDRESS?.toLowerCase()
//    → Si no es owner: mostrar mensaje "Access restricted to WasiAI operator"
//
// 2. Section: Platform Fee
//    → GET /api/admin/status → platformFeeBps
//    → Input number + botón "Update Fee" → POST /api/admin/fee
//
// 3. Section: Operational Health
//    → avaxBalance con badge rojo si < 0.5 AVAX
//
// 4. Section: Settlement Batch
//    → Toggle [Vercel Cron] / [Chainlink Automation]
//    → último settlement timestamp
//    → pending recordings count
//    → botón "Run Now" → POST /api/admin/settlement { action: 'run' }
//
// Usar wagmi useAccount() para connectedAddress
// Usar wagmi useWriteContract() para las tx on-chain
// Estilos: misma paleta que el resto (Tailwind + avax-* colors)
```

---

## Wave 5 — Cron detect mode

### Modificación: src/app/api/cron/settle-key-batches/route.ts

Agregar al inicio del handler GET (después de auth check):
```typescript
// Verificar modo activo — si es Chainlink, omitir este cron
const supabase = createServiceClient()
const { data: config } = await supabase
  .from('system_config')
  .select('value')
  .eq('key', 'settlement_mode')
  .single()

if (config?.value === 'chainlink') {
  logger.info('[settle-key-batches] Chainlink mode active — skipping Vercel cron')
  return NextResponse.json({ skipped: true, reason: 'chainlink_mode_active' })
}
// ... resto del cron sin cambios
```

---

## Wave 6 — Commit + typecheck

```bash
# Aplicar migration
# (Fer la aplica manualmente en Supabase dashboard o via supabase db push)

# Typecheck
cd wasiai-v2 && npx tsc --noEmit

# Commit
git add -A
git commit -m "feat(WAS-78): dynamic pricing overhead + admin panel + settlement toggle"
git push origin master master:main
```

---

## Constraint Directives

### OBLIGATORIO
- `calcPlatformOverhead()` SIEMPRE fail-open — si falla, overhead = 0, nunca bloquear llamadas
- Cache Redis TTL 60s en overhead — reusar singleton `getRedis()` de `@/lib/ratelimit`
- `signReceipt()` recibe `amountUsdc = creatorPrice` (NO totalPrice)
- `recordInvocationOnChain()` recibe `amountUSDC = creatorPrice` (NO totalPrice)
- `increment_agent_key_spend` usa `totalPrice` (lo que realmente se descontó del budget)
- `NEXT_PUBLIC_OPERATOR_ADDRESS` para verificar owner en cliente (ya en env)
- `system_config` usa service role — RLS bloquea acceso directo
- Migration numerada `026_`

### PROHIBIDO
- NO modificar `signReceipt()` ni su interfaz
- NO modificar `meta.charged` en buildResponse (compatibilidad SDK)
- NO crear nueva instancia de Redis — usar `getRedis()` de ratelimit.ts
- NO exponer `OPERATOR_PRIVATE_KEY` en cliente
- NO bloquear invocaciones por fallo del overhead
- NO modificar el contrato

---

## Escalation Rule
Si `getRedis()` no es exportable desde `@/lib/ratelimit` — crear función `getSharedRedis()` en ese mismo archivo y exportarla. No crear nueva instancia.

Si `readChainlinkFeed()` retorna estructura diferente a `{ currentPrice }` — leer el tipo real en `@/lib/defi-risk/chainlink.ts` antes de asumir.
