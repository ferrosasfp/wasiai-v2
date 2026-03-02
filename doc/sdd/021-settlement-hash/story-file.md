# Story File — SDD #021: WAS-93 Settlement Hash On-Chain
**Sprint 12 | WAS-93 [SHK-01]**
**Classification: QUALITY — HU-MAJOR**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

NexusAudit finding SHK-01: El settlement off-chain no es verificable on-chain.
Cuando el operador llama `recordInvocation`, no hay forma de probar que ese pago
corresponde a una invocación real del API. Un auditor externo no puede correlacionar
los eventos on-chain con los registros off-chain.

El `paymentId` (bytes32) ya existe pero es generado por el backend sin estructura
verificable. La solución es hacer que ese `paymentId` sea un hash determinístico
de los parámetros de la invocación, de modo que cualquiera pueda recalcularlo.

---

## Acceptance Criteria

- AC1: `paymentId` en `recordInvocation` debe ser `keccak256(abi.encodePacked(slug, payer, amount, nonce, chainId))`
- AC2: El contrato verifica que el `paymentId` recibido coincide con el hash calculado
- AC3: La API `/api/invoke` genera y almacena este hash antes de procesar el pago
- AC4: La API `/api/settlement/route.ts` incluye el hash en el cuerpo del settlement
- AC5: Cualquier tercero puede recalcular el hash con los datos públicos y verificar on-chain
- AC6: Tests forge cubren: hash correcto pasa, hash incorrecto revierte
- AC7: `npx tsc --noEmit` = 0 errores

---

## Approach: NO ABI change — verificación off-chain + view helper

Para no romper el ABI de `recordInvocation` ni el SDK, la verificación
es **off-chain verificable** en lugar de on-chain obligatoria.

El `paymentId` que ya existe pasa a ser un hash determinístico generado
por la API. Cualquier auditor puede recalcularlo con los datos de Supabase.
El contrato agrega solo una función `view` para facilitar esa verificación.

---

## Implementation

### Wave 1 — Contrato (solo agrega view helper, NO modifica recordInvocation)

**File:** `contracts/src/WasiAIMarketplace.sol`

Agregar SOLO esta función view (sin tocar `recordInvocation`):

```solidity
/// @notice Compute the canonical paymentId for an invocation.
/// @dev    Off-chain verifiable: anyone can recompute with public data.
///         paymentId = keccak256(slug, payer, amount, nonce, chainId)
function computePaymentId(
    string  calldata slug,
    address          payer,
    uint256          amount,
    bytes32          nonce
) external view returns (bytes32) {
    return keccak256(abi.encodePacked(slug, payer, amount, nonce, block.chainid));
}
```

**No modificar `recordInvocation`** — el ABI se mantiene intacto.
El `paymentId` ya existente es el hash — la API lo genera correctamente.

### Wave 2 — API Next.js

**File:** `src/lib/payments/computePaymentId.ts` (nuevo)

```typescript
import { keccak256, encodePacked } from 'viem'
import { env } from '@/lib/env'

export function computePaymentId(
  slug: string,
  payer: `0x${string}`,
  amount: bigint,
  nonce: `0x${string}`
): `0x${string}` {
  const chainId = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? '43113')
  return keccak256(
    encodePacked(
      ['string', 'address', 'uint256', 'bytes32', 'uint256'],
      [slug, payer, amount, nonce, chainId]
    )
  )
}
```

**File:** `src/app/api/invoke/route.ts`
- Leer el archivo completo antes de modificar
- Generar `nonce` como bytes32 aleatorio: `crypto.getRandomValues(new Uint8Array(32))` → hex
- Calcular `paymentId = computePaymentId(slug, payer, amount, nonce)`
- Almacenar `nonce` en Supabase junto al registro de invocación
- El `paymentId` resultante es el que se pasa a `recordInvocation` (sin cambio de ABI)

**File:** `src/app/api/settlement/route.ts`
- Leer el archivo completo antes de modificar
- Si `paymentId` ya se genera en este archivo, asegurarse que use `computePaymentId`
- Si viene de Supabase, verificar que el `nonce` esté almacenado

### Wave 3 — Tests contrato

**File:** `contracts/test/WasiAIMarketplace.t.sol`

```solidity
function test_ComputePaymentId_Deterministic() public view {
    bytes32 nonce = keccak256("test-nonce-1");
    bytes32 id1 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce);
    bytes32 id2 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce);
    assertEq(id1, id2, "Same inputs = same paymentId");
}

function test_ComputePaymentId_DifferentNonce_DifferentId() public view {
    bytes32 nonce1 = keccak256("nonce-1");
    bytes32 nonce2 = keccak256("nonce-2");
    bytes32 id1 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce1);
    bytes32 id2 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce2);
    assertTrue(id1 != id2, "Different nonce = different paymentId");
}

function test_ComputePaymentId_MatchesExpected() public view {
    bytes32 nonce = bytes32(uint256(1));
    bytes32 expected = keccak256(abi.encodePacked(SLUG, payer, PRICE, nonce, block.chainid));
    bytes32 result = marketplace.computePaymentId(SLUG, payer, PRICE, nonce);
    assertEq(result, expected);
}
```

---

## Wave Order

W1 → forge build → W2 → npx tsc --noEmit → W3 → forge test → commit

---

## Critical Constraints

1. **NO cambiar ABI de `recordInvocation`** — solo agregar `computePaymentId` view
2. **NO modificar SDK** — el ABI no cambia, SDK sigue funcionando
3. **chainId usa `block.chainid`** en contrato (dinámico), `NEXT_PUBLIC_CHAIN_ID` en API
4. **Leer invoke/route.ts y settlement/route.ts completos** antes de modificar
5. **Fuji v9 deploy** — solo por la nueva función view (cambio menor)
