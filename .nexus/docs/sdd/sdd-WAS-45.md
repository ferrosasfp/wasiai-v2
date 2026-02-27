# SDD — WAS-45: Wallet connect/disconnect en WasiNavBar

**Estado:** SPEC_PENDING  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P1 | **Estimación:** S  
**Generado por:** Architect (BMAD Method v6) · 2026-02-27

---

## 1. Contexto y decisiones de diseño

### Observaciones del codebase actual

- `WasiNavBar.tsx` ya es `'use client'` → los wagmi hooks funcionan directamente, sin necesidad de dynamic import.
- `PayToCallButton.tsx` contiene un modal de wallet inline (JSX dentro del return, controlado por `showWalletModal` state) con lógica de deduplicación de connectors. **Esta lógica se extrae** a `WalletConnectModal.tsx`.
- El patrón de deduplicación actual: `allConnectors.filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i && c.name !== 'Injected')` — se reutiliza tal cual.
- wagmi está configurado globalmente (providers wrapping la app) → `useAccount`, `useConnect`, `useDisconnect`, `useConnectors` disponibles en cualquier Client Component sin setup adicional.

### Decisiones de arquitectura (WAS-45)

| Decisión | Razón |
|----------|-------|
| `WalletConnectModal` en `src/features/payments/components/` | Es el feature owner del flujo wallet; WAS-46 y WasiNavBar importan desde ahí |
| `WalletConnectButton` en `src/features/payments/components/` | Cohesión con el dominio de pagos/wallet |
| WasiNavBar importa `WalletConnectButton` | NavBar no implementa lógica de wallet; delega al componente |
| Badge de red incorrecta = solo visual | No bloqueamos navegación; AC #8 explícito |
| Estado de wallet 100% via wagmi global | Sin `useState` local para address/connected; wagmi es la fuente de verdad |

---

## 2. Schema de DB

**Ninguno.** Esta HU es exclusivamente frontend/UI. Sin cambios en Supabase, contratos ni APIs.

---

## 3. Endpoints / API

**Ninguno.** Sin cambios de backend.

---

## 4. Componentes UI

### 4.1 WalletConnectModal — NUEVO

**Path:** `src/features/payments/components/WalletConnectModal.tsx`

```typescript
'use client'

// Props
interface WalletConnectModalProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void  // callback opcional post-conexión (WAS-46 lo usa)
}
```

**Comportamiento:**
- Si `open === false` → no renderiza nada (return null)
- Overlay oscuro: `fixed inset-0 z-50 flex items-center justify-center bg-black/40`
- Click en overlay → `onClose()`
- Click dentro del card → `e.stopPropagation()`
- Lista connectors deduplicados (mismo filtro que PayToCallButton actual)
- Al clickear un connector: `connect({ connector })` → `onClose()` → `onConnected?.()`
- Botón "Cancelar" → `onClose()`
- Connector icon: si `connector.icon` existe → `<img>`, si no → placeholder gris con "W"

**Estado interno:** ninguno (controlled component via `open` prop)

**Estructura JSX exacta:**
```tsx
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
        {t('wallet.selectWallet')}
      </p>
      {connectors.map(connector => (
        <button
          key={connector.uid}
          onClick={() => { connect({ connector }); onClose(); onConnected?.() }}
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
        {t('wallet.cancel')}
      </button>
    </div>
  </div>
)
```

**Hooks internos:**
```typescript
const { connect }   = useConnect()
const allConnectors = useConnectors()
const connectors    = allConnectors.filter((c, i, arr) =>
  arr.findIndex(x => x.name === c.name) === i && c.name !== 'Injected'
)
const t = useTranslations('wallet')
```

---

### 4.2 WalletConnectButton — NUEVO

**Path:** `src/features/payments/components/WalletConnectButton.tsx`

```typescript
'use client'

interface WalletConnectButtonProps {
  locale: string
}
```

**Estado interno:**
```typescript
const [showModal, setShowModal] = useState(false)
const [dropdownOpen, setDropdownOpen] = useState(false)
const { address, isConnected, chain } = useAccount()
const { disconnect } = useDisconnect()
const t = useTranslations('wallet')
```

**Lógica de renderizado:**

**Caso A — No conectado:**
```tsx
<>
  <button
    onClick={() => setShowModal(true)}
    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
  >
    {t('connectWallet')}
  </button>
  <WalletConnectModal open={showModal} onClose={() => setShowModal(false)} />
</>
```

**Caso B — Conectado, red correcta:**
```tsx
<div className="relative">
  <button
    onClick={() => setDropdownOpen(!dropdownOpen)}
    className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
  >
    <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
    {truncateAddress(address)}  {/* 0x1234...abcd */}
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
```

**Caso C — Conectado, red incorrecta:**
```tsx
// Igual que Caso B pero badge es amarillo/rojo
<span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
// Texto adicional en dropdown: red incorrecta (solo informativo, sin bloquear)
```

**Helper:**
```typescript
function truncateAddress(addr: `0x${string}` | undefined): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}
```

**Fuji chain ID:** `43113` (desde `@/shared/lib/web3/fuji` ya existente)

---

### 4.3 WasiNavBar — MODIFICAR

**Path:** `src/components/WasiNavBar.tsx`

**Cambios:**
1. Importar `WalletConnectButton`
2. Agregar en desktop auth section (junto a sign in/sign out):
   ```tsx
   <WalletConnectButton locale={locale} />
   ```
3. Agregar en mobile menu (antes del bloque de auth):
   ```tsx
   <div className="pt-2 border-t border-gray-100">
     <WalletConnectButton locale={locale} />
   </div>
   ```

**Posición en desktop:** Entre `ApiKeyBalance` y los botones de auth (Login/Signup o email+signout).

**Posición en mobile:** Dentro del `div#mobile-menu`, antes del bloque de auth de mobile.

---

## 5. i18n — Claves nuevas

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

## 6. Flujo completo

```
Usuario visita WasiAI (cualquier página)
  ↓
WasiNavBar renderiza WalletConnectButton
  ↓
[Sin wallet] → Muestra botón "Connect Wallet"
  → Click → WalletConnectModal opens (z-50, overlay)
  → Selecciona connector → wagmi connect() → modal closes
  → WalletConnectButton re-renderiza: dirección truncada + indicador verde
  → PayToCallButton en cualquier página detecta cambio (wagmi global) ✓

[Con wallet, red correcta] → Muestra dirección + verde
  → Click → dropdown con "Disconnect"
  → Disconnect → wagmi disconnect() → vuelve a "Connect Wallet"

[Con wallet, red incorrecta] → Muestra dirección + amarillo
  → Navegación no bloqueada (AC #8)
```

---

## 7. Definition of Done

- [ ] `WalletConnectModal.tsx` creado en `src/features/payments/components/`
- [ ] `WalletConnectButton.tsx` creado en `src/features/payments/components/`
- [ ] `WasiNavBar.tsx` importa y renderiza `WalletConnectButton` en desktop y mobile
- [ ] Botón "Connect Wallet" visible en navbar cuando no hay wallet conectada
- [ ] Modal se abre al hacer click, connectors deduplicados (sin "Injected" raw)
- [ ] Dirección truncada visible cuando wallet conectada (`0x1234...abcd`)
- [ ] Dropdown "Disconnect" funcional
- [ ] Indicador visual de red (verde = correcta, amarillo = incorrecta)
- [ ] Mobile: WalletConnectButton en hamburger menu
- [ ] `src/messages/en.json` y `es.json` con claves `wallet.*`
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Estado global via wagmi (sin useState local para address)
- [ ] Adversarial review completado
- [ ] `git push origin master master:main`

---

## 8. Implementation Readiness Check

| Item | Estado |
|------|--------|
| wagmi configurado globalmente | ✅ Ya existe |
| `useAccount`, `useConnect`, `useDisconnect`, `useConnectors` disponibles | ✅ Ya usados en PayToCallButton |
| WasiNavBar es Client Component | ✅ Ya tiene `'use client'` |
| Patrón de deduplicación de connectors | ✅ Copiado de PayToCallButton actual |
| next-intl disponible en Client Components | ✅ `useTranslations` ya usado en NavBar |
| FUJI_CHAIN_ID disponible | ✅ `@/shared/lib/web3/fuji` |
| Sin cambios de backend/DB | ✅ Confirmado |
| Dependencias de WAS-46 | ✅ WAS-45 crea WalletConnectModal; WAS-46 lo consume |

**Veredicto: IMPLEMENTABLE sin ambigüedades.** Todos los building blocks existen. El dev puede implementar directamente desde este SDD.

---

*Generado por Architect (BMAD v6) · Sprint 7 · 2026-02-27*
