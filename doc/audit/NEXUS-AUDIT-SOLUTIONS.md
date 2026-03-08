# NEXUS-AUDIT-SOLUTIONS v3.0
## WasiAI Marketplace — Solutions Guide

**Fecha:** 2026-03-08
**Companion de:** `NEXUS-AUDIT-REPORT.md` v3.0 (8 nuevos hallazgos + 3 abiertos de v2)
**Instrucciones:** Cada solucion tiene codigo sugerido listo para implementar. El equipo de desarrollo aplica los fixes — este documento es solo guia.

---

## NG-108 (MEDIUM) — withdraw/route.ts: agregar guard de unicidad txHash

**Archivo:** `src/app/api/agent-keys/[id]/withdraw/route.ts`

### Opcion A: Tabla dedicada `key_withdrawals` (recomendada)

Crear una tabla que registre cada retiro procesado, con UNIQUE constraint en `tx_hash`:

```sql
-- Nueva migracion: 043_key_withdrawals.sql
CREATE TABLE IF NOT EXISTS key_withdrawals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id      UUID NOT NULL REFERENCES agent_keys(id),
  tx_hash     TEXT NOT NULL UNIQUE,
  amount_usdc NUMERIC(18, 6) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_key_withdrawals_tx_hash
  ON key_withdrawals (tx_hash);
```

En el route, insertar ANTES de actualizar agent_keys (patron atomic claim):

```typescript
// withdraw/route.ts — agregar ANTES del update de budget_usdc (paso 11)
const { error: claimError } = await serviceClient
  .from('key_withdrawals')
  .insert({
    key_id:      id,
    tx_hash:     parsed.data.txHash,
    amount_usdc: realAmount,
  })

if (claimError) {
  // UNIQUE violation = replay attempt
  logger.warn('[withdraw] txHash replay attempt blocked', { txHash: parsed.data.txHash })
  return NextResponse.json(
    { error: 'Transaction already processed', code: 'REPLAY_DETECTED' },
    { status: 409 }
  )
}
// ... continuar con el update de agent_keys
```

### Opcion B: Insertar en agent_calls con key_id

Si no se quiere una tabla nueva, insertar el retiro en `agent_calls` (la migracion 041 ya tiene UNIQUE en tx_hash):

```typescript
// Antes del update de budget_usdc
const { error: claimError } = await serviceClient
  .from('agent_calls')
  .insert({
    agent_id:    keyRow.key_id ?? 'withdraw',  // campo nullable
    caller_type: 'withdraw',
    tx_hash:     parsed.data.txHash,
    amount_paid: realAmount,
    status:      'success',
    latency_ms:  0,
  })
if (claimError) {
  return NextResponse.json({ error: 'Transaction already processed' }, { status: 409 })
}
```

---

## NG-111 (MEDIUM) — Route C custodial: documentar o migrar a settlement on-chain

**Archivos:** `src/features/payments/hooks/useWalletPayment.ts`, `src/lib/contracts/verifyUsdcTransfer.ts`

### Opcion A: Documentar diseno custodial (si es intencional)

Si Route C es intencionalmente custodial por simplicidad para embedded wallets, agregar:

1. Comentario explicito en el codigo:
```typescript
// useWalletPayment.ts:124 — agregar comentario
// DESIGN DECISION: Route C is a custodial payment flow.
// USDC goes to OPERATOR_ADDRESS (not marketplace contract).
// The operator settles earnings to creators via off-chain DB accounting.
// This is acceptable for Thirdweb embedded wallets (Google/email login)
// which cannot sign EIP-3009 (required for on-chain settlement).
// Audited as WAS-X / NG-111. See doc/audit/NEXUS-AUDIT-SOLUTIONS.md.
```

2. Mostrar en el dashboard que el pago es off-chain:
```typescript
// En el componente que muestra el resultado del pago
{isThirdweb && (
  <p className="text-xs text-gray-400 mt-1">
    Pago procesado off-chain. El creador recibe sus ganancias diariamente.
  </p>
)}
```

### Opcion B: Migrar Route C a settlement on-chain

Para garantizar que los creadores ven sus fondos inmediatamente en el contrato, el operador debe llamar `recordInvocation()` tras recibir el USDC de Route C:

```typescript
// En invoke/route.ts, dentro del bloque Route C, tras actualizar DB:
if (resultC.status === 'success' && CONTRACT_ADDRESS) {
  // Fire-and-forget: liquidar on-chain para que el creador vea sus earnings
  const paymentId = keccak256(encodePacked(
    ['string', 'address', 'uint256'],
    [slug, fromAddress, BigInt(Math.round(totalPrice * 1e6))]
  ))
  void recordInvocationOnChain({
    slug,
    payerAddress: fromAddress,  // del receipt verificado
    amountUSDC:   creatorPrice,
    paymentId,
  }).catch(err => logger.warn('[invoke-routeC] recordInvocation failed', { err }))
}
```

**Prerequisito:** El operador debe primero transferir el USDC al contrato, o el contrato debe tener saldo suficiente. Alternativa: usar `recordInvocation` solo para el split de earnings sin requerir que el USDC ya este en el contrato.

---

## NA-R01 (LOW) — safeTransferFrom en selfRegisterAgent

**Archivo:** `contracts/src/WasiAIMarketplace.sol:262-265`

```solidity
// ANTES (bare transferFrom):
require(
    usdc.transferFrom(msg.sender, address(this), registrationFee),
    "Fee transfer failed"
);

// DESPUES (SafeERC20 pattern — consistente con el resto del contrato):
usdc.safeTransferFrom(msg.sender, address(this), registrationFee);
// safeTransferFrom revierte automaticamente si retorna false o si no retorna bool
```

El contrato ya tiene `using SafeERC20 for IERC20`, por lo que no se necesitan cambios de imports.

---

## NA-R02 (LOW) — Reordenar validaciones en selfRegisterAgent

**Archivo:** `contracts/src/WasiAIMarketplace.sol:254-287`

```solidity
// ANTES — validaciones despues del cobro de fee:
function selfRegisterAgent(string calldata slug, uint256 pricePerCall, uint64 erc8004Id)
    external whenNotPaused
{
    uint256 userCount = userRegistrationCount[msg.sender];
    if (registrationFee > 0 && userCount >= freeRegistrationsPerUser) {
        require(usdc.transferFrom(msg.sender, address(this), registrationFee), "Fee transfer failed");
    }
    userRegistrationCount[msg.sender] = userCount + 1;
    require(bytes(slug).length > 0 && bytes(slug).length <= 80, "Invalid slug length");
    require(pricePerCall >= 1000 && pricePerCall <= 100_000_000, "Price out of range");
    require(agents[slug].creator == address(0), "WasiAI: slug taken");
    // ...
}

// DESPUES — validar inputs primero, cobrar fee despues:
function selfRegisterAgent(string calldata slug, uint256 pricePerCall, uint64 erc8004Id)
    external whenNotPaused
{
    // 1. Validar todos los inputs ANTES de cualquier transferencia
    require(bytes(slug).length > 0 && bytes(slug).length <= 80, "Invalid slug length");
    require(pricePerCall >= 1000 && pricePerCall <= 100_000_000, "Price out of range");
    require(agents[slug].creator == address(0), "WasiAI: slug taken");

    // 2. Cobrar fee solo si los inputs son validos
    uint256 userCount = userRegistrationCount[msg.sender];
    if (registrationFee > 0 && userCount >= freeRegistrationsPerUser) {
        usdc.safeTransferFrom(msg.sender, address(this), registrationFee);  // NA-R01 fix incluido
    }
    userRegistrationCount[msg.sender] = userCount + 1;

    // 3. Registrar agente
    agents[slug] = Agent({ creator: msg.sender, pricePerCall: pricePerCall, erc8004Id: erc8004Id });
    emit AgentRegistered(slug, msg.sender, pricePerCall, erc8004Id);
}
```

---

## NG-109 (LOW) — Eliminar fallback hardcodeado en verifyUsdcTransfer.ts

**Archivo:** `src/lib/contracts/verifyUsdcTransfer.ts:10-14`

```typescript
// ANTES — fallback hardcodeado silencioso:
const OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? process.env.NEXT_PUBLIC_OPERATOR_ADDRESS
  ?? '0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB'
).toLowerCase()

// DESPUES — fallar explicitamente si env var no configurada:
const _operatorRaw = process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? process.env.NEXT_PUBLIC_OPERATOR_ADDRESS

if (!_operatorRaw) {
  throw new Error('[verifyUsdcTransfer] NEXT_PUBLIC_WASIAI_OPERATOR not configured')
}
const OPERATOR_ADDRESS = _operatorRaw.toLowerCase()
```

O si se prefiere manejar gracefully:
```typescript
const OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? process.env.NEXT_PUBLIC_OPERATOR_ADDRESS
  ?? (() => { throw new Error('NEXT_PUBLIC_WASIAI_OPERATOR not set') })()
).toLowerCase()
```

---

## NA-R03 (INFO) — Agregar whenNotPaused a submitReputationBatch

**Archivo:** `contracts/src/WasiAIMarketplace.sol:811`

```solidity
// ANTES:
function submitReputationBatch(
    string[] calldata slugs,
    uint16[] calldata avgRatings,
    uint32[] calldata voteCounts
) external onlyOperator {

// DESPUES — consistente con el patron del contrato:
function submitReputationBatch(
    string[] calldata slugs,
    uint16[] calldata avgRatings,
    uint32[] calldata voteCounts
) external onlyOperator whenNotPaused {
```

Si el diseno intencional es permitir escribir reputaciones incluso en pausa, agregar un comentario explicito:
```solidity
// NOTE: Intentionally no whenNotPaused — reputation data is non-financial
// and should remain updatable even during contract emergency pause.
```

---

## NG-112 (INFO) — Debounce en dual-connection guard de useWallet.ts

**Archivo:** `src/features/wallet/hooks/useWallet.ts:29-34`

```typescript
// ANTES — puede dispararse en ventanas de transicion:
useEffect(() => {
  if (thirdwebAccount && wagmiConnected) {
    wagmiDisconnect()
  }
}, [thirdwebAccount, wagmiConnected, wagmiDisconnect])

// DESPUES — con debounce para evitar race conditions:
useEffect(() => {
  if (!thirdwebAccount || !wagmiConnected) return

  // Debounce 200ms: esperar que ambos estados se estabilicen
  const timeout = setTimeout(() => {
    if (thirdwebAccount && wagmiConnected) {
      wagmiDisconnect()
    }
  }, 200)

  return () => clearTimeout(timeout)
}, [thirdwebAccount, wagmiConnected, wagmiDisconnect])
```

---

## NG-113 (INFO) — Agregar indice en owner_wallet_address

**Archivo:** `supabase/migrations/042_owner_wallet_address.sql` (o nueva migracion 043)

```sql
-- Agregar al final de 042, o en una nueva migracion 043:
CREATE INDEX IF NOT EXISTS idx_agent_keys_owner_wallet_address
  ON agent_keys (owner_wallet_address)
  WHERE owner_wallet_address IS NOT NULL;
```

---

## Hallazgos Abiertos de v2 (No Resueltos en v3)

### NG-103 (MEDIUM) — register/route.ts fire-and-forget

Solucion propuesta en NEXUS-AUDIT-SOLUTIONS v2.0 (seccion NG-103). Requiere cambiar el flujo de registro off-chain para no establecer `on_chain_registered: true` hasta confirmar el tx. El patron HAL-025 implementado en `upgrade-onchain/route.ts` es el modelo a seguir.

### NG-104 (MEDIUM) — discover_agents_v2 SECURITY DEFINER

Solucion propuesta en NEXUS-AUDIT-SOLUTIONS v2.0 (seccion NG-104). Cambiar `SECURITY DEFINER` a `SECURITY INVOKER` en la funcion RPC de PostgreSQL.

```sql
-- supabase/migrations/039_dual_registration.sql (fix parcial):
CREATE OR REPLACE FUNCTION discover_agents_v2(...)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY INVOKER  -- cambiar de DEFINER a INVOKER
AS $$
-- ...
$$;
```

### NA-302 (MEDIUM) — Sin cron de reconciliacion on-chain

Solucion propuesta en NEXUS-AUDIT-SOLUTIONS v2.0 (seccion NA-302). Crear endpoint cron que compare `agents.registration_type` en DB vs `agents[slug].creator != address(0)` en el contrato para detectar divergencias.

---

*Generado por NexusAudit v2.0 + NexusGuard v1.0 | WasiAI Security Framework | 2026-03-08*
