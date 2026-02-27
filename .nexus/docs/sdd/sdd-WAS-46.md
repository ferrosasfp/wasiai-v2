# SDD — WAS-46: BUG — Botón Pay debe conectar wallet cuando no hay wallet conectada

**Estado:** SPEC_PENDING  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P0 | **Estimación:** XS  
**Generado por:** Architect (BMAD Method v6) · 2026-02-27  
**Dependencia bloqueante:** WAS-45 debe estar implementado primero

---

## 1. Análisis del bug

### Root cause (verificado en codebase)

En `PayToCallButton.tsx`, el botón CTA ejecuta `pay()` directamente:
```tsx
<button
  onClick={pay}
  disabled={isDisabled}
  ...
>
```

`isDisabled` cuando `ctx.state === 'idle'` solo evalúa `!input.trim()` — **NO verifica si hay wallet conectada**.

Cuando no hay wallet:
- `ctx.state` es `'no_wallet'` (lo infiere `useWalletPayment` de `!isConnected`)
- `buttonLabel` muestra `'connectWallet'` correctamente
- Pero `isDisabled` para `no_wallet` no está en la lista explícita de estados deshabilitados → **el botón NO está disabled**
- Click → `pay()` → internamente verifica wallet → no hace nada visible

**Evidencia en `isDisabled`:**
```typescript
const isDisabled =
  isProcessing                                        ||
  ctx.state === 'insufficient_balance'                ||
  ctx.state === 'wrong_network'                       ||
  (ctx.state === 'idle' && !input.trim())
  // ← NO incluye: ctx.state === 'no_wallet'
```

### Solución elegida

Interceptar el click en el botón CTA:
- Si `ctx.state === 'no_wallet'` (sin wallet) → abrir `WalletConnectModal`
- Si no → ejecutar `pay()` como siempre
- Post-conexión → escuchar `onConnect` wagmi → ejecutar `pay()` automáticamente

---

## 2. Schema de DB / Endpoints / On-chain

**Ninguno.** Fix puramente de lógica frontend.

---

## 3. Cambios en archivos

### 3.1 PayToCallButton.tsx — MODIFICAR

**Path:** `src/features/payments/components/PayToCallButton.tsx`

#### Cambio 1: Importar WalletConnectModal y useWatchAccount

```typescript
// Agregar imports:
import { WalletConnectModal } from './WalletConnectModal'  // de WAS-45
import { useAccount } from 'wagmi'  // ya disponible via useWalletPayment pero se puede usar directo
```

#### Cambio 2: Agregar estado para el modal

```typescript
// Ya existe:
const [showWalletModal, setShowWalletModal] = useState(false)
// ← Este estado ya existe en PayToCallButton. Se reutiliza para el nuevo WalletConnectModal.
```

#### Cambio 3: Reemplazar el modal inline por WalletConnectModal

Eliminar el bloque JSX:
```tsx
{/* Wallet selector modal — ELIMINAR este bloque */}
{showWalletModal && (
  <div className="fixed inset-0 z-50 ...">
    ...
  </div>
)}
```

Reemplazar por:
```tsx
{/* Wallet selector modal — reutiliza WalletConnectModal de WAS-45 */}
<WalletConnectModal
  open={showWalletModal}
  onClose={() => setShowWalletModal(false)}
  onConnected={handleWalletConnected}
/>
```

#### Cambio 4: Nuevo handler de click del botón CTA

```typescript
// Reemplazar onClick={pay} por onClick={handlePayClick}

function handlePayClick() {
  // Si no hay wallet → abrir modal en lugar de intentar pagar
  if (ctx.state === 'no_wallet') {
    setShowWalletModal(true)
    return
  }
  pay()
}

// Handler post-conexión: cuando wallet conecta, ejecutar pay() automáticamente
function handleWalletConnected() {
  // Pequeño delay para que wagmi propague el estado antes de ejecutar pay()
  // useAccount().address puede no estar disponible inmediatamente
  setTimeout(() => {
    pay()
  }, 300)
}
```

**Nota sobre el delay:** wagmi propaga el estado de `address` en el siguiente ciclo de render después del `connect()`. Un `setTimeout(300ms)` es suficiente para garantizar que `useAccount().address` esté disponible cuando `pay()` lo consulte. Alternativa más robusta: usar `useEffect` con dependency en `address`.

#### Alternativa robusta (recomendada):

```typescript
const { address } = useAccount()
const pendingPayRef = useRef(false)

// Cuando address cambia de undefined → defined y hay pay pendiente
useEffect(() => {
  if (address && pendingPayRef.current) {
    pendingPayRef.current = false
    pay()
  }
}, [address]) // eslint-disable-line react-hooks/exhaustive-deps

function handleWalletConnected() {
  pendingPayRef.current = true
  // pay() se ejecutará via useEffect cuando address esté disponible
}

function handlePayClick() {
  if (!address) {  // más directo que ctx.state === 'no_wallet'
    setShowWalletModal(true)
    return
  }
  pay()
}
```

#### Cambio 5: Actualizar el botón CTA

```tsx
<button
  onClick={handlePayClick}  {/* ← antes era onClick={pay} */}
  disabled={isDisabled}
  className={...}
>
  {buttonLabel}
</button>
```

#### Cambio 6: Eliminar imports huérfanos

Con el modal extraído a `WalletConnectModal`, en `PayToCallButton` ya no se necesitan directamente:
- `useConnect` (movido a WalletConnectModal)
- `useConnectors` (movido a WalletConnectModal)

Verificar que `useDisconnect` sigue siendo necesario para `handleDisconnect` (sí lo es).

```typescript
// ELIMINAR de PayToCallButton:
import { useConnect, useDisconnect, useConnectors } from 'wagmi'
// useConnect y useConnectors ya no se usan aquí

// MANTENER:
import { useDisconnect } from 'wagmi'
// Y agregar:
import { useAccount } from 'wagmi'  // para address en handlePayClick
```

---

### 3.2 useWalletPayment.ts — VERIFICAR (sin cambios)

`ctx.account` / `address`: el hook ya expone `address` de `useAccount()`. 

Revisando el hook:
```typescript
const { address } = useAccount()
```

El `ctx` del hook incluye `address` en el context retornado. Verificar que la propiedad se llama `ctx.address` (no `ctx.account`) en el componente — consistente con el código actual en `WalletStatusBar`.

**Acción:** Solo verificar, sin cambios en el hook.

---

## 4. Flujo completo post-fix

```
Usuario en ficha de agente, SIN wallet conectada
  ↓
Input texto de prueba → Click "Pagar $X USDC"
  ↓
handlePayClick() → !address → setShowWalletModal(true)
  ↓
WalletConnectModal abre (overlay oscuro)
  ↓
[Caso A: usuario conecta wallet]
  → connect({ connector }) → modal cierra → handleWalletConnected()
  → useEffect detecta address cambió de undefined → defined
  → pendingPayRef.current === true → pay() ejecuta automáticamente
  → Flujo normal de pago x402 continúa ✓
  → Input preservado (useState local no se tocó) ✓

[Caso B: usuario cancela modal]
  → onClose() → showWalletModal = false
  → Botón vuelve a estado inicial "Pagar $X USDC" sin error ✓
  → Input preservado ✓
```

---

## 5. Preservación del input (AC #4)

El `input` es un `useState` en `PayToCallButton`. Durante el flujo de conexión de wallet:
- El componente NO se desmonta
- `showWalletModal` cambia pero no afecta `input`
- El `useEffect` de `pendingPayRef` usa closure sobre `pay()` que a su vez usa closure sobre `input`

**Garantía:** El input se preserva en todos los casos.

---

## 6. Definition of Done

- [ ] Click en "Pay" sin wallet → abre `WalletConnectModal` (no hace nada silencioso)
- [ ] Post-conexión → `pay()` ejecuta automáticamente sin acción extra del usuario
- [ ] Cerrar modal sin conectar → botón en estado inicial, sin error, sin loading
- [ ] Input del usuario preservado durante todo el flujo
- [ ] Modal inline eliminado de `PayToCallButton` (usa `WalletConnectModal` de WAS-45)
- [ ] `useConnect` y `useConnectors` eliminados de imports de `PayToCallButton`
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Test manual: sin wallet → Pay → conecta → pago procede
- [ ] Test manual: cerrar modal → botón vuelve a estado inicial
- [ ] Adversarial review completado
- [ ] `git push origin master master:main`

---

## 7. Implementation Readiness Check

| Item | Estado |
|------|--------|
| `WalletConnectModal` existe (WAS-45) | ⚠️ Depende de WAS-45 — debe implementarse primero |
| `showWalletModal` state ya existe en PayToCallButton | ✅ Solo hay que cambiar qué componente lo usa |
| `useAccount().address` disponible | ✅ Ya en el hook |
| Patrón `useRef` para pay pendiente | ✅ Patrón React estándar |
| Sin cambios de backend/DB/contratos | ✅ Confirmado |
| Riesgo race condition cubierto | ✅ Con `useEffect` + `ref` patrón |

**Veredicto: IMPLEMENTABLE, bloqueado por WAS-45.** Una vez WAS-45 entregue `WalletConnectModal`, este fix es < 3 horas. El SDD es autocontenido — cero ambigüedades.

---

*Generado por Architect (BMAD v6) · Sprint 7 · 2026-02-27*
