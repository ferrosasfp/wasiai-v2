# S1 — SDD: HU-PAY-1: Soporte Multi-Wallet EVM

> **Estado:** DRAFT — Pendiente SPEC_APPROVED de Fer
> **Épica:** E-PAY — Pagos & Wallet Experience
> **HU origen:** HU-PAY-1
> **Generado:** 2026-02-27
> **Autor:** San (PM/Architect — BMAD Method v6)
> **Prerrequisito:** HU_APPROVED explícito de Fer sobre hu-pay1-s0.md

---

## Contexto técnico

`PayToCallButton.tsx` ya tiene el flujo EIP-712 / EIP-3009 implementado para wallets
con `walletClient` disponible. Los gaps actuales son:

1. **No detecta ni muestra balance USDC** antes de intentar pagar.
2. **El switch de red es reactivo** (solo se activa cuando `walletClient` es null) y
   no bloquea el botón ni muestra el banner proactivo.
3. **No hay fallback** `approve + transferFrom` cuando EIP-3009 falla.
4. **UX de error es inconsistente** — mezcla `setError` con lógica de flujo.
5. **No soporta wallets multi-injector** (Rabby, Coinbase Wallet) — solo `injected()`.

Este SDD cierra todos esos gaps con cambios quirúrgicos en la capa de UI/hooks.
**Sin cambios de contrato. Sin migraciones de DB.**

---

## 1. Archivos a crear o modificar

### Crear

| Path | Tipo | Propósito |
|------|------|-----------|
| `src/features/payments/hooks/useWalletPayment.ts` | Hook | Orquesta detección de wallet, balance, switch de red, EIP-3009 y fallback |
| `src/features/payments/hooks/useUsdcBalance.ts` | Hook | Wrapper tipado de `useBalance` para USDC Fuji |
| `src/features/payments/hooks/useChainGuard.ts` | Hook | Detecta chainId incorrecto y expone `switchToFuji()` |
| `src/features/payments/components/WalletStatusBar.tsx` | Componente | Banner de estado: wallet desconectada / red incorrecta / balance |
| `src/features/payments/components/FallbackApproveFlow.tsx` | Componente | UI de fallback approve/transferFrom con aviso de gas |
| `src/features/payments/types/payment-flow.types.ts` | Types | Interfaces TypeScript del flujo de pago |
| `src/shared/lib/web3/fuji.ts` | Lib | Constantes de Fuji/USDC centralizadas (extrae hardcodes de PayToCallButton) |

### Modificar

| Path | Cambio |
|------|--------|
| `src/features/payments/components/PayToCallButton.tsx` | Refactor: usar `useWalletPayment`, añadir `WalletStatusBar`, añadir `FallbackApproveFlow` |
| `src/shared/lib/web3/config.ts` | Añadir `coinbaseWallet()` y `walletConnect()` a connectors |
| `src/shared/lib/web3/chains.ts` | Verificar que `avalancheFuji` (43113) esté como chain primaria — probablemente ya OK |

### No tocar

- Contratos (`WasiAIMarketplace.sol`) — sin cambios
- API routes (`/api/v1/models/[slug]/invoke`) — sin cambios
- DB / Supabase — sin cambios de schema
- `ModelCallSection.tsx` — sin cambios (solo pasa props a `PayToCallButton`)

---

## 2. Cambios de Schema / DB

**Ninguno.** Esta HU es 100% capa de UI y hooks de wallet.

---

## 3. Interfaces TypeScript clave

### `src/features/payments/types/payment-flow.types.ts`

```typescript
/** Estado del flujo de pago — máquina de estados lineal */
export type PaymentFlowState =
  | 'idle'
  | 'no_wallet'          // wallet no conectada
  | 'wrong_network'      // chainId ≠ 43113
  | 'switching_network'  // await switchChain en progreso
  | 'insufficient_balance' // USDC < price_per_call
  | 'signing_eip3009'    // await signTypedData en progreso
  | 'eip3009_failed'     // EIP-3009 rechazado/timeout → ofrece fallback
  | 'approving'          // await writeContract(approve) en progreso
  | 'calling'            // await fetch /invoke con X-PAYMENT o post-approve
  | 'success'
  | 'error'

export interface PaymentFlowContext {
  state: PaymentFlowState
  /** Dirección conectada (undefined si no hay wallet) */
  address?: `0x${string}`
  /** chainId actual de la wallet */
  chainId?: number
  /** Balance USDC en unidades USDC (6 decimales ya aplicados) */
  usdcBalance?: number
  /** true si el balance es suficiente para el precio del modelo */
  hasEnoughBalance: boolean
  /** true si EIP-3009 ya falló y el fallback está disponible */
  fallbackAvailable: boolean
  /** Resultado de la invocación al modelo */
  result?: string
  /** Hash de la tx on-chain (EIP-3009 o approve) */
  txHash?: string
  /** Mensaje de error legible para el usuario */
  errorMessage?: string
}

export interface EIP712AuthorizationPayload {
  from: `0x${string}`
  to: `0x${string}`
  value: string          // bigint serializado como string
  validAfter: string     // '0'
  validBefore: string    // unix timestamp
  nonce: `0x${string}`  // 32 bytes hex
}

export interface X402PaymentHeader {
  x402Version: 1
  scheme: 'exact'
  network: string
  payload: {
    signature: `0x${string}`
    authorization: EIP712AuthorizationPayload
  }
}

/** Respuesta 402 del servidor */
export interface X402Requirements {
  network: string
  asset: `0x${string}`
  payTo: `0x${string}`
  maxAmountRequired: string  // wei como string
  x402Version?: number
}
```

---

## 4. Flujo técnico paso a paso

### Visión general

```
Abrir modal
    │
    ▼
[A] ¿Wallet conectada? ──No──► WalletStatusBar: "Conecta tu wallet" + ConnectButton
    │ Sí
    ▼
[B] ¿chainId === 43113? ──No──► WalletStatusBar: banner "Red incorrecta" + botón "Cambiar a Fuji"
    │ Sí                              └─► useSwitchChain → si falla: wallet_addEthereumChain manual
    ▼
[C] Leer balance USDC Fuji (useBalance token=USDC_FUJI)
    │
    ├─ Insuficiente? ──► Botón disabled + "USDC insuficiente. Necesitas X USDC"
    │
    ▼ Suficiente → usuario hace click "Pay & Call"
[D] Probe /invoke → esperar 402
    │
    ▼
[E] Intentar EIP-3009 (eth_signTypedData_v4)
    │
    ├─ Éxito ──► POST /invoke con X-PAYMENT → [G] Resultado
    │
    └─ Fallo (rechazo, timeout, wallet no compatible)
           │
           ▼
[F] Fallback: FallbackApproveFlow
    ├─ Mostrar aviso: "Este camino requiere aprobar una transacción on-chain (fee de gas)"
    ├─ await writeContract(USDC.approve(operatorAddress, amount))
    │       └─ Confirmación en wallet
    ├─ Esperar receipt (useWaitForTransactionReceipt)
    └─ POST /invoke con header especial X-PAYMENT-FALLBACK
           │
           ▼
[G] Mostrar resultado + link a snowtrace
```

### Detalle de cada paso

#### [A] Detección de wallet — `useChainGuard`
```
useAccount() → isConnected, address, chain
Si !isConnected → state = 'no_wallet'
Si isConnected  → continuar
```

#### [B] Detección y switch de red — `useChainGuard`
```
Si chain.id !== FUJI_CHAIN_ID (43113):
  state = 'wrong_network'
  Al click "Cambiar a Fuji":
    useSwitchChain({ chainId: 43113 })
    Si error (4902 = chain desconocida):
      walletClient.request({ method: 'wallet_addEthereumChain', params: [FUJI_PARAMS] })
    state = 'switching_network' durante el proceso
    Al completar → wagmi reactiva, chain.id actualiza, banner desaparece
```
> **Crítico:** El trigger de `switchChain` DEBE venir de un click del usuario (AC2 / R1).
> No llamar en useEffect automáticamente.

#### [C] Balance USDC — `useUsdcBalance`
```
useBalance({
  address,
  token: USDC_FUJI_ADDRESS,   // 0x5425890298aed601595a70AB815c96711a31Bc65
  chainId: FUJI_CHAIN_ID,
  query: { staleTime: 30_000 } // máx 30s de cache (R5)
})
→ data.value (bigint) / data.decimals (6)
→ balance = Number(data.value) / 1e6
→ hasEnoughBalance = balance >= model.price_per_call
```

#### [D] Probe del endpoint
```
fetch POST /api/v1/models/${slug}/invoke
  body: { input }
  
Si status !== 402 → resultado directo (agente gratuito o error)
Si status === 402 → leer body: X402Requirements
```

#### [E] Intento EIP-3009
```
const nonce = generateNonce()         // crypto.getRandomValues(32 bytes)
const validBefore = now() + 300       // 5 min de ventana
const amountWei = BigInt(maxAmountRequired)

walletClient.signTypedData({
  domain: { name: 'USD Coin', version: '2', chainId: 43113, verifyingContract: USDC_FUJI },
  types: { TransferWithAuthorization: [...] },   // EIP-3009 spec
  primaryType: 'TransferWithAuthorization',
  message: { from, to: payTo, value: amountWei, validAfter: 0n, validBefore, nonce }
})

Si error.code === 4001 (user rejected):
  errorMessage = 'Cancelaste la operación. Puedes intentar de nuevo.'
  state = 'error'  (NO fallback — fue rechazo explícito del usuario)
  
Si error por incompatibilidad técnica (METHOD_NOT_FOUND, etc.):
  state = 'eip3009_failed'
  fallbackAvailable = true
```

#### [F] Fallback approve + transferFrom
```
// Mostrar FallbackApproveFlow con aviso de gas

const USDC_ABI_APPROVE = [
  { name: 'approve', type: 'function',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable' }
]

// Hook: useWriteContract
const { writeContractAsync } = useWriteContract()
const hash = await writeContractAsync({
  address: USDC_FUJI_ADDRESS,
  abi: USDC_ABI_APPROVE,
  functionName: 'approve',
  args: [OPERATOR_ADDRESS, amountWei],
  chainId: FUJI_CHAIN_ID,
})

// Esperar confirmación
const { isSuccess } = useWaitForTransactionReceipt({ hash })

// Una vez confirmado: POST /invoke con header especial
// (el backend verificará el approve on-chain antes de ejecutar transferFrom)
fetch POST /api/v1/models/${slug}/invoke
  headers: {
    'X-PAYMENT-FALLBACK': JSON.stringify({ txHash: hash, from: address, amount: amountWei.toString() })
  }
```

> **Nota backend:** El endpoint `/invoke` necesita manejar `X-PAYMENT-FALLBACK`.
> Eso es scope de una HU de backend separada (no entra en PAY-1 que es solo frontend).
> **Para el MVP de PAY-1:** el fallback muestra la UI y ejecuta el approve, pero la
> invocación al modelo con transferFrom queda pendiente hasta que el backend lo soporte.
> Se documenta en DoD como ítem explícito.

#### [G] Resultado
```
const data = await paid.json()
result = data.result
txHash = data.meta?.tx_hash
state = 'success'
```

---

## 5. Hooks wagmi v3 a usar

| Hook | Import | Uso en HU-PAY-1 |
|------|--------|----------------|
| `useAccount` | `wagmi` | Leer `isConnected`, `address`, `chain` |
| `useWalletClient` | `wagmi` | `signTypedData` para EIP-3009 |
| `useSwitchChain` | `wagmi` | Switch a Fuji (43113) al click del botón |
| `useBalance` | `wagmi` | Leer balance USDC Fuji (token param) |
| `useWriteContract` | `wagmi` | Ejecutar `USDC.approve()` en el fallback |
| `useWaitForTransactionReceipt` | `wagmi` | Esperar confirmación del approve |
| `useConnect` | `wagmi` | Conectar wallet desde el modal |
| `useConnectors` | `wagmi` | Listar wallets disponibles (injected, coinbase) |

### Connectors a añadir en `wagmiConfig`

```typescript
// src/shared/lib/web3/config.ts
import { injected, coinbaseWallet } from 'wagmi/connectors'

connectors: [
  injected({ target: 'metaMask' }),   // MetaMask explícito
  injected(),                          // Rabby, Core y otros injected genéricos
  coinbaseWallet({ appName: 'WasiAI' }),
],
```

> `walletConnect` queda fuera del scope PAY-1 (requiere projectId WalletConnect — HU futura).

---

## 6. Constantes centralizadas — `src/shared/lib/web3/fuji.ts`

```typescript
// Extrae hardcodes dispersos en PayToCallButton.tsx
export const FUJI_CHAIN_ID = 43113 as const

export const USDC_FUJI_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`

export const WASIAI_OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_WASIAI_OPERATOR as `0x${string}`

export const USDC_EIP712_CONFIG = {
  name: 'USD Coin',
  version: '2',
} as const

export const FUJI_CHAIN_PARAMS = {
  chainId:         '0xA869',   // 43113 en hex
  chainName:       'Avalanche Fuji Testnet',
  nativeCurrency:  { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
  rpcUrls:         ['https://api.avax-test.network/ext/bc/C/rpc'],
  blockExplorerUrls: ['https://testnet.snowtrace.io/'],
} as const
```

> Regla Golden Path: las direcciones deben venir de env vars. `USDC_FUJI_ADDRESS`
> puede ser hardcodeada porque es una constante pública del protocolo USDC en Fuji
> (inmutable). `WASIAI_OPERATOR_ADDRESS` debe ser `NEXT_PUBLIC_WASIAI_OPERATOR`.

---

## 7. Componentes — diseño detallado

### `WalletStatusBar.tsx`

```
Props: { flowState: PaymentFlowState, usdcBalance: number, priceUsdc: number, onSwitchChain: () => void, onConnect: () => void }

Render condicional:
  - 'no_wallet'    → "Conecta tu wallet para continuar" + [ConnectButton]
  - 'wrong_network' → banner amber: "Tu wallet está en [chain.name]. WasiAI requiere Avalanche Fuji Testnet." + [Cambiar a Fuji]
  - 'switching_network' → spinner + "Cambiando a Fuji..."
  - 'insufficient_balance' → "USDC insuficiente. Tienes X.XX USDC, necesitas Y.YY"
  - otherwise      → balance pill: "USDC: X.XX" (verde si suficiente, gris si no)
```

### `FallbackApproveFlow.tsx`

```
Props: { amountUsdc: number, onConfirm: () => void, onCancel: () => void, state: 'idle'|'approving'|'done' }

Render:
  [!] Este camino requiere aprobar una transacción on-chain.
      Necesitarás una pequeña cantidad de AVAX para el gas.
  
  [Cancelar]   [Aprobar X.XX USDC →]
  
  Si state='approving': spinner + "Esperando confirmación en tu wallet..."
  Si state='done': "✓ Aprobación confirmada"
```

---

## 8. Refactor de `PayToCallButton.tsx`

El componente actual (~200 líneas) se refactoriza para:

1. Importar `useWalletPayment` (nuevo hook orquestador) — toda la lógica sale del componente.
2. Renderizar `WalletStatusBar` arriba del textarea.
3. Renderizar `FallbackApproveFlow` como modal/inline cuando `fallbackAvailable = true`.
4. El botón principal queda disabled con tooltip en estados: `wrong_network`, `switching_network`, `insufficient_balance`, `no_wallet`.
5. **Invariante:** el botón nunca hace nada al click si el estado no es `idle` o `eip3009_failed`.

Superficie de cambio estimada: ~80 líneas modificadas, ~120 líneas extraídas a hooks/componentes.

---

## 9. Definition of Done (checklist)

### AC-1: Detección de wallet
- [ ] Al abrir el componente sin wallet → se muestra `WalletStatusBar` con mensaje y botón de conexión
- [ ] Al conectar wallet → UI se actualiza sin recargar página
- [ ] Estado en tiempo real via `useAccount`

### AC-2: Switch de red
- [ ] Con wallet en red incorrecta → banner amber visible antes de intentar pagar
- [ ] Click "Cambiar a Fuji" → `useSwitchChain({ chainId: 43113 })` ejecuta
- [ ] Si Fuji no está en wallet → `wallet_addEthereumChain` con `FUJI_CHAIN_PARAMS`
- [ ] Botón "Pay" disabled con tooltip mientras chainId ≠ 43113
- [ ] Después de cambiar → banner desaparece, botón habilitado

### AC-3: EIP-3009 (MetaMask, Rabby)
- [ ] `signTypedData` EIP-712 funciona en MetaMask (probado manualmente)
- [ ] `signTypedData` EIP-712 funciona en Rabby (probado manualmente)
- [ ] Firma enviada al operador via X-PAYMENT header (base64 JSON)
- [ ] Invocación al modelo exitosa end-to-end

### AC-4: Fallback approve/transferFrom
- [ ] Si EIP-3009 falla por incompatibilidad técnica → `FallbackApproveFlow` aparece
- [ ] Si usuario rechaza EIP-3009 explícitamente (code 4001) → NO se ofrece fallback (es rechazo del usuario)
- [ ] Aviso de gas visible antes de confirmar approve
- [ ] `USDC.approve(operatorAddress, amount)` se ejecuta correctamente en Fuji
- [ ] Receipt esperado con `useWaitForTransactionReceipt`
- [ ] ⚠️ La invocación post-approve queda pendiente de soporte backend (documentado, no blockeante para merge de UI)

### AC-5: UX de error
- [ ] Rechazo de firma → "Cancelaste la operación. Puedes intentar de nuevo."
- [ ] Error de red / timeout → mensaje descriptivo + opción de reintentar
- [ ] Botón en carga → spinner + disabled
- [ ] Nunca hay un botón Pay que hace nada al click

### AC-6: Balance USDC
- [ ] Balance visible en `WalletStatusBar` al conectar wallet en Fuji
- [ ] Balance insuficiente → botón Pay disabled + mensaje claro con monto exacto
- [ ] Balance se refresca al cambiar de red (staleTime ≤ 30s)

### AC-7: No regresión Core Wallet
- [ ] Flujo EIP-3009 con Core Wallet funciona igual que antes del refactor
- [ ] Test suite existente: 182/182 en verde
- [ ] Testeo manual end-to-end en Fuji con Core Wallet

### Calidad
- [ ] `useWalletPayment.ts` con tests unitarios: mock de `useAccount`, `useBalance`, `useSwitchChain`
- [ ] `useUsdcBalance.ts` con test: balance suficiente / insuficiente / loading
- [ ] `useChainGuard.ts` con test: chain correcta / incorrecta / switching
- [ ] Zero `any` explícito en TypeScript
- [ ] Adversarial review: intentar pagar con red incorrecta, sin balance, rechazando firma, cambiando de red mid-flow

---

## 10. Implementation Readiness Check

### ¿Está todo listo para que Dev empiece?

| Item | Estado | Nota |
|------|--------|------|
| S0 aprobado por Fer | ⚠️ PENDING | Blocker — este SDD no activa el gate sin HU_APPROVED |
| wagmi v3 instalado | ✅ | `wagmiConfig` en `src/shared/lib/web3/config.ts` existe y funciona |
| viem v2 instalado | ✅ | En uso en `PayToCallButton.tsx` |
| Contrato Fuji activo | ✅ | `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` verificado |
| USDC Fuji dirección confirmada | ✅ | `0x5425890298aed601595a70AB815c96711a31Bc65` ya usada en prod |
| Operator address en env | ✅ | `NEXT_PUBLIC_WASIAI_OPERATOR` — verificar que esté en Vercel |
| USDC EIP-712 domain verificado | ✅ | Ya probado en PayToCallButton actual |
| `useSwitchChain` disponible en wagmi v3 | ✅ | API estable wagmi v3 |
| `useBalance` con `token` param disponible | ✅ | API estable wagmi v3 |
| `useWriteContract` disponible | ✅ | API estable wagmi v3 |
| `useWaitForTransactionReceipt` disponible | ✅ | API estable wagmi v3 |
| Tests existentes en verde | ✅ | 182/182 (pre-merge check obligatorio) |
| coinbaseWallet connector package | ⚠️ CHECK | `wagmi/connectors` debería incluirlo — verificar antes de añadir |
| Soporte backend para fallback X-PAYMENT-FALLBACK | ❌ OUT OF SCOPE | Documentado — UI del fallback se entrega, pero la invocación post-approve espera HU-PAY-2 |

### Veredito: **CASI LISTO**

Blocker real: falta HU_APPROVED de Fer y SPEC_APPROVED de este SDD.
Técnicamente, Dev puede empezar el spike de `useChainGuard` y `useUsdcBalance` en rama aislada.

### Antes del primer commit

```bash
# Verificar que coinbaseWallet está disponible
grep -r "coinbaseWallet" node_modules/wagmi/connectors/index* 2>/dev/null | head -3

# Verificar que NEXT_PUBLIC_WASIAI_OPERATOR está definido
grep "WASIAI_OPERATOR" .env.local

# Correr test suite
pnpm test -- --run
```

---

## 11. Árbol de archivos resultante

```
src/
├── features/
│   └── payments/
│       ├── components/
│       │   ├── PayToCallButton.tsx          ← MODIFICAR (refactor)
│       │   ├── WalletStatusBar.tsx          ← CREAR
│       │   ├── FallbackApproveFlow.tsx      ← CREAR
│       │   └── index.ts                     ← añadir exports nuevos
│       ├── hooks/
│       │   ├── useWalletPayment.ts          ← CREAR (orquestador)
│       │   ├── useUsdcBalance.ts            ← CREAR
│       │   └── useChainGuard.ts             ← CREAR
│       └── types/
│           └── payment-flow.types.ts        ← CREAR
└── shared/
    └── lib/
        └── web3/
            ├── config.ts                    ← MODIFICAR (añadir connectors)
            └── fuji.ts                      ← CREAR (constantes centralizadas)
```

---

## 12. Riesgos y mitigaciones (mapa S0 → impl)

| Riesgo S0 | Mitigación técnica en este SDD |
|-----------|-------------------------------|
| R1: switch bloqueado por popup blocker | `switchToFuji()` solo se llama desde onClick — jamás desde useEffect |
| R2: MetaMask sin signTypedData_v4 antiguo | try/catch en signTypedData → si `METHOD_NOT_FOUND` → fallback path |
| R3: EIP-712 domain mismatch | `verifyingContract = probeBody.asset` (viene del server 402, no hardcodeado) |
| R4: race condition chainId cambia mid-tx | Modal se lockea (`state !== 'idle'`) durante operación; `useAccount` reactivo |
| R5: balance USDC stale | `useBalance` con `staleTime: 30_000` — máx 30s de cache |
| R6: confusión gas en fallback | `FallbackApproveFlow` muestra aviso explícito ANTES del botón de confirmar |
| R7: wagmi v3 rompe hooks existentes | Spike en rama aislada; auditar imports de `useWalletClient` y `useAccount` antes |

---

*Próximo paso: SPEC_APPROVED de Fer → SM crea `story-HU-PAY-1.md` → Dev Story*
