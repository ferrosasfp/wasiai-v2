# SDD #067 — Earnings Voucher Architecture

> SPEC_APPROVED: no
> Fecha: 2026-03-08
> Tipo: feature
> SDD_MODE: full
> Branch: feat/067-earnings-voucher-architecture
> Artefactos: doc/sdd/067-earnings-voucher-architecture/

---

## 1. Resumen

Reemplazar el flujo de earnings x402 por arquitectura voucher. Hoy el USDC llega al contrato via `transferWithAuthorization` pero `recordInvocation()` nunca se llama — los earnings no se distribuyen. La solución: contabilidad off-chain en Supabase (sin gas por invocación) + nueva función `claimEarnings()` en el contrato que verifica un voucher firmado por el operador, deduce el 10% al treasury on-chain, y transfiere el 90% al creator.

El creator paga gas **una sola vez** al retirar. El operador deja de pagar gas por `recordInvocation` en cada invocación (~60,000 gas ahorrados por llamada).

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 067 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Earnings x402 funcionales: contabilidad off-chain + retiro con voucher EIP-712 firmado por operador |
| **Reglas de negocio** | Voucher es monto bruto; contrato deduce 10% treasury on-chain; nonce único anti-replay; deadline 1 hora; creator paga gas solo al retirar |
| **Scope IN** | `claimEarnings()` en contrato + redeploy · `POST /api/creator/earnings/voucher` · `invoke route` suma earnings post-settlement · `WithdrawButton` con flujo voucher · `POST /api/creator/withdraw` limpia DB |
| **Scope OUT** | Agent Keys, `usdcSettler.ts`, `recordInvocation()`, mainnet, tests automáticos |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

| # | Criterio |
|---|----------|
| AC-1 | WHEN x402 settlement exitoso, THE invoke route SHALL llamar `increment_pending_earnings(model.creator_id, price_per_call)` via RPC Supabase |
| AC-2 | WHEN creator solicita voucher (`POST /api/creator/earnings/voucher`), THE backend SHALL firmar voucher EIP-712 con `(creator, grossAmount, deadline, nonce)` y retornarlo |
| AC-3 | WHEN creator llama `claimEarnings(grossAmount, deadline, nonce, sig)`, THE contrato SHALL verificar firma operador, enviar 10% al treasury, enviar 90% al `msg.sender`, marcar nonce como usado |
| AC-4 | IF nonce ya usado, THEN THE contrato SHALL revertir `"WasiAI: voucher already used"` |
| AC-5 | IF `block.timestamp > deadline`, THEN THE contrato SHALL revertir `"WasiAI: voucher expired"` |
| AC-6 | IF `usdc.balanceOf(address(this)) - totalKeyBalances < grossAmount`, THEN THE contrato SHALL revertir `"WasiAI: insufficient free balance"` |
| AC-7 | WHEN `claimEarnings` confirmada, THE backend SHALL poner `pending_earnings_usdc = 0` para ese creator |
| AC-8 | WHILE `pending_earnings_usdc == 0`, THE botón "Withdraw USDC →" SHALL estar deshabilitado |
| AC-9 | WHEN `claimEarnings` exitosa, THE UI SHALL mostrar link al explorer |

---

## 3. Context Map (Codebase Grounding)

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `contracts/src/WasiAIMarketplace.sol` | Contrato a modificar | Imports OZ, `platformFeeBps`, `treasury`, `totalKeyBalances`, `nonReentrant`, patrón `usedPaymentIds` como anti-replay |
| `contracts/script/DeployMarketplace.s.sol` | Script de deploy | Constructor `(usdc, treasury)`, `setOperator(operator, true)` post-deploy |
| `contracts/foundry.toml` | Build config | `@openzeppelin/` remapping, `solc 0.8.24` |
| `contracts/lib/openzeppelin-contracts/contracts/utils/cryptography/` | Disponibilidad ECDSA | `ECDSA.sol` + `EIP712.sol` disponibles |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Invoke route | `model.creator_id` disponible, `settlePaymentDirectly` retorna `{ verified, transactionHash }`, punto de inserción post-settlement línea ~476 |
| `supabase/migrations/015_onboarding-fields.sql` | RPC existente | `increment_pending_earnings(p_user_id UUID, p_amount NUMERIC)` ya existe, atómico |
| `src/app/api/creator/withdraw/route.ts` | Route a reusar | Patrón auth + Supabase profile + public client + retry 3× |
| `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` | UI a modificar | Patrón `writeContract` + `waitForTransactionReceipt` + estados + i18n — HU-064 |
| `src/lib/contracts/abis.ts` | ABI constants | Patrón `WITHDRAW_KEY_ABI` / `WITHDRAW_EARNINGS_ABI` |

### Exemplars

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| `claimEarnings()` en Solidity | `recordInvocation()` (líneas 360-401) | Misma estructura: anti-replay via mapping, split platformShare/creatorShare, safeTransfer |
| `CLAIM_EARNINGS_ABI` | `WITHDRAW_EARNINGS_ABI` en `abis.ts` | Mismo patrón de constante ABI |
| `POST /api/creator/earnings/voucher` | `POST /api/agent-keys/[id]/withdraw/route.ts` | Auth + Supabase + operador firma con `OPERATOR_PRIVATE_KEY` |
| `WithdrawButton` flujo voucher | `WithdrawButton.tsx` actual (HU-064) | Mismo patrón `writeContract` + estados + i18n |

### Estado de BD relevante

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `creator_profiles` | ✅ | `pending_earnings_usdc NUMERIC(20,6) DEFAULT 0`, `wallet_address` |
| RPC `increment_pending_earnings` | ✅ | `(p_user_id UUID, p_amount NUMERIC)` — atómico |

### Componentes reutilizables

- `validateCsrf` de `@/lib/security/csrf` — en el voucher API route
- `createClient` de `@/lib/supabase/server` — en el voucher API route
- `createPublicClient` / `http` de `viem` — en el voucher API route (verificar receipt post-claim)
- `CHAIN_ID` / `IS_MAINNET` de `@/lib/chain` — en WithdrawButton y voucher route
- `snowscanTx` de `@/lib/chain` — en WithdrawButton para link explorer

---

## 4. Diseño Técnico

### 4.1 Contrato — `claimEarnings()`

```solidity
// Nuevas imports (ya disponibles en OZ)
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

// Contrato hereda también de EIP712
contract WasiAIMarketplace is
    Ownable2Step,
    Pausable,
    ReentrancyGuard,
    AutomationCompatibleInterface,
    EIP712("WasiAIMarketplace", "1")   // ← nuevo

// Nuevo storage
mapping(bytes32 => bool) public usedVouchers;

// TypeHash
bytes32 private constant CLAIM_TYPEHASH = keccak256(
    "ClaimEarnings(address creator,uint256 grossAmount,uint256 deadline,bytes32 nonce)"
);

// Nuevo evento
event EarningsClaimed(address indexed creator, uint256 grossAmount, uint256 creatorShare, uint256 platformShare, bytes32 nonce);

/**
 * @notice Creator reclama earnings acumulados con voucher firmado por el operador.
 * @param grossAmount  USDC en atomics (monto bruto — contrato deduce platform fee)
 * @param deadline     Unix timestamp de expiración del voucher
 * @param nonce        bytes32 único anti-replay
 * @param sig          Firma EIP-712 del operador sobre (creator, grossAmount, deadline, nonce)
 */
function claimEarnings(
    uint256 grossAmount,
    uint256 deadline,
    bytes32 nonce,
    bytes calldata sig
) external nonReentrant whenNotPaused {
    require(block.timestamp <= deadline,    "WasiAI: voucher expired");
    require(!usedVouchers[nonce],           "WasiAI: voucher already used");
    require(grossAmount > 0,               "WasiAI: zero amount");

    // Verificar firma del operador
    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
        CLAIM_TYPEHASH,
        msg.sender,
        grossAmount,
        deadline,
        nonce
    )));
    address signer = ECDSA.recover(digest, sig);
    require(operators[signer], "WasiAI: invalid operator signature");

    // Proteger keyBalances de Agent Keys
    require(
        usdc.balanceOf(address(this)) - totalKeyBalances >= grossAmount,
        "WasiAI: insufficient free balance"
    );

    usedVouchers[nonce] = true;

    uint256 platformShare = (grossAmount * platformFeeBps) / 10_000;
    uint256 creatorShare  = grossAmount - platformShare;

    usdc.safeTransfer(msg.sender, creatorShare);
    if (platformShare > 0) {
        usdc.safeTransfer(treasury, platformShare);
    }

    emit EarningsClaimed(msg.sender, grossAmount, creatorShare, platformShare, nonce);
}
```

### 4.2 Backend — `POST /api/creator/earnings/voucher`

```typescript
// Firma EIP-712 con OPERATOR_PRIVATE_KEY
// Body recibido: {} (sin parámetros — el amount viene de Supabase)
// Proceso:
// 1. Auth check
// 2. Leer creator_profiles.pending_earnings_usdc (monto bruto)
// 3. Verificar wallet_address configurada
// 4. Generar nonce: keccak256(creator + timestamp + random)
// 5. deadline = now + 3600 (1 hora)
// 6. Firmar EIP-712 con operador
// 7. Retornar { grossAmount, deadline, nonce, signature }
```

Firma EIP-712 en TypeScript (viem):
```typescript
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, encodeAbiParameters, parseAbiParameters, toHex, randomBytes } from 'viem'

const operatorAccount = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY as `0x${string}`)

const domain = {
  name:              'WasiAIMarketplace',
  version:           '1',
  chainId:           CHAIN_ID,
  verifyingContract: MARKETPLACE_ADDRESS as `0x${string}`,
}

const types = {
  ClaimEarnings: [
    { name: 'creator',     type: 'address' },
    { name: 'grossAmount', type: 'uint256' },
    { name: 'deadline',    type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
}

const nonce = keccak256(encodeAbiParameters(
  parseAbiParameters('address, uint256, bytes32'),
  [walletAddress as `0x${string}`, BigInt(Date.now()), toHex(randomBytes(16), { size: 32 })]
))

const signature = await operatorAccount.signTypedData({
  domain,
  types,
  primaryType: 'ClaimEarnings',
  message: {
    creator:     walletAddress as `0x${string}`,
    grossAmount: BigInt(Math.round(grossAmount * 1_000_000)),
    deadline:    BigInt(deadline),
    nonce,
  },
})
```

### 4.3 Backend — invoke route: sumar earnings post-settlement

Insertar después de línea ~476 (post settlement verificado, pre `buildResponse`):

```typescript
// HU-067: Sumar earnings off-chain para el creator
if (settlement.verified && model.creator_id) {
  const atomicPrice = Math.round(creatorPrice * 1_000_000)
  await supabase.rpc('increment_pending_earnings', {
    p_user_id: model.creator_id as string,
    p_amount:  atomicPrice / 1_000_000,   // NUMERIC en USDC, no atomics
  }).catch(err => logger.error('[invoke] increment_pending_earnings failed', { err }))
}
```

### 4.4 Frontend — `WithdrawButton` flujo voucher

```typescript
// Nuevo flujo handleWithdraw:
// 1. setStatus('requesting')  → fetch POST /api/creator/earnings/voucher
// 2. Recibir { grossAmount, deadline, nonce, signature }
// 3. setStatus('signing')     → writeContract claimEarnings(grossAmount, deadline, nonce, sig)
// 4. setStatus('confirming')  → waitForTransactionReceipt
// 5. POST /api/creator/withdraw { txHash } → limpia pending_earnings_usdc = 0
// 6. setStatus('success')
```

Nuevo estado añadido: `'requesting'` (esperando voucher del API).

### 4.5 `CLAIM_EARNINGS_ABI` en abis.ts

```typescript
export const CLAIM_EARNINGS_ABI = [
  {
    name:            'claimEarnings',
    type:            'function' as const,
    inputs:          [
      { name: 'grossAmount', type: 'uint256' },
      { name: 'deadline',    type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'sig',         type: 'bytes'   },
    ],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
```

---

## 5. Constraint Directives

### OBLIGATORIO
- `claimEarnings` hereda de `EIP712("WasiAIMarketplace", "1")` — domainSeparator calculado por el contrato
- `require(operators[signer])` — no `require(signer == operator)`, por consistencia con patrón `onlyOperator` del contrato
- `totalKeyBalances` en el guard de balance — proteger Agent Keys
- `increment_pending_earnings` RPC para actualizar Supabase — atómico, no `UPDATE` directo
- `pending_earnings_usdc` almacena USDC en unidades humanas (no atomics) — igual que el RPC existente
- `CLAIM_EARNINGS_ABI` en `src/lib/contracts/abis.ts` — no inline en ningún componente
- Todos los strings UI via `useTranslations('dashboard')` — 0 hardcoded
- `forge build` + `forge test` antes de broadcast

### PROHIBIDO
- NO modificar `usdcSettler.ts`
- NO modificar Agent Keys (`withdrawKey`, `keyInvoke`, `refundKeyToEarnings`)
- NO eliminar `recordInvocation()` del contrato — backward compat
- NO hardcodear `domainSeparator` — usar `_hashTypedDataV4` de OZ EIP712
- NO confiar en el `grossAmount` del cliente — el API route lee `pending_earnings_usdc` de Supabase
- NO deployar a mainnet
- NO agregar dependencias npm nuevas

---

## 6. Readiness Check

```
[✅] Cada AC tiene al menos 1 archivo asociado en waves
[✅] Cada archivo tiene Exemplar válido (verificado con grep)
[✅] No hay [NEEDS CLARIFICATION] pendientes
[✅] Constraint Directives: 8 OBLIGATORIO + 7 PROHIBIDO
[✅] Context Map: 9 archivos leídos
[✅] Scope IN y OUT explícitos
[✅] BD: pending_earnings_usdc verificada (existe, NUMERIC(20,6))
[✅] RPC increment_pending_earnings verificado (existe, atómico)
[✅] ECDSA + EIP712 disponibles en lib OZ instalada
[✅] operators[] mapping verificado en contrato (patrón para signer check)
```

---

## 7. Waves (resumen)

```
W0 (serial):  Solidity claimEarnings + forge build/test + redeploy Fuji + .env
W1 (paralelo): W1.1 verify DB schema | W1.2 voucher API | W1.3 invoke earnings
W2 (serial):  WithdrawButton flujo voucher + POST /api/creator/withdraw limpia DB
W3 (QG):      tsc + lint + build
```
