# Story File #066 — UI Polish

## Tu trabajo como dev

Implementar en orden estricto W0→W1→W2→W3→W4→W5, luego QG.

---

## W0 — useApiKeyBalance: escuchar CustomEvent

**Archivo:** `src/features/layout/hooks/useApiKeyBalance.ts`

En el `useEffect` (el que tiene el `fetchBalance` inicial + interval + visibilitychange), agregar al listeners block:

```typescript
window.addEventListener('apikey:refresh', fetchBalance as EventListener)
```

Y en el cleanup del return:
```typescript
window.removeEventListener('apikey:refresh', fetchBalance as EventListener)
```

---

## W1 — Agent Keys: dispatch tras cada acción exitosa

**Archivo:** `src/app/[locale]/agent-keys/page.tsx`

Agregar helper justo antes del componente `AgentKeysPage`:
```typescript
function refreshNavBalance() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('apikey:refresh'))
  }
}
```

Llamar `refreshNavBalance()` en:
1. `DepositModal` → en el bloque de éxito tras `setStatus('success')` y `setTimeout(onSuccess, ...)`
2. `WithdrawModal` → justo antes de `onSuccess()`
3. `CloseKeyModal` → justo antes de `onSuccess(withdrawTxHash)`

---

## W2 — Navbar: mover Docs después de Dashboard

**Archivo:** `src/components/WasiNavBar.tsx`

```typescript
// ANTES
const secondaryLinksPublic = [
  { path: '/sandbox', label: tNav('sandbox') },
  { path: '/docs',    label: tNav('docs')    },
]
const secondaryLinksAuth = [
  { path: '/creator/dashboard', label: tNav('dashboard') },
]

// DESPUÉS
const secondaryLinksPublic = [
  { path: '/sandbox', label: tNav('sandbox') },
]
const secondaryLinksAuth = [
  { path: '/creator/dashboard', label: tNav('dashboard') },
  { path: '/docs',              label: tNav('docs')      },
]
```

---

## W3 — WalletConnectButton: componente custom

**Archivo:** `src/features/payments/components/WalletConnectButton.tsx`

Reemplazar el contenido del archivo completo con esto:

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { ConnectButton }               from 'thirdweb/react'
import { useActiveAccount, useWalletBalance, useDisconnect, useActiveWallet } from 'thirdweb/react'
import { inAppWallet, createWallet }   from 'thirdweb/wallets'
import { avalancheFuji }               from 'thirdweb/chains'
import { thirdwebClient }              from '@/shared/lib/web3/thirdwebClient'

interface WalletConnectButtonProps { locale: string }

const wallets = [
  inAppWallet({
    auth: { options: ['google', 'email'] },
    smartAccount: { chain: avalancheFuji, sponsorGas: true },
  }),
  createWallet('io.metamask'),
  createWallet('app.core.extension'),
  createWallet('com.coinbase.wallet'),
]

// ── Pill mostrado cuando hay wallet conectada ─────────────────────────────────
function WalletDetailsPill() {
  const account       = useActiveAccount()
  const activeWallet  = useActiveWallet()
  const { disconnect } = useDisconnect()
  const { data: balance } = useWalletBalance({
    chain:   avalancheFuji,
    address: account?.address,
    client:  thirdwebClient,
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!account) return null

  const shortAddr   = `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
  const avaxBal     = balance ? `${parseFloat(balance.displayValue).toFixed(4)} AVAX` : '...'
  const explorerUrl = `https://testnet.snowtrace.io/address/${account.address}`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" aria-hidden="true" />
        <span>{shortAddr}</span>
        <span className="text-gray-400 text-xs hidden sm:inline">{avaxBal}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-50">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-[11px] text-gray-400 font-mono break-all">{account.address}</p>
            <p className="text-xs text-gray-500 mt-0.5">{avaxBal}</p>
          </div>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Ver en Snowtrace →
          </a>
          <div className="border-t border-gray-100 px-4 py-2">
            <button
              onClick={() => { if (activeWallet) disconnect(activeWallet); setOpen(false) }}
              className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Export principal ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WalletConnectButton({ locale: _locale }: WalletConnectButtonProps) {
  const account = useActiveAccount()

  if (account) return <WalletDetailsPill />

  return (
    <ConnectButton
      client={thirdwebClient}
      wallets={wallets}
      chain={avalancheFuji}
      theme="light"
      connectButton={{
        label: 'Connect Wallet',
        style: {
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '6px 12px',
          borderRadius: '0.5rem',
          border: '1px solid #e5e7eb',
          backgroundColor: 'transparent',
          color: '#4b5563',
          height: 'auto',
          minWidth: 'auto',
        },
      }}
      connectModal={{ showThirdwebBranding: false }}
    />
  )
}
```

---

## W4 — Layout: reservar espacio para BottomTabBar

**Archivo:** `src/app/[locale]/layout.tsx`

```tsx
// Antes
{children}

// Después  
<div className="pb-20 sm:pb-0">{children}</div>
```

---

## W5 — Home: separar FilterPanel del header

**Archivo:** `src/app/[locale]/page.tsx`

Busca el bloque:
```tsx
<div className="mb-8 flex items-center justify-between gap-4">
  <h2 className="text-2xl font-bold text-gray-900 shrink-0">...
  </h2>
  <div className="flex items-center gap-3">
    <Suspense><SearchBar .../></Suspense>
    <Suspense><FilterPanel /></Suspense>
  </div>
</div>
```

Reemplazar por:
```tsx
<div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
  <h2 className="text-2xl font-bold text-gray-900 shrink-0">...
  </h2>
  <Suspense><SearchBar .../></Suspense>
</div>
<div className="mb-6 overflow-x-auto">
  <Suspense><FilterPanel /></Suspense>
</div>
```

---

## QG — Quality Gate

```bash
npx tsc --noEmit
npm run lint -- --max-warnings 0
npm run build
```

Los 3 deben pasar en 0 errores.
