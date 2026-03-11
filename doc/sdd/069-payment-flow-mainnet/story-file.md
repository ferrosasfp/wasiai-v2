# Story File #069 — Payment Flow Mainnet

## Goal
Reemplazar constantes hardcodeadas a Fuji en el payment flow por valores dinámicos de `chain.ts`,
para que mainnet (43114) y testnet (43113) funcionen sin cambios de código.

## Acceptance Criteria
- AC1: WHEN `NEXT_PUBLIC_CHAIN_ID=43114`, THE app SHALL pedir Avalanche Mainnet (no Fuji)
- AC2: WHEN `NEXT_PUBLIC_CHAIN_ID=43113`, THE app SHALL pedir Fuji (sin regresión)
- AC3: WHEN usuario está en red incorrecta, THE banner SHALL mostrar nombre de red correcto
- AC4: WHEN `switchChain`, THE app SHALL cambiar a la red correcta según `CHAIN_ID`

## Waves

### W0 — Extender chain.ts
**Archivo:** `src/lib/chain.ts`
**Acción:** Agregar exports `CHAIN` y `CHAIN_PARAMS`

Agregar al final del archivo (después de los exports existentes):
```typescript
import { avalanche, avalancheFuji } from 'viem/chains'

export const CHAIN = IS_MAINNET ? avalanche : avalancheFuji

export const CHAIN_PARAMS = {
  chainId:           IS_MAINNET ? '0xA86A' : '0xA869',
  chainName:         IS_MAINNET ? 'Avalanche C-Chain' : 'Avalanche Fuji Testnet',
  nativeCurrency:    { name: 'AVAX', symbol: 'AVAX', decimals: 18 as number },
  rpcUrls:           [IS_MAINNET ? 'https://api.avax.network/ext/bc/C/rpc' : 'https://api.avax-test.network/ext/bc/C/rpc'] as string[],
  blockExplorerUrls: [IS_MAINNET ? 'https://snowtrace.io/' : 'https://testnet.snowtrace.io/'] as string[],
} as const
```

### W1 — Actualizar hooks (paralelo)

**Archivo 1:** `src/features/payments/hooks/useChainGuard.ts`
- Cambiar import: `from '@/shared/lib/web3/fuji'` → `from '@/lib/chain'`
- Cambiar import keys: `FUJI_CHAIN_ID, FUJI_CHAIN_PARAMS` → `CHAIN_ID, CHAIN_PARAMS`
- Reemplazar `FUJI_CHAIN_ID` → `CHAIN_ID` (2 ocurrencias)
- Reemplazar `FUJI_CHAIN_PARAMS` → `CHAIN_PARAMS` (1 ocurrencia)
- Renombrar función `switchToFuji` → `switchToChain`
- Actualizar return: `switchToFuji` → `switchToChain`

**Archivo 2:** `src/features/payments/hooks/useUsdcBalance.ts`
- Cambiar import: `from '@/shared/lib/web3/fuji'` → `from '@/lib/chain'`
- Cambiar import keys: `USDC_FUJI_ADDRESS, FUJI_CHAIN_ID` → `USDC_ADDRESS, CHAIN_ID`
- Reemplazar `USDC_FUJI_ADDRESS` → `USDC_ADDRESS`
- Reemplazar `FUJI_CHAIN_ID` → `CHAIN_ID`

**Archivo 3:** `src/features/payments/hooks/useWalletPayment.ts`
- Cambiar import keys de fuji: `FUJI_CHAIN_ID, USDC_FUJI_ADDRESS` → `CHAIN_ID, USDC_ADDRESS` (desde `@/lib/chain`)
- Reemplazar todas las ocurrencias de `FUJI_CHAIN_ID` → `CHAIN_ID`
- Reemplazar todas las ocurrencias de `USDC_FUJI_ADDRESS` → `USDC_ADDRESS`
- Renombrar destructuring `switchToFuji` → `switchToChain` (línea 53 y 254)

### W2 — Actualizar componentes (paralelo)

**Archivo 1:** `src/features/payments/components/WalletConnectButton.tsx`
- Eliminar: `import { avalancheFuji } from 'viem/chains'`
- Agregar: `import { CHAIN_ID } from '@/lib/chain'`
- Reemplazar: `chainId: avalancheFuji.id` → `chainId: CHAIN_ID`

**Archivo 2:** `src/features/payments/components/WalletStatusBar.tsx`
- En el estado `wrong_network`: reemplazar texto hardcodeado:
  - `"WasiAI requiere Avalanche Fuji Testnet."` → usar `CHAIN_LABEL` importado de `@/lib/chain`
  - Agregar import: `import { CHAIN_LABEL } from '@/lib/chain'`
  - Cambiar texto: `WasiAI requiere {CHAIN_LABEL}.`

**Archivo 3:** `src/features/payments/components/PayToCallButton.tsx`
- Renombrar destructuring `switchToFuji` → `switchToChain` (líneas 28 y 142)

### W3 — Actualizar i18n

**Archivo 1:** `messages/en.json`
- `"switchToFuji"` → valor: `"Switch to Avalanche"`
- `"switching"` → valor: `"Switching network..."`
- `"switchNetwork"` → valor: `"Switch network"`
- `"errorSwitchedFuji"` → valor: `"Please switch to the correct Avalanche network in your wallet."`

**Archivo 2:** `messages/es.json`
- `"switchToFuji"` → valor: `"Cambiar a Avalanche"`
- `"switching"` → valor: `"Cambiando de red..."`
- `"switchNetwork"` → valor: `"Cambiar red"`
- `"errorSwitchedFuji"` → valor: `"Cambia tu wallet a la red Avalanche correcta e intenta de nuevo."`

## Constraint Directives
- OBLIGATORIO: importar desde `@/lib/chain`, no crear nuevas constantes
- OBLIGATORIO: mantener compatibilidad — `CHAIN_ID=43113` debe comportarse igual que hoy
- PROHIBIDO: no modificar `fuji.ts`
- PROHIBIDO: no cambiar lógica de `useWalletPayment.ts`, solo imports/constantes
- PROHIBIDO: no tocar archivos fuera de scope
- PROHIBIDO: no agregar dependencias nuevas

## Out of Scope
- API routes, contratos, docs, otros archivos con referencias Fuji
- `fuji.ts` — dejarlo como está
