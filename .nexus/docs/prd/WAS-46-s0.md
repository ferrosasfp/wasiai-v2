---
id: WAS-46
title: "BUG: Botón Pay debe conectar wallet cuando no hay wallet conectada"
sprint: 7
epic: Epic 9 — UX Improvements
prioridad: P0
estimacion: XS
estado: PENDIENTE_HU_APPROVED
stepsCompleted: [S0]
---

# S0 — WAS-46: BUG — Botón Pay debe conectar wallet (P0)

## Historia de usuario

> Como usuario que quiere pagar por un agente, cuando hago clic en "Pay" sin tener una wallet conectada, quiero que el sistema me muestre el flujo de conexión de wallet automáticamente, para no perder el contexto de lo que estaba haciendo.

---

## Contexto técnico — El bug

Hoy `PayToCallButton.tsx` tiene un `handleConnect` que setea `showWalletModal=true`, pero el botón **"Pay"** principal ejecuta `pay()` directamente si `ctx.state === 'idle'`, **sin verificar si hay wallet conectada**. Resultado: si el usuario no tiene wallet, el botón no hace nada visible — ni error, ni modal, ni loading. El usuario queda bloqueado sin feedback.

---

## Acceptance Criteria

1. Cuando el usuario hace clic en "Pay" y `ctx.account` es `undefined` o `null`, el componente **muestra el modal de selección de wallet** (el `WalletConnectModal` creado en WAS-45) en lugar de ejecutar `pay()`.
2. Después de conectar la wallet exitosamente, el **flujo de pago continúa automáticamente** desde donde se interrumpió — el input del usuario está preservado.
3. El botón "Pay" **NUNCA ejecuta `pay()`** sin wallet conectada.
4. El estado del input del usuario (texto enviado) se **preserva** durante todo el flujo de conexión.
5. Si el usuario cierra el modal sin conectar, vuelve al **estado inicial** del botón (sin error, sin loading).
6. Test de aceptación manual: usuario sin wallet → clic Pay → conecta wallet → pago procede **sin acción extra del usuario**.

---

## Scope — Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `src/features/payments/components/PayToCallButton.tsx` | Modificar: antes de llamar `pay()`, verificar `ctx.account`; si es null, abrir `WalletConnectModal` |
| `src/features/payments/hooks/useWalletPayment.ts` | Verificar: `ctx.account` es accesible desde el hook para la condición de guarda |

**Archivos NO tocar:**
- `WalletConnectModal.tsx` — creado en WAS-45, se reutiliza tal cual
- DB, contratos, API — sin cambios

---

## Dependencias

- **Requiere:** WAS-45 (debe estar implementado primero — `WalletConnectModal` debe existir)
- **Habilita:** Conversión real de usuarios que llegan sin wallet

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Race condition: wagmi puede no exponer `account` inmediatamente post-connect | Media | Escuchar `onConnect` de wagmi y solo entonces ejecutar `pay()` automáticamente |
| Si WAS-45 se retrasa, WAS-46 queda bloqueada | Alta | Implementar WAS-45 primero (orden del sprint) |
| Input preservado: si el estado es local en el componente, puede perderse al re-render | Baja | Verificar que el estado de input está en `useState` persistente, no derivado |

---

## Estimación

**XS (Extra Small)** — ~2–3 horas de dev. Es una corrección de lógica en el handler del botón Pay, reutilizando el modal de WAS-45.

---

## Definition of Done

- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Test manual: usuario sin wallet → Pay → conecta → pago procede
- [ ] Test: cerrar modal sin conectar → botón vuelve a estado inicial
- [ ] Adversarial review completado antes del commit
- [ ] `git push origin master master:main`

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
*Sprint 7 — Wallet UX & Marketplace Polish*
