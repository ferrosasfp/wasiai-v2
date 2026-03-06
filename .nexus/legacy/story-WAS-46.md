# Story WAS-46: BUG — Botón Pay debe conectar wallet cuando no hay wallet conectada

**Status:** ready-for-dev  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P0 | **Estimación:** XS (~2–3 horas)  
**⚠️ BLOQUEANTE: Implementar DESPUÉS de WAS-45** — requiere `WalletConnectModal` creado en WAS-45.

---

## Historia de usuario

Como usuario que quiere pagar por un agente, cuando hago clic en "Pay" sin tener una wallet conectada, quiero que el sistema me muestre el flujo de conexión de wallet automáticamente, para no perder el contexto de lo que estaba haciendo.

---

## Acceptance Criteria

1. Cuando el usuario hace clic en "Pay" y no hay wallet conectada (`address` es `undefined`), el componente **muestra `WalletConnectModal`** (creado en WAS-45) en lugar de ejecutar `pay()`.
2. Después de conectar la wallet exitosamente, el **flujo de pago continúa automáticamente** — el usuario no necesita hacer clic en "Pay" de nuevo.
3. El botón "Pay" **NUNCA ejecuta `pay()`** sin wallet conectada.
4. El estado del input del usuario (texto enviado) se **preserva** durante todo el flujo de conexión.
5. Si el usuario cierra el modal sin conectar, vuelve al **estado inicial** del botón (sin error, sin loading).
6. Test de aceptación manual: usuario sin wallet → clic Pay → conecta wallet → pago procede **sin acción extra del usuario**.

---

## Dependencia crítica — WAS-45

Este story **requiere** que WAS-45 esté implementado y mergeado primero.

Desde WAS-45 se importa:
```typescript
import { WalletConnectModal } from './WalletConnectModal'
// Path: src/features/payments/components/WalletConnectModal.tsx
```

`WalletConnectModal` tiene esta interfaz:
```typescript
interface WalletConnectModalProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void  // ← callback que se usa en este story para ejecutar pay()
}
```

---

## Root cause del bug

En `PayToCallButton.tsx`, `isDisabled` NO incluye el estado `no_wallet`:

```typescript
// BUG: no_wallet no está en la lista de estados deshabilitados
const isDisabled =
  isProcessing                                        ||
  ctx.state === 'insufficient_balance'                ||
  ctx.state === 'wrong_network'                       ||
  (ctx.state === 'idle' && !input.trim())
  // ← FALTA: ctx.state === 'no_wallet'
```

Resultado: cuando no hay wallet, el botón NO está disabled → click → `pay()` → no hace nada visible → el usuario queda bloqueado sin feedback.

---

## Estructura de archivos

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---------|--------|
| `src/features/payments/components/PayToCallButton.tsx` | Cambios 1–6 descritos abajo |

### Archivos a VERIFICAR (sin cambios esperados):

| Archivo | Qué verificar |
|---------|---------------|
| `src/features/payments/hooks/useWalletPayment.ts` | Que `address` de `useAccount()` está disponible en el hook |

### Archivos NO tocar:
- `WalletConnectModal.tsx` — creado en WAS-45, se usa tal cual
- DB, contratos, API — sin cambios

---

## Cambios exactos en `PayToCallButton.tsx`

### Cambio 1: Agregar imports

```typescript
// AGREGAR estos imports:
import { WalletConnectModal } from './WalletConnectModal'  // de WAS-45
import { useAccount } from 'wagmi'
import { useRef } from 'react'  // si no está ya importado
```

### Cambio 2: Agregar hooks y ref en el componente

```typescript
// Agregar dentro del componente (junto a los hooks existentes):
const { address } = useAccount()
const pendingPayRef = useRef(false)
```

### Cambio 3: Agregar useEffect para pay automático post-conexión

```typescript
// Agregar después de los useState existentes:
useEffect(() => {
  if (address && pendingPayRef.current) {
    pendingPayRef.current = false
    pay()
  }
}, [address]) // eslint-disable-line react-hooks/exhaustive-deps
```

### Cambio 4: Reemplazar `onClick={pay}` por `onClick={handlePayClick}`

```typescript
// AGREGAR estas funciones:
function handlePayClick() {
  // Si no hay wallet → abrir modal en lugar de intentar pagar
  if (!address) {
    setShowWalletModal(true)
    return
  }
  pay()
}

function handleWalletConnected() {
  // pay() se ejecutará via useEffect cuando address esté disponible
  pendingPayRef.current = true
}
```

### Cambio 5: En el JSX — reemplazar modal inline por WalletConnectModal

Eliminar el bloque JSX del modal inline (buscar el bloque con `showWalletModal && <div className="fixed inset-0 z-50 ...`):

```tsx
{/* ELIMINAR este bloque completo: */}
{showWalletModal && (
  <div className="fixed inset-0 z-50 ...">
    {/* contenido del modal inline */}
  </div>
)}

{/* REEMPLAZAR POR: */}
<WalletConnectModal
  open={showWalletModal}
  onClose={() => setShowWalletModal(false)}
  onConnected={handleWalletConnected}
/>
```

### Cambio 6: En el botón CTA — cambiar onClick

```tsx
{/* ANTES: */}
<button
  onClick={pay}
  disabled={isDisabled}
  ...
>

{/* DESPUÉS: */}
<button
  onClick={handlePayClick}
  disabled={isDisabled}
  ...
>
```

### Cambio 7: Limpiar imports huérfanos

Con el modal extraído, ya NO se usan en `PayToCallButton`:
- `useConnect` → eliminar del import wagmi
- `useConnectors` → eliminar del import wagmi

```typescript
// ANTES:
import { useConnect, useDisconnect, useConnectors } from 'wagmi'

// DESPUÉS (eliminar useConnect y useConnectors):
import { useDisconnect } from 'wagmi'
// useAccount se importa por separado (Cambio 1)
```

**Mantener:** `useDisconnect` (sigue siendo necesario para `handleDisconnect` existente en PayToCallButton).

---

## Flujo completo post-fix

```
Usuario en ficha de agente, SIN wallet conectada
  ↓
Escribe texto en input → Click "Pagar $X USDC"
  ↓
handlePayClick() → !address → setShowWalletModal(true)
  ↓
WalletConnectModal abre (overlay oscuro, z-50)
  ↓
[Caso A: usuario conecta wallet]
  → connect({ connector }) → modal cierra → handleWalletConnected()
  → pendingPayRef.current = true
  → useEffect detecta: address cambió de undefined → defined
  → pendingPayRef.current === true → pay() ejecuta automáticamente
  → Flujo normal de pago x402 continúa ✓
  → Input preservado (useState local no se tocó) ✓

[Caso B: usuario cierra modal sin conectar]
  → onClose() → showWalletModal = false
  → pendingPayRef.current sigue false
  → Botón vuelve a estado "Pagar $X USDC" sin error ✓
  → Input preservado ✓
```

---

## Preservación del input (AC #4)

El `input` es un `useState` en `PayToCallButton`. Durante el flujo de conexión:
- El componente **NO se desmonta** — solo cambia `showWalletModal`
- `pendingPayRef.current` usa closure sobre `pay()` que usa closure sobre `input`
- Garantía: input se preserva en todos los casos.

---

## Notas de implementación

### Por qué useEffect + useRef (no setTimeout)
El setTimeout(300ms) para esperar que wagmi propague `address` es frágil. El patrón con `useRef` + `useEffect` es determinístico: `pay()` se ejecuta exactamente cuando `address` está disponible, sin importar cuánto tarde.

### Estado `showWalletModal` ya existe
Buscar en `PayToCallButton.tsx`:
```typescript
const [showWalletModal, setShowWalletModal] = useState(false)
```
Este state **ya existe** — solo cambia qué componente lo renderiza (antes: modal inline, ahora: `WalletConnectModal`).

### `handleConnect` existente
Puede existir una función `handleConnect` en `PayToCallButton` que setea `showWalletModal=true`. Con este fix, esa función puede mantenerse o eliminarse — lo que importa es que `handlePayClick` abra el modal cuando `!address`.

### Verificar `useWalletPayment.ts`
Confirmar que el hook retorna `address` o que `ctx.address` es accesible. Si no está expuesto, usar `useAccount()` directamente en el componente (ya está en el Cambio 1).

---

## DoD — Definition of Done

- [ ] Click en "Pay" sin wallet → abre `WalletConnectModal` (no silencioso)
- [ ] Post-conexión → `pay()` ejecuta automáticamente sin acción extra del usuario
- [ ] Cerrar modal sin conectar → botón en estado inicial, sin error, sin loading
- [ ] Input del usuario preservado durante todo el flujo
- [ ] Modal inline eliminado de `PayToCallButton` (usa `WalletConnectModal` de WAS-45)
- [ ] `useConnect` y `useConnectors` eliminados de imports de `PayToCallButton`
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Test manual: sin wallet → Pay → conecta → pago procede sin acción extra
- [ ] Test manual: cerrar modal → botón vuelve a estado inicial
- [ ] Adversarial review completado antes del commit
- [ ] `git push origin master master:main`

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
_(completar al implementar)_

### File List
- `src/features/payments/components/PayToCallButton.tsx` — MODIFICADO
