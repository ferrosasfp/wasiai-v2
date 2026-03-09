# NEXUS-AUDIT-SOLUTIONS v1.0
## WasiAI Marketplace — Solutions Guide

**Fecha:** 2026-03-08
**Companion de:** `NEXUS-AUDIT-REPORT.md` v1.0 (6 nuevos hallazgos + 6 abiertos previos)
**Instrucciones:** Cada solucion tiene codigo sugerido listo para implementar. El equipo de desarrollo aplica los fixes — este documento es solo guia.

---

## NA-V01 (HIGH) — claimEarnings(): restringir caller a creator

**Problema:** Cualquier address puede llamar `claimEarnings()` con un voucher obtenido del mempool (front-running). Aunque el USDC siempre va al creator registrado, causa UX confusa con tx revertidas.

**Solucion:** Agregar require que valide `msg.sender == creator`.

```solidity
// contracts/src/WasiAIMarketplace.sol — dentro de claimEarnings()
// AGREGAR despues de la linea 471 (require creator != address(0)):

require(msg.sender == creator, "WasiAI: caller must be creator");
```

**Codigo completo de la funcion modificada:**
```solidity
function claimEarnings(
    address creator,
    uint256 grossAmount,
    uint256 deadline,
    bytes32 nonce,
    bytes calldata sig
) external nonReentrant whenNotPaused {
    require(creator != address(0),             "WasiAI: zero creator");
    require(msg.sender == creator,             "WasiAI: caller must be creator"); // NA-V01 fix
    // 1. Expiry guard
    require(block.timestamp <= deadline,       "WasiAI: voucher expired");
    // ... resto sin cambios
```

**Impacto:** Zero breaking change — el creator ya es el que envia la tx desde su wallet. Solo bloquea third-party callers.

**Alternativa (si se necesita meta-tx):** Si en el futuro se necesita que un relayer envie la tx en nombre del creator, usar un approach de `permit` donde la firma incluya el relayer address.

---

## NG-V01 (MEDIUM) — voucher/route.ts: registrar voucher en DB

**Problema:** Los vouchers firmados no se registran en Supabase. Sin audit trail ni proteccion contra emision concurrente.

**Solucion:** Crear tabla `creator_withdrawal_vouchers` y registrar cada voucher emitido.

### Paso 1: Migracion SQL

```sql
-- supabase/migrations/043_withdrawal_vouchers.sql
CREATE TABLE creator_withdrawal_vouchers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    UUID NOT NULL REFERENCES auth.users(id),
  wallet_address TEXT NOT NULL,
  gross_amount_usdc NUMERIC(18,6) NOT NULL,
  nonce         TEXT NOT NULL UNIQUE,  -- anti-replay off-chain
  deadline      BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'claimed', 'expired')),
  tx_hash       TEXT,                   -- filled by withdraw/route.ts
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at    TIMESTAMPTZ
);

-- RLS: creators only see their own vouchers
ALTER TABLE creator_withdrawal_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Creators see own vouchers"
  ON creator_withdrawal_vouchers FOR SELECT
  USING (creator_id = auth.uid());

-- Expire stale vouchers (deadline passed, still pending)
CREATE INDEX idx_vouchers_status_deadline
  ON creator_withdrawal_vouchers(status, deadline)
  WHERE status = 'pending';
```

### Paso 2: Modificar voucher/route.ts

```typescript
// src/app/api/creator/earnings/voucher/route.ts — agregar despues de la firma exitosa (linea 96)

// NG-V01: Registrar voucher en DB para audit trail
const { error: insertError } = await supabase
  .from('creator_withdrawal_vouchers')
  .insert({
    creator_id:        user.id,
    wallet_address:    profile.wallet_address,
    gross_amount_usdc: pendingUsdc,
    nonce,
    deadline:          Number(deadline),
    status:            'pending',
  })

if (insertError) {
  logger.error('[voucher] DB insert failed (non-fatal)', { insertError })
  // Non-fatal: el voucher ya fue firmado — no bloquear al usuario
}
```

### Paso 3: Modificar withdraw/route.ts para marcar voucher como claimed

```typescript
// src/app/api/creator/withdraw/route.ts — agregar despues del UPDATE a pending_earnings (linea 120)

// NG-V01: Marcar voucher como claimed
const nonceFromEvent = log.topics[4] // nonce is topics[4] in EarningsClaimed
if (nonceFromEvent) {
  void serviceClient
    .from('creator_withdrawal_vouchers')
    .update({ status: 'claimed', tx_hash: parsed.data.txHash, claimed_at: new Date().toISOString() })
    .eq('nonce', nonceFromEvent)
    .catch(err => logger.warn('[withdraw] voucher status update failed', { err }))
}
```

---

## NG-V02 (MEDIUM) — withdraw/route.ts: idempotencia de txHash

**Problema:** Enviar el mismo txHash dos veces al endpoint de withdraw borra earnings acumulados entre la primera y segunda llamada.

**Solucion:** Registrar txHash procesados y rechazar duplicados.

### Opcion A: Usar la tabla de vouchers (si se implementa NG-V01)

```typescript
// src/app/api/creator/withdraw/route.ts — agregar ANTES del UPDATE a pending_earnings (linea 115)

// NG-V02: Check idempotencia — ya procesamos este txHash?
const { data: existingWithdrawal } = await serviceClient
  .from('creator_withdrawal_vouchers')
  .select('id')
  .eq('tx_hash', parsed.data.txHash)
  .single()

if (existingWithdrawal) {
  return NextResponse.json(
    { error: 'This transaction has already been processed', txHash: parsed.data.txHash },
    { status: 409 }  // Conflict
  )
}
```

### Opcion B: Tabla dedicada (si NO se implementa NG-V01)

```sql
-- supabase/migrations/043_withdrawal_txhash_log.sql
CREATE TABLE creator_withdrawals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id),
  tx_hash    TEXT NOT NULL UNIQUE,
  amount_usdc NUMERIC(18,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE creator_withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Creators see own withdrawals"
  ON creator_withdrawals FOR SELECT
  USING (creator_id = auth.uid());
```

```typescript
// withdraw/route.ts — INSERT + check idempotencia en una sola operacion
const { error: insertError } = await serviceClient
  .from('creator_withdrawals')
  .insert({
    creator_id:  user.id,
    tx_hash:     parsed.data.txHash,
    amount_usdc: realAmount,
  })

if (insertError?.code === '23505') { // unique_violation
  return NextResponse.json(
    { error: 'This transaction has already been processed' },
    { status: 409 }
  )
}
```

---

## NG-V03 (LOW) — voucher/route.ts: agregar rate limiting

**Problema:** Sin rate limiting, un creator puede solicitar miles de vouchers por minuto causando DoS al servicio de firma.

**Solucion:** Agregar rate limiting usando el limiter existente.

```typescript
// src/app/api/creator/earnings/voucher/route.ts — agregar despues de auth (linea 25)
import { getKeysLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // NG-V03: Rate limiting — max 10 vouchers/hour per user
  const rlId = getIdentifier(req, user.id)
  const rlHit = await checkRateLimit(getKeysLimit(), rlId)
  if (rlHit) return rlHit

  // ... resto sin cambios
```

**Nota:** Reutilizamos `getKeysLimit()` (10 req/hour) que es apropiado para operaciones de retiro. Si se necesita un limiter mas restrictivo, crear uno dedicado:

```typescript
// En ratelimit.ts
let _voucher: Ratelimit | null = null
export function getVoucherLimit() {
  return _voucher ??= new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(5, '1 h'),  // 5 vouchers/hora max
    prefix: 'rl:voucher'
  })
}
```

---

## NG-V04 (INFO) — withdraw/route.ts: usar env vars para RPC

**Problema:** URLs de RPC hardcoded en withdraw/route.ts mientras el resto del codebase usa env vars.

**Solucion:** Usar el mismo patron que `marketplaceClient.ts`.

```typescript
// src/app/api/creator/withdraw/route.ts — reemplazar lineas 58-63

// NG-V04: Usar env vars para RPC (consistente con marketplaceClient.ts)
const rpcUrl = (chainId === 43114
  ? process.env.NEXT_PUBLIC_RPC_MAINNET
  : process.env.NEXT_PUBLIC_RPC_TESTNET
)?.trim() || undefined

const pub = createPublicClient({
  chain:     chainId === 43114 ? avalanche : avalancheFuji,
  transport: http(rpcUrl),   // usa env var, fallback a default de viem
})
```

---

## NA-V02 (INFO) — claimEarnings(): custom error para monitoring

**Problema:** El balance guard usa un error string generico. Custom errors mejoran monitoring y reducen gas.

**Solucion (futura version del contrato):**

```solidity
// contracts/src/WasiAIMarketplace.sol — agregar al inicio (secccion de errors)

error InsufficientFreeBalance(
    address creator,
    uint256 requested,
    uint256 available
);

// Dentro de claimEarnings() — reemplazar el require de balance guard:
uint256 freeBalance = usdc.balanceOf(address(this)) - totalKeyBalances;
if (freeBalance < grossAmount) {
    revert InsufficientFreeBalance(creator, grossAmount, freeBalance);
}
```

**Nota:** Esto requiere un nuevo deploy del contrato. Solo implementar en la proxima version.

---

## Hallazgos Abiertos Previos (recordatorio)

Los siguientes hallazgos siguen abiertos de auditorias anteriores:

| ID | Severidad | Solucion resumida |
|---|---|---|
| NG-103 | MEDIUM | Usar `await` en registerAgentOnChain() o retornar `on_chain_status: 'pending'` |
| NG-104 | MEDIUM | Cambiar RPC discover_agents_v2 de SECURITY DEFINER a SECURITY INVOKER con RLS |
| NA-302 | MEDIUM | Implementar cron de reconciliacion on-chain vs DB (Chainlink Automation o API cron) |
| NA-R01 | LOW | Cambiar `usdc.transferFrom()` a `usdc.safeTransferFrom()` en selfRegisterAgent |
| NA-R03 | INFO | Agregar `whenNotPaused` a submitReputationBatch() |
| NG-113 | INFO | `CREATE INDEX idx_agent_keys_owner_wallet ON agent_keys(owner_wallet_address)` |

---

## Orden de Implementacion Recomendado

| Prioridad | ID | Esfuerzo | Requiere deploy contrato? |
|---|---|---|---|
| 1 | NA-V01 | 5 min | **SI** (1 linea en claimEarnings) |
| 2 | NG-V02 | 30 min | NO |
| 3 | NG-V01 | 1 hora | NO (migracion + codigo) |
| 4 | NG-V03 | 10 min | NO |
| 5 | NG-V04 | 5 min | NO |
| 6 | NA-V02 | 5 min | **SI** (futura version) |
| 7 | NG-103 | 30 min | NO |
| 8 | NG-104 | 1 hora | NO (migracion RPC) |
| 9 | NA-302 | 2 horas | NO |

**Nota critica:** NA-V01 requiere un nuevo deploy del contrato. Se puede agrupar con NA-V02 y NA-R01 para minimizar deploys.

---

*Soluciones generadas por NexusAudit v2.0 + NexusGuard v1.0*
*Companion de NEXUS-AUDIT-REPORT.md v1.0*
