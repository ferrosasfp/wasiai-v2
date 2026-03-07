# SDD #050: Agent Keys — Migrar wallet a sistema unificado thirdweb

> SPEC_APPROVED: no
> Fecha: 2026-03-07
> Tipo: improvement
> SDD_MODE: full
> Branch: feat/050-agent-keys-unified-wallet
> Artefactos: doc/sdd/050-agent-keys-unified-wallet/

---

## 1. Resumen

La página `/agent-keys` usa `window.ethereum` directamente, lo que la hace incompatible
con wallets embedded (Google/email via thirdweb). Se migran `DepositModal` y `WithdrawModal`
para usar los hooks unificados `useWallet()` + `useUnifiedWalletClient()` que ya existen en
el proyecto, permitiendo que cualquier tipo de wallet (EOA o embedded) pueda depositar USDC
y retirar fondos de sus Agent Keys sin cambiar nada en el servidor.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 050 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Reemplazar `window.ethereum` en DepositModal y WithdrawModal por hooks unificados thirdweb |
| **Reglas de negocio** | Creator paga gas en retiros (EOA: AVAX propio; Embedded: thirdweb sponsorea) |
| **Scope IN** | `src/app/[locale]/agent-keys/page.tsx` únicamente |
| **Scope OUT** | APIs, CloseKeyModal, hooks, DB schema |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

**AC-1:** WHEN el usuario tiene wallet embedded (Google/email) conectada,
THEN el botón "Add USDC" está habilitado y el depósito funciona sin `window.ethereum`.

**AC-2:** WHEN el usuario tiene wallet EOA (Core Wallet) conectada vía thirdweb,
THEN el botón "Add USDC" está habilitado y el depósito funciona.

**AC-3:** WHEN el usuario ejecuta un depósito,
THEN firma EIP-3009 (`TransferWithAuthorization`) via `signTypedData` sin pagar gas.

**AC-4:** WHEN el usuario ejecuta un retiro,
THEN `withdrawKey()` se ejecuta on-chain via `writeContract` y el gas lo paga el creator.

**AC-5:** WHEN el usuario no tiene wallet conectada,
THEN los botones de depósito y retiro muestran error claro "Wallet no conectada".

**AC-6:** WHEN la tx de retiro se confirma on-chain,
THEN el DB se sincroniza y el balance de la key se actualiza en UI.

**AC-7:** IF la wallet está en chain incorrecta,
THEN se muestra error indicando que debe cambiar a Avalanche Fuji/Mainnet.

---

## 3. Context Map (Codebase Grounding)

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/features/wallet/hooks/useWallet.ts` | Fuente de `address`, `isConnected`, `isThirdweb`, `chain` | `const { address, isConnected, chain } = useWallet()` |
| `src/features/wallet/hooks/useUnifiedWalletClient.ts` | Fuente de `signTypedData`, `writeContract` | `const { signTypedData, writeContract, isReady } = useUnifiedWalletClient()` |
| `src/app/[locale]/agent-keys/page.tsx` | Archivo a migrar | `window.ethereum` en DepositModal (líneas 72-167) y WithdrawModal (líneas 307-373) |
| `src/features/payments/hooks/useWalletPayment.ts` | Referencia de cómo se usa `signTypedData` con EIP-3009 | Patrón de firma EIP-712 con `signTypedData` |

### Exemplars

| Para modificar | Seguir patrón de | Razón |
|---------------|------------------|-------|
| `DepositModal` — firma EIP-3009 | `useWalletPayment.ts` líneas 90-190 | Mismo patrón EIP-712 `signTypedData` |
| `WithdrawModal` — writeContract | `useWalletPayment.ts` líneas 125-145 | Mismo patrón `writeContract` con ABI inline |

### Componentes reutilizables encontrados

- `useWallet()` en `src/features/wallet/hooks/useWallet.ts` — provee `address`, `chain`, `isConnected`
- `useUnifiedWalletClient()` en `src/features/wallet/hooks/useUnifiedWalletClient.ts` — provee `signTypedData`, `writeContract`, `isReady`

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/app/[locale]/agent-keys/page.tsx` | Modificar | Reemplazar `window.ethereum` por hooks en `DepositModal` y `WithdrawModal` | `src/features/payments/hooks/useWalletPayment.ts` |

### 4.2 Modelo de datos

N/A — No hay cambios de BD.

### 4.3 Componentes / Servicios

**DepositModal** — cambios quirúrgicos:
- Eliminar bloque `window.ethereum` (request accounts, chainId, eth_signTypedData_v4)
- Agregar al top del componente:
  ```
  const { address, chain } = useWallet()
  const { signTypedData, isReady } = useUnifiedWalletClient()
  ```
- Usar `address` directo en lugar de `accounts[0]`
- Verificar chain con `chain?.id !== CHAIN_ID` en lugar de `eth_chainId`
- Reemplazar `eth_signTypedData_v4` por `signTypedData({ domain, types, primaryType, message })`

**WithdrawModal** — cambios quirúrgicos:
- Eliminar bloque `window.ethereum` (request accounts, chainId, eth_sendTransaction)
- Agregar al top del componente:
  ```
  const { address, chain } = useWallet()
  const { writeContract, isReady } = useUnifiedWalletClient()
  ```
- Usar `address` directo
- Verificar chain con `chain?.id !== CHAIN_ID`
- Reemplazar `eth_sendTransaction` con ABI manual por `writeContract({ address, abi, functionName, args })`
- Para polling del receipt: usar `viem` `createPublicClient` + `waitForTransactionReceipt` (ya existe en el proyecto via `usdcSettler.ts`)

### 4.4 ABI para withdrawKey

```typescript
const WITHDRAW_KEY_ABI = [
  {
    name: 'withdrawKey',
    type: 'function',
    inputs: [
      { name: 'keyId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
```

### 4.5 Flujo principal — Deposit (Happy Path)

1. Usuario abre `DepositModal`
2. `useWallet()` provee `address` y `chain` — no se piden cuentas
3. Se valida `chain?.id === CHAIN_ID`
4. Se construye typed data EIP-712
5. `signTypedData()` solicita firma al usuario (1 firma, sin gas)
6. Se extraen `v, r, s` de la firma
7. POST a `/api/agent-keys/${keyId}/deposit` con la firma
8. Server ejecuta `transferWithAuthorization` on-chain
9. UI muestra ✅

### 4.6 Flujo principal — Withdraw (Happy Path)

1. Usuario abre `WithdrawModal`
2. `useWallet()` provee `address` y `chain`
3. Se valida `chain?.id === CHAIN_ID`
4. `writeContract({ address: MARKETPLACE_ADDRESS, abi: WITHDRAW_KEY_ABI, functionName: 'withdrawKey', args: [bytes32KeyId, atomicAmount] })`
5. Para EOA: Core Wallet pide confirmación y paga gas en AVAX
6. Para Embedded: thirdweb ejecuta gasless vía ERC-4337
7. Se obtiene `txHash` del resultado de `writeContract`
8. Polling del receipt via `publicClient.waitForTransactionReceipt`
9. POST a `/api/agent-keys/${keyId}/withdraw` para sync DB
10. UI muestra ✅

### 4.7 Flujo de error

- `isReady === false` → error: "Wallet no conectada. Conecta tu wallet para continuar."
- `chain?.id !== CHAIN_ID` → error: "Red incorrecta. Cambia a Avalanche Fuji Testnet."
- `signTypedData` rechazada → error: "Cancelaste la firma."
- `writeContract` rechazada → error: "Cancelaste la transacción."
- Timeout receipt (30s) → error: "Tiempo de espera agotado. Verifica tu tx en Snowtrace."

---

## 5. Constraint Directives (Anti-Alucinación)

### OBLIGATORIO seguir
- Patrón de hooks: `const { address, chain } = useWallet()` — **importar el hook, no acceder a `window`**
- Patrón de firma: seguir `useWalletPayment.ts` para EIP-712 con `signTypedData`
- Patrón de writeContract: seguir `useWalletPayment.ts` para ABI inline + `writeContract`
- `isReady` de `useUnifiedWalletClient` como guard antes de operar

### PROHIBIDO
- NO usar `window.ethereum` en ninguna forma
- NO usar `eth_requestAccounts` (la wallet ya está conectada vía hook)
- NO crear nuevos hooks ni archivos
- NO modificar `useWallet.ts` ni `useUnifiedWalletClient.ts`
- NO modificar APIs (`/api/agent-keys/*`)
- NO modificar `CloseKeyModal`
- NO hardcodear addresses (usar constantes ya definidas en el archivo)
- NO agregar dependencias nuevas

---

## 6. Scope

**IN:**
- `DepositModal` en `src/app/[locale]/agent-keys/page.tsx` — reemplazar `window.ethereum`
- `WithdrawModal` en `src/app/[locale]/agent-keys/page.tsx` — reemplazar `window.ethereum`

**OUT:**
- `CloseKeyModal` — no tiene transacciones on-chain
- APIs de agent-keys
- Hooks de wallet
- DB schema
- Cualquier otro archivo

---

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| `signTypedData` de thirdweb embedded retorna firma incompatible con EIP-3009 | B | A | Ya probado en `useWalletPayment.ts` — mismo patrón funciona |
| `writeContract` no espera receipt correctamente para embedded | B | M | Usar `waitForTransactionReceipt` de `publicClient` igual que en `usdcSettler.ts` |
| Chain check falla para embedded (thirdweb siempre reporta Fuji) | B | B | `useWallet.ts` ya normaliza chain a `viemAvalancheFuji` para embedded |

---

## 8. Dependencias

- `useWallet()` — existe ✅
- `useUnifiedWalletClient()` — existe ✅
- `thirdwebClient` — existe en `src/shared/lib/web3/thirdwebClient.ts` ✅
- Constantes `USDC_ADDRESS`, `MARKETPLACE_ADDRESS`, `CHAIN_ID` — ya definidas en el archivo ✅

---

## 9. Missing Inputs

N/A — Todo existe.

---

## 10. Uncertainty Markers

Ninguno. SDD listo para implementar.

---

## Readiness Check

- [x] Cada AC tiene al menos 1 archivo asociado en tabla 4.1
- [x] Cada archivo en tabla 4.1 tiene un Exemplar válido (verificado)
- [x] No hay [NEEDS CLARIFICATION] pendientes
- [x] Constraint Directives incluyen más de 3 PROHIBIDO
- [x] Context Map tiene 4 archivos leídos
- [x] Scope IN y OUT son explícitos
- [x] No hay cambios de BD
- [x] Flujo principal completo (Deposit + Withdraw)
- [x] Flujo de error definido

---

*SDD generado por NexusAgil — FULL*
