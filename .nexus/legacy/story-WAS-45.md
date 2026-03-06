# Story WAS-45: Wallet connect/disconnect en WasiNavBar

**Status:** ready-for-dev  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P1 | **Estimación:** S (~1 día)  
**Dependencias:** Ninguna (habilita WAS-46)

---

## Historia de usuario

Como usuario de WasiAI, quiero ver mi wallet conectada en la navbar con opción de desconectar, siguiendo el estándar de dApp, para saber en todo momento mi estado de conexión sin ir a la ficha de un agente.

---

## Acceptance Criteria

1. La navbar muestra un botón **"Connect Wallet"** cuando no hay wallet conectada.
2. Al hacer clic en "Connect Wallet", se abre un modal con los connectors disponibles (deduplicados, sin "Injected" expuesto como opción raw).
3. Cuando hay wallet conectada, el botón muestra la **dirección truncada** (ej. `0x1234...abcd`) junto con un indicador visual de red activa.
4. Al hacer clic en la dirección truncada, aparece un **dropdown** con la opción "Disconnect".
5. Al desconectar, el botón vuelve a mostrar "Connect Wallet" sin recargar la página.
6. El **estado de wallet es global** via wagmi — `PayToCallButton` y cualquier otro componente detectan el cambio automáticamente sin estado local duplicado.
7. En **mobile** (hamburger menu), el botón de wallet aparece como ítem del menú.
8. Si la wallet está en **red incorrecta**, mostrar indicador visual (badge amarillo) sin bloquear la navegación.

---

## Estructura de archivos

### Archivos a CREAR:

| Archivo | Descripción |
|---------|-------------|
| `src/features/payments/components/WalletConnectModal.tsx` | Modal de selección de wallet (controlled) |
| `src/features/payments/components/WalletConnectButton.tsx` | Botón con estados: sin wallet / conectado / red incorrecta |

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---------|--------|
| `src/components/WasiNavBar.tsx` | Importar y renderizar `WalletConnectButton` en desktop y mobile |
| `src/messages/en.json` | Agregar objeto `"wallet"` con claves i18n |
| `src/messages/es.json` | Agregar objeto `"wallet"` con claves i18n |

### Archivos a NO tocar:
- `src/features/payments/components/PayToCallButton.tsx` — lo toca WAS-46
- Contrato, ABIs, viem, Supabase — sin cambios

---

## Código de referencia — Implementación exacta

### `WalletConnectModal.tsx` — CREAR

```typescript
'use client'

import { useConnect, useConnectors } from 'wagmi'
import { useTranslations } from 'next-intl'

interface WalletConnectModalProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void  // callback opcional post-conexión (WAS-46 lo usa)
}

export function WalletConnectModal({ open, onClose, onConnected }: WalletConnectModalProps) {
  const { connect } = useConnect()
  const allConnectors = useConnectors()
  const t = useTranslations('wallet')

  // Deduplicar connectors: por nombre, excluir "Injected" raw
  const connectors = allConnectors.filter((c, i, arr) =>
    arr.findIndex(x => x.name === c.name) === i && c.name !== 'Injected'
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 w-72 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-gray-700">
          {t('selectWallet')}
        </p>
        {connectors.map(connector => (
          <button
            key={connector.uid}
            onClick={() => {
              connect({ connector })
              onClose()
              onConnected?.()
            }}
            className="w-full flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50 transition"
          >
            {connector.icon ? (
              <img src={connector.icon} alt={connector.name} className="w-6 h-6 rounded-full" />
            ) : (
              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">W</span>
            )}
            <span className="font-medium text-gray-800">{connector.name}</span>
          </button>
        ))}
        <button
          onClick={onClose}
          className="w-full text-xs text-gray-400 hover:text-gray-600 pt-1"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
```

### `WalletConnectButton.tsx` — CREAR

```typescript
'use client'

import { useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { useTranslations } from 'next-intl'
import { WalletConnectModal } from './WalletConnectModal'

// Fuji chain ID — red correcta
const FUJI_CHAIN_ID = 43113

interface WalletConnectButtonProps {
  locale: string
}

function truncateAddress(addr: `0x${string}` | undefined): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function WalletConnectButton({ locale }: WalletConnectButtonProps) {
  const [showModal, setShowModal] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { address, isConnected, chain } = useAccount()
  const { disconnect } = useDisconnect()
  const t = useTranslations('wallet')

  const isWrongNetwork = isConnected && chain?.id !== FUJI_CHAIN_ID

  // Caso A: No conectado
  if (!isConnected) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          {t('connectWallet')}
        </button>
        <WalletConnectModal open={showModal} onClose={() => setShowModal(false)} />
      </>
    )
  }

  // Caso B/C: Conectado (red correcta o incorrecta)
  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        <span className={`inline-block h-2 w-2 rounded-full ${isWrongNetwork ? 'bg-yellow-400' : 'bg-green-400'}`} />
        {truncateAddress(address)}
        {isWrongNetwork && (
          <span className="text-yellow-600 text-xs">{t('wrongNetwork')}</span>
        )}
      </button>
      {dropdownOpen && (
        <div className="absolute right-0 mt-1 w-40 rounded-xl border border-gray-100 bg-white shadow-lg z-50">
          <button
            onClick={() => { disconnect(); setDropdownOpen(false) }}
            className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 rounded-xl"
          >
            {t('disconnect')}
          </button>
        </div>
      )}
    </div>
  )
}
```

### `WasiNavBar.tsx` — MODIFICAR

Agregar import:
```typescript
import { WalletConnectButton } from '@/features/payments/components/WalletConnectButton'
```

**En desktop** (junto a ApiKeyBalance y botones de auth):
```tsx
{/* Wallet connect — entre ApiKeyBalance y botones de auth */}
<WalletConnectButton locale={locale} />
```

**En mobile** (dentro del `div#mobile-menu`, antes del bloque de auth mobile):
```tsx
<div className="pt-2 border-t border-gray-100">
  <WalletConnectButton locale={locale} />
</div>
```

---

## Claves i18n

### `src/messages/en.json` — agregar objeto `"wallet"`:
```json
"wallet": {
  "connectWallet": "Connect Wallet",
  "disconnect": "Disconnect",
  "selectWallet": "Select your wallet",
  "cancel": "Cancel",
  "wrongNetwork": "Wrong network"
}
```

### `src/messages/es.json` — agregar objeto `"wallet"`:
```json
"wallet": {
  "connectWallet": "Conectar Wallet",
  "disconnect": "Desconectar",
  "selectWallet": "Selecciona tu wallet",
  "cancel": "Cancelar",
  "wrongNetwork": "Red incorrecta"
}
```

---

## Notas de implementación

### Contexto del codebase
- `WasiNavBar.tsx` **ya es** `'use client'` → wagmi hooks disponibles directamente, sin `dynamic import`.
- `PayToCallButton.tsx` tiene un modal de wallet inline con lógica de deduplicación de connectors — **esa lógica se extrae** a `WalletConnectModal.tsx`. **NO tocar PayToCallButton en esta HU** (lo hace WAS-46).
- wagmi está configurado globalmente (providers) → `useAccount`, `useConnect`, `useDisconnect`, `useConnectors` disponibles en cualquier Client Component.
- `useTranslations` ya se usa en WasiNavBar → el patrón está establecido.

### Patrón de deduplicación de connectors
```typescript
// Copiado del PayToCallButton actual — funciona correctamente
allConnectors.filter((c, i, arr) =>
  arr.findIndex(x => x.name === c.name) === i && c.name !== 'Injected'
)
```

### Estado global — regla de oro
**NUNCA** usar `useState` local para address/isConnected. wagmi es la única fuente de verdad. El estado fluye automáticamente a todos los componentes que usan `useAccount()`.

### WalletConnectModal es controlled component
- `open` prop controla visibilidad (si `!open` → `return null`)
- El padre (`WalletConnectButton` o `PayToCallButton` en WAS-46) gestiona el state `showModal`
- `onConnected` callback es opcional → WAS-46 lo usará para ejecutar `pay()` post-conexión

### Fuji chain ID
- `FUJI_CHAIN_ID = 43113` — usarlo como constante local en `WalletConnectButton`
- Si existe `@/shared/lib/web3/fuji` importarlo desde ahí; si no, definir la constante local

---

## Flujo completo

```
Usuario visita WasiAI (cualquier página)
  ↓
WasiNavBar renderiza WalletConnectButton
  ↓
[Sin wallet] → Muestra botón "Connect Wallet"
  → Click → WalletConnectModal opens (z-50, overlay)
  → Click connector → wagmi connect() → modal cierra
  → WalletConnectButton re-renderiza: dirección truncada + indicador verde
  → PayToCallButton en cualquier página detecta cambio (wagmi global) ✓

[Con wallet, red correcta] → Muestra dirección + badge verde
  → Click → dropdown con "Disconnect"
  → Disconnect → wagmi disconnect() → vuelve a "Connect Wallet"

[Con wallet, red incorrecta (chain.id ≠ 43113)] → Muestra dirección + badge amarillo
  → Navegación NO bloqueada (solo visual)
```

---

## DoD — Definition of Done

- [ ] `WalletConnectModal.tsx` creado en `src/features/payments/components/`
- [ ] `WalletConnectButton.tsx` creado en `src/features/payments/components/`
- [ ] `WasiNavBar.tsx` importa y renderiza `WalletConnectButton` en desktop y mobile
- [ ] Botón "Connect Wallet" visible en navbar cuando no hay wallet conectada
- [ ] Modal se abre al hacer click, connectors deduplicados (sin "Injected" raw)
- [ ] Dirección truncada visible cuando wallet conectada (`0x1234...abcd`)
- [ ] Dropdown "Disconnect" funcional — al desconectar vuelve a "Connect Wallet"
- [ ] Indicador visual de red: verde (correcta), amarillo (incorrecta)
- [ ] Mobile: WalletConnectButton visible en hamburger menu
- [ ] `src/messages/en.json` y `es.json` con claves `wallet.*`
- [ ] Sin `useState` local para address/isConnected (solo wagmi)
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Adversarial review completado antes del commit
- [ ] `git push origin master master:main`

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
- WalletConnectModal creado y listo para ser consumido por WAS-46
- WAS-46 no puede implementarse hasta que este story esté completo

### File List
- `src/features/payments/components/WalletConnectModal.tsx` — NUEVO
- `src/features/payments/components/WalletConnectButton.tsx` — NUEVO
- `src/components/WasiNavBar.tsx` — MODIFICADO
- `src/messages/en.json` — MODIFICADO
- `src/messages/es.json` — MODIFICADO
