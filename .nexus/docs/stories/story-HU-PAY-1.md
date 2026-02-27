# Story HU-PAY-1 — Soporte Multi-Wallet EVM para el Flujo de Pago x402

> **Estado:** READY FOR DEV
> **Épica:** E-PAY — Pagos & Wallet Experience
> **Prioridad:** P0
> **Gates superados:** HU_APPROVED ✅ | SPEC_APPROVED ✅
> **Generado:** 2026-02-27
> **Autor:** San (SM — BMAD Method v6)
> **Este archivo es 100% autocontenido. El Dev no necesita leer ningún otro documento.**

---

## Contexto del problema

El flujo de pago actual de WasiAI asume Core Wallet en Fuji. Cualquier usuario con MetaMask, Rabby o Coinbase Wallet ve el botón "Pay" muerto sin ningún mensaje de error legible. Esta HU resuelve la compatibilidad EVM completa.

**Scope aprobado por Fer (SPEC_APPROVED):**
- Botón de desconectar wallet en la UI
- Mostrar wallet conectada + red activa en todo momento
- Detección de red incorrecta + switch automático a Fuji (chainId 43113)
- EIP-712 estándar `eth_signTypedData_v4` para todas las wallets EVM
- Fallback `approve/transferFrom` INCLUIDO en esta HU (no diferido a PAY-2)
- Mensajes de error claros y accionables en todos los estados de fallo

---

## Constantes del sistema (usar exactamente estas — no inventar)

```typescript
// src/shared/lib/web3/fuji.ts  ← CREAR este archivo
export const FUJI_CHAIN_ID = 43113 as const

export const USDC_FUJI_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`

export const WASIAI_OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_WASIAI_OPERATOR as `0x${string}`
// Valor real: '0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB'

export const WASIAI_MARKETPLACE_ADDRESS = '0x71CddCdF8a40951a1d8C22C8774448FbcA089b53' as `0x${string}`

export const USDC_EIP712_CONFIG = {
  name: 'USD Coin',
  version: '2',
} as const

export const FUJI_CHAIN_PARAMS = {
  chainId:             '0xA869',   // 43113 en hex
  chainName:           'Avalanche Fuji Testnet',
  nativeCurrency:      { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
  rpcUrls:             ['https://api.avax-test.network/ext/bc/C/rpc'],
  blockExplorerUrls:   ['https://testnet.snowtrace.io/'],
} as const
```

**Regla:** `WASIAI_OPERATOR_ADDRESS` viene de env var. `USDC_FUJI_ADDRESS` puede ser constante (inmutable de protocolo USDC). Verificar que `NEXT_PUBLIC_WASIAI_OPERATOR` existe en `.env.local` y en Vercel antes del primer commit.

---

## Árbol de archivos — qué crear y qué modificar

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
│       │   ├── useWalletPayment.ts          ← CREAR (orquestador principal)
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

**No tocar:**
- `WasiAIMarketplace.sol` — sin cambios de contrato
- `/api/v1/models/[slug]/invoke` — sin cambios de API
- Supabase / migraciones — sin cambios de schema
- `ModelCallSection.tsx` — solo pasa props a `PayToCallButton`

---

## Interfaces TypeScript — copiar exactas

**`src/features/payments/types/payment-flow.types.ts`**

```typescript
/** Máquina de estados del flujo de pago — lineal, sin estados paralelos */
export type PaymentFlowState =
  | 'idle'                 // todo OK, esperando click del usuario
  | 'no_wallet'            // no hay wallet conectada
  | 'wrong_network'        // chainId ≠ 43113
  | 'switching_network'    // switchChain en progreso (spinner)
  | 'insufficient_balance' // USDC < price_per_call
  | 'signing_eip3009'      // signTypedData en progreso
  | 'eip3009_failed'       // EIP-3009 falló por incompatibilidad técnica → mostrar fallback
  | 'approving'            // writeContract(approve) en progreso
  | 'calling'              // fetch /invoke en vuelo
  | 'success'
  | 'error'

export interface PaymentFlowContext {
  state: PaymentFlowState
  /** Dirección hex de la wallet conectada (undefined si no hay) */
  address?: `0x${string}`
  /** chainId actual de la wallet */
  chainId?: number
  /** Nombre legible de la red actual */
  chainName?: string
  /** Balance USDC en unidades USDC (decimales ya aplicados, ej: 12.5) */
  usdcBalance?: number
  /** true si el balance alcanza para pagar el modelo */
  hasEnoughBalance: boolean
  /** true solo si EIP-3009 falló por motivo técnico (no por rechazo del usuario) */
  fallbackAvailable: boolean
  /** Resultado de la invocación al modelo (texto del agente) */
  result?: string
  /** Hash de la tx on-chain (EIP-3009 o approve) */
  txHash?: `0x${string}`
  /** Mensaje de error legible para mostrar al usuario */
  errorMessage?: string
}

export interface EIP712AuthorizationPayload {
  from:        `0x${string}`
  to:          `0x${string}`
  value:       string          // bigint serializado como string decimal
  validAfter:  string          // siempre '0'
  validBefore: string          // unix timestamp (now + 300s)
  nonce:       `0x${string}`  // 32 bytes hex aleatorios
}

export interface X402PaymentHeader {
  x402Version: 1
  scheme:      'exact'
  network:     string
  payload: {
    signature:     `0x${string}`
    authorization: EIP712AuthorizationPayload
  }
}

/** Body del 402 que devuelve el servidor */
export interface X402Requirements {
  network:           string
  asset:             `0x${string}`  // dirección USDC Fuji
  payTo:             `0x${string}`  // dirección del operador
  maxAmountRequired: string          // wei como string decimal
  x402Version?:      number
}
```

---

## Hooks — implementación detallada

### `useChainGuard.ts`

```typescript
// src/features/payments/hooks/useChainGuard.ts
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { FUJI_CHAIN_ID, FUJI_CHAIN_PARAMS } from '@/shared/lib/web3/fuji'

export function useChainGuard() {
  const { isConnected, chain } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  const isCorrectChain = isConnected && chain?.id === FUJI_CHAIN_ID

  /** CRÍTICO: esta función SOLO debe llamarse desde un onClick del usuario.
   *  NUNCA llamarla desde un useEffect — los browsers bloquean el popup de wallet. */
  async function switchToFuji(): Promise<void> {
    try {
      await switchChainAsync({ chainId: FUJI_CHAIN_ID })
    } catch (err: unknown) {
      // Error 4902 = chain desconocida para la wallet → añadirla primero
      const code = (err as { code?: number })?.code
      if (code === 4902 && walletClient) {
        await walletClient.request({
          method: 'wallet_addEthereumChain',
          params: [FUJI_CHAIN_PARAMS],
        })
        // Reintentar switch después de añadir
        await switchChainAsync({ chainId: FUJI_CHAIN_ID })
      } else {
        throw err
      }
    }
  }

  return {
    isConnected,
    isCorrectChain,
    currentChainName: chain?.name ?? 'red desconocida',
    switchToFuji,
  }
}
```

### `useUsdcBalance.ts`

```typescript
// src/features/payments/hooks/useUsdcBalance.ts
import { useBalance, useAccount } from 'wagmi'
import { USDC_FUJI_ADDRESS, FUJI_CHAIN_ID } from '@/shared/lib/web3/fuji'

export function useUsdcBalance(priceUsdc: number) {
  const { address } = useAccount()

  const { data, isLoading } = useBalance({
    address,
    token: USDC_FUJI_ADDRESS,
    chainId: FUJI_CHAIN_ID,
    query: {
      enabled: !!address,
      staleTime: 30_000,  // máx 30s de cache — no confiar en dato viejo
    },
  })

  const usdcBalance = data ? Number(data.value) / 1e6 : undefined
  const hasEnoughBalance = usdcBalance !== undefined && usdcBalance >= priceUsdc

  return { usdcBalance, hasEnoughBalance, isLoading }
}
```

### `useWalletPayment.ts`

```typescript
// src/features/payments/hooks/useWalletPayment.ts
import { useState, useCallback } from 'react'
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import { useChainGuard } from './useChainGuard'
import { useUsdcBalance } from './useUsdcBalance'
import {
  FUJI_CHAIN_ID,
  USDC_FUJI_ADDRESS,
  WASIAI_OPERATOR_ADDRESS,
  USDC_EIP712_CONFIG,
} from '@/shared/lib/web3/fuji'
import type {
  PaymentFlowState,
  PaymentFlowContext,
  X402Requirements,
  X402PaymentHeader,
} from '../types/payment-flow.types'

const USDC_ABI_APPROVE = [
  {
    name: 'approve',
    type: 'function' as const,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value',   type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

interface UseWalletPaymentOptions {
  slug:        string
  input:       string
  priceUsdc:   number
}

export function useWalletPayment({ slug, input, priceUsdc }: UseWalletPaymentOptions) {
  const [flowState, setFlowState] = useState<PaymentFlowState>('idle')
  const [result,    setResult]    = useState<string>()
  const [txHash,    setTxHash]    = useState<`0x${string}`>()
  const [errorMsg,  setErrorMsg]  = useState<string>()
  const [approveTx, setApproveTx] = useState<`0x${string}`>()

  const { address }          = useAccount()
  const { data: walletClient } = useWalletClient()
  const { isConnected, isCorrectChain, currentChainName, switchToFuji } = useChainGuard()
  const { usdcBalance, hasEnoughBalance, isLoading: balanceLoading } = useUsdcBalance(priceUsdc)
  const { writeContractAsync }  = useWriteContract()
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTx })

  /** Deriva el estado del flujo a partir del contexto wagmi */
  function deriveState(): PaymentFlowState {
    if (!isConnected)       return 'no_wallet'
    if (!isCorrectChain)    return 'wrong_network'
    if (!hasEnoughBalance)  return 'insufficient_balance'
    return flowState  // 'idle' u otro estado en vuelo
  }

  const pay = useCallback(async () => {
    if (!walletClient || !address) return
    setErrorMsg(undefined)

    // ── STEP D: Probe del endpoint ──────────────────────────────────────────
    setFlowState('calling')
    const probeRes = await fetch(`/api/v1/models/${slug}/invoke`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ input }),
    })

    if (probeRes.status !== 402) {
      // Agente gratuito o error de servidor
      const data = await probeRes.json()
      if (probeRes.ok) {
        setResult(data.result)
        setFlowState('success')
      } else {
        setErrorMsg(data.error ?? 'Error inesperado del servidor.')
        setFlowState('error')
      }
      return
    }

    const requirements: X402Requirements = await probeRes.json()
    const amountWei = BigInt(requirements.maxAmountRequired)

    // ── STEP E: Intento EIP-3009 / EIP-712 ─────────────────────────────────
    setFlowState('signing_eip3009')
    try {
      const nonce       = crypto.getRandomValues(new Uint8Array(32))
      const nonceHex    = ('0x' + Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
      const validBefore = Math.floor(Date.now() / 1000) + 300  // 5 min

      const signature = await walletClient.signTypedData({
        domain: {
          name:              USDC_EIP712_CONFIG.name,
          version:           USDC_EIP712_CONFIG.version,
          chainId:           FUJI_CHAIN_ID,
          verifyingContract: requirements.asset,  // viene del server — no hardcodeado
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32'  },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from:        address,
          to:          requirements.payTo,
          value:       amountWei,
          validAfter:  0n,
          validBefore: BigInt(validBefore),
          nonce:       nonceHex,
        },
      })

      const paymentHeader: X402PaymentHeader = {
        x402Version: 1,
        scheme:      'exact',
        network:     requirements.network,
        payload: {
          signature,
          authorization: {
            from:        address,
            to:          requirements.payTo,
            value:       amountWei.toString(),
            validAfter:  '0',
            validBefore: validBefore.toString(),
            nonce:       nonceHex,
          },
        },
      }

      setFlowState('calling')
      const paidRes = await fetch(`/api/v1/models/${slug}/invoke`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT':    btoa(JSON.stringify(paymentHeader)),
        },
        body: JSON.stringify({ input }),
      })

      const paidData = await paidRes.json()
      if (paidRes.ok) {
        setResult(paidData.result)
        setTxHash(paidData.meta?.tx_hash)
        setFlowState('success')
      } else {
        setErrorMsg(paidData.error ?? 'Error procesando el pago.')
        setFlowState('error')
      }

    } catch (err: unknown) {
      const code    = (err as { code?: number })?.code
      const message = (err as { message?: string })?.message ?? ''

      if (code === 4001) {
        // Rechazo explícito del usuario → NO ofrecer fallback
        setErrorMsg('Cancelaste la operación. Puedes intentar de nuevo.')
        setFlowState('error')
        return
      }

      // Incompatibilidad técnica (METHOD_NOT_FOUND, etc.) → ofrecer fallback
      const isTechnicalFailure =
        message.includes('METHOD_NOT_FOUND') ||
        message.includes('not supported') ||
        code === -32601

      if (isTechnicalFailure) {
        setFlowState('eip3009_failed')  // FallbackApproveFlow aparece
      } else {
        setErrorMsg('Error al firmar la autorización. Intenta de nuevo.')
        setFlowState('error')
      }
    }
  }, [walletClient, address, slug, input, amountWei])

  /** Ejecutar fallback approve → lo llama FallbackApproveFlow al confirmar */
  const executeApprove = useCallback(async (amountWei: bigint) => {
    if (!address) return
    setFlowState('approving')
    try {
      const hash = await writeContractAsync({
        address:      USDC_FUJI_ADDRESS,
        abi:          USDC_ABI_APPROVE,
        functionName: 'approve',
        args:         [WASIAI_OPERATOR_ADDRESS, amountWei],
        chainId:      FUJI_CHAIN_ID,
      })
      setApproveTx(hash)
      setTxHash(hash)
      // useWaitForTransactionReceipt reacciona; el componente espera approveConfirmed
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code
      if (code === 4001) {
        setErrorMsg('Cancelaste la aprobación. Puedes intentar de nuevo.')
      } else {
        setErrorMsg('Error al ejecutar la aprobación on-chain.')
      }
      setFlowState('eip3009_failed')  // vuelve a mostrar el fallback
    }
  }, [address, writeContractAsync])

  const ctx: PaymentFlowContext = {
    state:             deriveState(),
    address,
    chainId:           undefined,   // useAccount expone chain.id — adaptar si se necesita
    chainName:         currentChainName,
    usdcBalance,
    hasEnoughBalance,
    fallbackAvailable: flowState === 'eip3009_failed',
    result,
    txHash,
    errorMessage:      errorMsg,
  }

  return {
    ctx,
    balanceLoading,
    approveConfirmed,
    switchToFuji,
    pay,
    executeApprove,
    reset: () => { setFlowState('idle'); setErrorMsg(undefined) },
  }
}
```

> **Nota:** `pay` recibe `amountWei` del probe 402 en runtime. El hook necesita
> guardar el `requirements` del probe para pasarlos a `executeApprove`. Ajustar
> el estado interno para persistir `requirements` entre el probe y el fallback.

---

## Componentes — especificación de render

### `WalletStatusBar.tsx`

**Props:**
```typescript
interface WalletStatusBarProps {
  flowState:       PaymentFlowState
  address?:        `0x${string}`
  chainName?:      string
  usdcBalance?:    number
  priceUsdc:       number
  onSwitchChain:   () => void   // DEBE ser handler de onClick, no llamar sola
  onConnect:       () => void
  onDisconnect:    () => void
}
```

**Render condicional (en orden de prioridad):**

| Estado | Render |
|--------|--------|
| `no_wallet` | Texto "Conecta tu wallet para continuar" + `[Conectar wallet]` |
| `wrong_network` | Banner **amber**: "Tu wallet está en **{chainName}**. WasiAI requiere Avalanche Fuji Testnet." + `[Cambiar a Fuji]` |
| `switching_network` | Spinner + "Cambiando a Fuji..." |
| `insufficient_balance` | Texto rojo: "USDC insuficiente. Tienes **{usdcBalance}** USDC, necesitas **{priceUsdc}**." |
| cualquier otro | Pill verde/gris: "USDC: {usdcBalance}" + dirección truncada (0x1234...abcd) + `[Desconectar]` |

**Botón de desconectar:** Siempre visible cuando hay wallet conectada (cualquier estado).  
Usar `useDisconnect()` de wagmi. El botón es pequeño, secundario, tipo `variant="ghost"`.

### `FallbackApproveFlow.tsx`

**Props:**
```typescript
interface FallbackApproveFlowProps {
  amountUsdc:   number
  approveState: 'idle' | 'approving' | 'done'
  txHash?:      `0x${string}`
  onConfirm:    () => void
  onCancel:     () => void
}
```

**Render:**
```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Firma EIP-3009 no disponible en tu wallet              │
│                                                             │
│  Este camino alternativo requiere aprobar una transacción   │
│  on-chain. Necesitarás una pequeña cantidad de AVAX         │
│  para el gas.                                               │
│                                                             │
│  [Cancelar]              [Aprobar {amountUsdc} USDC →]      │
│                                                             │
│  approveState='approving' → spinner + "Esperando           │
│    confirmación en tu wallet..."                            │
│  approveState='done'      → "✓ Aprobación confirmada.      │
│    Ejecutando invocación al agente..."                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Refactor de `PayToCallButton.tsx`

**Antes:** ~200 líneas con lógica mezclada de wallet + pago + render.  
**Después:** componente delgado que usa `useWalletPayment`:

```typescript
// Estructura del componente refactorizado
export function PayToCallButton({ slug, priceUsdc, model }) {
  const [input, setInput] = useState('')
  const {
    ctx, balanceLoading, approveConfirmed,
    switchToFuji, pay, executeApprove, reset
  } = useWalletPayment({ slug, input, priceUsdc })

  const { disconnect } = useDisconnect()
  const { open }       = useConnectModal()  // o el conector que ya usa el proyecto

  // Determinar si el botón principal está habilitado
  const canPay = ctx.state === 'idle' && input.trim().length > 0

  return (
    <div>
      <WalletStatusBar
        flowState={ctx.state}
        address={ctx.address}
        chainName={ctx.chainName}
        usdcBalance={ctx.usdcBalance}
        priceUsdc={priceUsdc}
        onSwitchChain={switchToFuji}  // viene de onClick — correcto
        onConnect={open}
        onDisconnect={disconnect}
      />

      <textarea value={input} onChange={e => setInput(e.target.value)} ... />

      {/* Botón principal */}
      <button
        disabled={!canPay}
        onClick={pay}
        title={getPayButtonTooltip(ctx.state)}
      >
        {ctx.state === 'signing_eip3009' || ctx.state === 'calling'
          ? <Spinner /> : 'Pay & Call'}
      </button>

      {/* Fallback */}
      {ctx.fallbackAvailable && (
        <FallbackApproveFlow
          amountUsdc={priceUsdc}
          approveState={ctx.state === 'approving' ? 'approving' : approveConfirmed ? 'done' : 'idle'}
          txHash={ctx.txHash}
          onConfirm={() => executeApprove(BigInt(Math.round(priceUsdc * 1e6)))}
          onCancel={reset}
        />
      )}

      {/* Resultado */}
      {ctx.state === 'success' && <ResultDisplay result={ctx.result} txHash={ctx.txHash} />}

      {/* Error */}
      {ctx.errorMessage && (
        <ErrorBanner message={ctx.errorMessage} onRetry={reset} />
      )}
    </div>
  )
}

function getPayButtonTooltip(state: PaymentFlowState): string {
  switch (state) {
    case 'no_wallet':            return 'Conecta tu wallet para continuar'
    case 'wrong_network':        return 'Cambia a Fuji Testnet para pagar'
    case 'switching_network':    return 'Cambiando de red...'
    case 'insufficient_balance': return 'Balance de USDC insuficiente'
    case 'signing_eip3009':      return 'Firma la autorización en tu wallet'
    case 'calling':              return 'Procesando pago...'
    case 'approving':            return 'Esperando confirmación on-chain...'
    default:                     return ''
  }
}
```

**Invariante crítica:** el botón "Pay" NUNCA tiene `onClick` activo si `state !== 'idle'`.

---

## Modificación de `wagmiConfig`

**Archivo:** `src/shared/lib/web3/config.ts`

```typescript
// Añadir coinbaseWallet a los connectors existentes
import { injected, coinbaseWallet } from 'wagmi/connectors'

// Dentro de createConfig:
connectors: [
  injected({ target: 'metaMask' }),    // MetaMask explícito por nombre
  injected(),                           // Rabby, Core y otros injected genéricos
  coinbaseWallet({ appName: 'WasiAI' }),
],
// walletConnect queda fuera del scope PAY-1 (requiere WalletConnect projectId — HU futura)
```

**Antes de modificar:** verificar que `coinbaseWallet` está disponible:
```bash
grep -r "coinbaseWallet" node_modules/wagmi/connectors/index* 2>/dev/null | head -3
```

---

## Criterios de Aceptación (ACs)

### AC-1: Wallet conectada visible en todo momento
- [ ] Cuando hay wallet conectada, `WalletStatusBar` muestra dirección truncada y balance USDC
- [ ] La información se actualiza en tiempo real sin recargar (reactiva via wagmi `useAccount`)
- [ ] Cuando no hay wallet, muestra "Conecta tu wallet para continuar" con botón de conexión

### AC-2: Botón de desconectar wallet
- [ ] Con wallet conectada, siempre hay un botón "Desconectar" visible (secondary, pequeño)
- [ ] Al hacer click, llama `useDisconnect()` de wagmi y el estado de UI se limpia
- [ ] Después de desconectar, el estado vuelve a `no_wallet`

### AC-3: Detección de red incorrecta + switch automático
- [ ] Si la wallet está en red distinta a Fuji (chainId ≠ 43113), aparece banner amber con nombre de red actual
- [ ] Banner incluye botón "Cambiar a Fuji" — el click llama `switchToFuji()` (handler de onClick, NUNCA useEffect)
- [ ] Si Fuji no está configurada en la wallet → `wallet_addEthereumChain` con parámetros de Fuji → luego switch
- [ ] Botón "Pay" permanece disabled con tooltip mientras red sea incorrecta
- [ ] Al completar el switch, el banner desaparece y el botón "Pay" se habilita (sin recargar)

### AC-4: EIP-712 estándar para todas las wallets EVM
- [ ] Usa `eth_signTypedData_v4` via `walletClient.signTypedData` (wagmi) — NO helpers propietarios de Core
- [ ] `verifyingContract` del domain EIP-712 viene del 402 del servidor (`requirements.asset`), no hardcodeado
- [ ] Funciona en MetaMask (verificado manualmente en Fuji)
- [ ] Funciona en Rabby (verificado manualmente en Fuji)
- [ ] Funciona en Core Wallet sin regresión (verificado manualmente)

### AC-5: Fallback approve/transferFrom en esta HU
- [ ] Si EIP-3009 falla por incompatibilidad técnica (METHOD_NOT_FOUND, code -32601) → `FallbackApproveFlow` aparece
- [ ] Si usuario rechaza con code 4001 → NO se ofrece fallback (error claro, botón de reintentar)
- [ ] `FallbackApproveFlow` muestra aviso de gas ANTES de confirmar
- [ ] `USDC.approve(WASIAI_OPERATOR_ADDRESS, amount)` se ejecuta correctamente en Fuji
- [ ] Se espera receipt con `useWaitForTransactionReceipt`
- [ ] ⚠️ La invocación al agente post-approve queda pendiente de soporte backend (documentado, no blockeante para merge de UI — ver DoD)

### AC-6: Mensajes de error claros y accionables
- [ ] Rechazo firma (code 4001) → "Cancelaste la operación. Puedes intentar de nuevo." + botón reintentar
- [ ] Error de red / timeout → mensaje descriptivo (no código de error) + botón reintentar
- [ ] Balance insuficiente → "USDC insuficiente. Tienes X.XX USDC, necesitas Y.YY USDC."
- [ ] Botón "Pay" muestra spinner + disabled mientras operación en vuelo
- [ ] NUNCA hay un botón "Pay" que no hace nada al click

### AC-7: Balance USDC visible
- [ ] Modal muestra balance USDC Fuji de la wallet conectada antes de pagar
- [ ] Balance insuficiente → botón Pay disabled + mensaje con montos exactos
- [ ] Balance se refresca al cambiar de red o reconectar wallet (staleTime ≤ 30s)

### AC-8: Sin regresión en Core Wallet
- [ ] El flujo EIP-3009 con Core Wallet funciona igual que antes del refactor
- [ ] Test suite existente: 182/182 en verde tras el refactor

---

## Tests requeridos

### `useChainGuard.test.ts`
- `isCorrectChain = true` cuando chain.id === 43113
- `isCorrectChain = false` cuando chain.id !== 43113
- `switchToFuji()` llama `switchChainAsync({ chainId: 43113 })`
- `switchToFuji()` llama `wallet_addEthereumChain` cuando error code 4902
- `switchToFuji()` NO se ejecuta en useEffect (solo debe ser llamable manualmente)

### `useUsdcBalance.test.ts`
- Retorna `hasEnoughBalance = true` cuando `usdcBalance >= priceUsdc`
- Retorna `hasEnoughBalance = false` cuando `usdcBalance < priceUsdc`
- `isLoading = true` mientras `useBalance` está cargando
- Usa `staleTime: 30_000` en la query

### `useWalletPayment.test.ts`
- `deriveState()` retorna `'no_wallet'` cuando `!isConnected`
- `deriveState()` retorna `'wrong_network'` cuando `chainId !== 43113`
- `deriveState()` retorna `'insufficient_balance'` cuando `!hasEnoughBalance`
- Rechazo con code 4001 → `state = 'error'`, `fallbackAvailable = false`
- Error `METHOD_NOT_FOUND` → `state = 'eip3009_failed'`, `fallbackAvailable = true`
- `pay()` con status 402 intenta `signTypedData`
- `pay()` con status 200 directo → `state = 'success'`

---

## Definition of Done (DoD) — checklist completa

### Implementación
- [ ] `src/shared/lib/web3/fuji.ts` creado con todas las constantes
- [ ] `src/features/payments/types/payment-flow.types.ts` creado con interfaces exactas de este doc
- [ ] `useChainGuard.ts` implementado — switch solo desde onClick
- [ ] `useUsdcBalance.ts` implementado — staleTime 30s
- [ ] `useWalletPayment.ts` implementado — orquesta todos los pasos A-G
- [ ] `WalletStatusBar.tsx` implementado — muestra wallet + red + balance + botón desconectar
- [ ] `FallbackApproveFlow.tsx` implementado — aviso de gas visible antes de confirmar
- [ ] `PayToCallButton.tsx` refactorizado — usa hooks nuevos, sin lógica inline de wallet
- [ ] `wagmiConfig` actualizado con `coinbaseWallet` connector
- [ ] Zero `any` explícito en TypeScript (`tsconfig strict: true`)

### Verificación manual (obligatoria antes del PR)
- [ ] MetaMask en red incorrecta → banner amber → click "Cambiar a Fuji" → switch exitoso
- [ ] MetaMask en Fuji → pago end-to-end EIP-3009 exitoso
- [ ] Rabby en Fuji → pago end-to-end EIP-3009 exitoso
- [ ] Core Wallet en Fuji → pago end-to-end sin regresión
- [ ] MetaMask → rechazar firma → mensaje "Cancelaste la operación" → NO aparece fallback
- [ ] Simular fallo técnico EIP-3009 → `FallbackApproveFlow` aparece → approve ejecutado
- [ ] Wallet con balance insuficiente → botón Pay disabled → mensaje con montos exactos
- [ ] Desconectar wallet → estado vuelve a `no_wallet`
- [ ] Conectar wallet con Fuji no configurada → `wallet_addEthereumChain` ejecutado
- [ ] Cambiar de red mientras modal abierto → UI reacciona sin crash

### Tests
- [ ] Tests unitarios de `useChainGuard`, `useUsdcBalance`, `useWalletPayment` escritos
- [ ] Test suite completa: 182/182 en verde (sin regresión)

### Calidad
- [ ] Adversarial review completado (ver checklist manual arriba)
- [ ] Code review formal completado
- [ ] PR aprobado antes de merge a main

### ⚠️ Deuda técnica documentada (no blockeante para merge de UI)
- [ ] **Pendiente HU-PAY-2 (backend):** El endpoint `/api/v1/models/[slug]/invoke` necesita manejar `X-PAYMENT-FALLBACK` header para ejecutar `transferFrom` después del approve on-chain. La UI de fallback se entrega en PAY-1; la invocación al agente post-approve espera soporte de backend.

---

## Comandos de verificación antes del primer commit

```bash
# 1. Verificar que coinbaseWallet está disponible en la versión de wagmi instalada
grep -r "coinbaseWallet" node_modules/wagmi/dist/connectors* 2>/dev/null | head -3

# 2. Verificar env vars necesarias
grep "WASIAI_OPERATOR" .env.local
# Debe existir: NEXT_PUBLIC_WASIAI_OPERATOR=0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB

# 3. Correr test suite antes de cualquier cambio (baseline)
pnpm test -- --run

# 4. Build limpio antes del PR
pnpm build
```

---

## Riesgos activos y mitigaciones

| # | Riesgo | Mitigación aplicada en esta implementación |
|---|--------|-------------------------------------------|
| R1 | `wallet_switchEthereumChain` bloqueado por popup blocker | `switchToFuji()` SOLO se llama desde onClick — jamás en useEffect |
| R2 | MetaMask antiguo sin `eth_signTypedData_v4` | try/catch en signTypedData → `METHOD_NOT_FOUND` activa fallback |
| R3 | EIP-712 domain mismatch | `verifyingContract` viene del probe 402 del servidor, no hardcodeado |
| R4 | Race condition: usuario cambia red mientras tx en vuelo | Modal en `state !== 'idle'` queda locked; `useAccount` reactivo invalida en mid-flow |
| R5 | Balance USDC stale | `useBalance` con `staleTime: 30_000` — máx 30s de cache |
| R6 | Confusión por gas en fallback | `FallbackApproveFlow` muestra aviso de gas ANTES del botón de confirmar |
| R7 | wagmi v3 rompe hooks existentes | Hacer spike en rama aislada; auditar imports de `useWalletClient` y `useAccount` antes |

---

*Story generada por San (SM — BMAD Method v6) | 2026-02-27*  
*Todos los gates superados. Dev puede comenzar directamente desde este documento.*
