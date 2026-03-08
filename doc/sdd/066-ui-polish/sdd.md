# SDD #066 — UI Polish: Navbar, Refresh, Wallet Display & Mobile Home

**Tipo:** improvement · **SDD_MODE:** full  
**Status:** SPEC_APPROVED pending  
**Fecha:** 2026-03-08

---

## Contexto

Cuatro áreas de UI identificadas con problemas visuales o funcionales:

- **A** — Link "Docs" aparece antes de "Dashboard" en navbar desktop
- **B** — `ApiKeyBalance` navbar no refresca tras acciones en Agent Keys
- **C** — `WalletConnectButton` muestra círculo de color Thirdweb no alineado con design system
- **D** — Mobile home: `FilterPanel` desborda horizontalmente; `BottomTabBar` solapa contenido

---

## Decisiones de Diseño

### D-1: Mecanismo refresh ApiKeyBalance
`CustomEvent('apikey:refresh')` global. Sin provider nuevo, sin context, sin SSR. `agent-keys/page.tsx` llama `window.dispatchEvent(new CustomEvent('apikey:refresh'))` en cada acción exitosa. `useApiKeyBalance.ts` escucha el evento en su `useEffect` y llama `fetchBalance()`.

### D-2: WalletConnectButton — custom component
`ConnectButton` Thirdweb renderiza un avatar coloreado no overrideable vía `detailsButton.style`. Solución: cuando hay wallet conectada, reemplazar con componente propio usando `useActiveAccount` + `useWalletBalance` + `useDisconnect`. Estado desconectado: `ConnectButton` original sin cambios.

Dropdown del wallet pill (estado conectado):
- Address completa (monospace, truncada)
- Link "Ver en Snowtrace" → `https://testnet.snowtrace.io/address/{address}`
- Botón "Disconnect" con `useDisconnect`

### D-3: FilterPanel mobile overflow
El problema está en `page.tsx` (home): el header `flex items-center justify-between gap-4` pone `SearchBar` + `FilterPanel` en la misma fila rígida. Fix en `page.tsx`: mover `FilterPanel` fuera del header row, a una fila separada con `overflow-x-auto` y `pb-2` para scroll horizontal suave. No tocar `FilterPanel.tsx`.

### D-4: BottomTabBar padding
`[locale]/layout.tsx`: envolver `{children}` en `<div className="pb-20 sm:pb-0">`. Esto reserva espacio bajo el contenido en mobile para que el `BottomTabBar` (fixed bottom) no solape.

---

## Waves de Implementación

### W0 — useApiKeyBalance: listener CustomEvent
**Archivo:** `src/features/layout/hooks/useApiKeyBalance.ts`

En el `useEffect` que ya existe, agregar:
```typescript
window.addEventListener('apikey:refresh', fetchBalance)
return () => {
  // cleanup existente...
  window.removeEventListener('apikey:refresh', fetchBalance)
}
```

### W1 — Agent Keys: dispatchEvent tras acciones
**Archivo:** `src/app/[locale]/agent-keys/page.tsx`

Helper al tope del componente:
```typescript
function refreshNavBalance() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('apikey:refresh'))
  }
}
```

Llamar `refreshNavBalance()` en:
- `onSuccess` del `DepositModal`
- `onSuccess` del `WithdrawModal`  
- `onSuccess` del `CloseKeyModal`

### W2 — Navbar: reordenar Docs
**Archivo:** `src/components/WasiNavBar.tsx`

```typescript
// Antes
const secondaryLinksPublic = [
  { path: '/sandbox',           label: tNav('sandbox') },
  { path: '/docs',              label: tNav('docs')    },
]
const secondaryLinksAuth = [
  { path: '/creator/dashboard', label: tNav('dashboard') },
]

// Después
const secondaryLinksPublic = [
  { path: '/sandbox', label: tNav('sandbox') },
]
const secondaryLinksAuth = [
  { path: '/creator/dashboard', label: tNav('dashboard') },
  { path: '/docs',              label: tNav('docs')      },
]
```

### W3 — WalletConnectButton: custom details component
**Archivo:** `src/features/payments/components/WalletConnectButton.tsx`

Importar: `useActiveAccount`, `useWalletBalance`, `useDisconnect` de `thirdweb/react`.  
Importar: `avalancheFuji` de `thirdweb/chains`.  
Importar: `useState`, `useRef`, `useEffect` de `react`.

Estructura del componente:
```typescript
export function WalletConnectButton({ locale: _locale }) {
  const account = useActiveAccount()
  
  // Si no hay wallet conectada → ConnectButton original
  if (!account) return <ConnectButton ... />
  
  // Si hay wallet conectada → pill custom
  return <WalletDetailsPill account={account} />
}

function WalletDetailsPill({ account }) {
  const { data: balance } = useWalletBalance({ 
    chain: avalancheFuji, 
    address: account.address,
    client: thirdwebClient
  })
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  
  // Close on outside click
  useEffect(() => { /* mousedown listener */ }, [])
  
  const shortAddr = `${account.address.slice(0,6)}...${account.address.slice(-4)}`
  const avaxBal   = balance ? `${parseFloat(balance.displayValue).toFixed(4)} AVAX` : '...'
  const explorerUrl = `https://testnet.snowtrace.io/address/${account.address}`
  
  return (
    <div ref={ref} className="relative">
      {/* Pill — mismo estilo que botones del navbar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
        <span>{shortAddr}</span>
        <span className="text-gray-400 text-xs">{avaxBal}</span>
      </button>
      
      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-50">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-xs text-gray-400 font-mono break-all">{account.address}</p>
          </div>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            Ver en Snowtrace →
          </a>
          <div className="border-t border-gray-100 px-4 py-2">
            <button onClick={() => { disconnect(...); setOpen(false) }}
                    className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

### W4 — Layout: pb-20 mobile
**Archivo:** `src/app/[locale]/layout.tsx`

```tsx
// Antes
{children}

// Después
<div className="pb-20 sm:pb-0">{children}</div>
```

### W5 — Home: fix FilterPanel overflow mobile
**Archivo:** `src/app/[locale]/page.tsx`

```tsx
// Antes — header con SearchBar+FilterPanel en misma fila
<div className="mb-8 flex items-center justify-between gap-4">
  <h2>...</h2>
  <div className="flex items-center gap-3">
    <SearchBar />
    <FilterPanel />
  </div>
</div>

// Después — FilterPanel en fila separada con scroll horizontal
<div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
  <h2>...</h2>
  <SearchBar />
</div>
<div className="mb-4 overflow-x-auto pb-2 -mx-6 px-6">
  <FilterPanel />
</div>
```

---

## Acceptance Criteria

| # | Criterio | Wave |
|---|----------|------|
| AC-1 | Navbar desktop: Sandbox → Dashboard → Docs | W2 |
| AC-2 | Mobile ActionSheet "Yo": Docs presente (sin cambios — ya existe) | — |
| AC-3 | Tras onSuccess en Add USDC / Withdraw / Close Key → ApiKeyBalance refresca | W0+W1 |
| AC-4 | Wallet conectada: pill border-gray-200, dirección truncada + AVAX, sin círculo Thirdweb | W3 |
| AC-5 | Wallet desconectada: ConnectButton original | W3 |
| AC-6 | Home mobile: sin scroll horizontal | W5 |
| AC-7 | BottomTabBar no solapa contenido | W4 |
| AC-8 | tsc 0 errores + lint 0 warnings | QG |

---

## Archivos Modificados
1. `src/features/layout/hooks/useApiKeyBalance.ts`
2. `src/app/[locale]/agent-keys/page.tsx`
3. `src/components/WasiNavBar.tsx`
4. `src/features/payments/components/WalletConnectButton.tsx`
5. `src/app/[locale]/layout.tsx`
6. `src/app/[locale]/page.tsx`

## Archivos Nuevos
- Ninguno (componente `WalletDetailsPill` inline en `WalletConnectButton.tsx`)

