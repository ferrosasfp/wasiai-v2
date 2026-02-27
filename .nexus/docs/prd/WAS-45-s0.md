---
id: WAS-45
title: Wallet connect/disconnect en WasiNavBar (estándar dApp)
sprint: 7
epic: Epic 9 — UX Improvements
prioridad: P1
estimacion: S
estado: PENDIENTE_HU_APPROVED
stepsCompleted: [S0]
---

# S0 — WAS-45: Wallet connect/disconnect en WasiNavBar

## Historia de usuario

> Como usuario de WasiAI, quiero ver mi wallet conectada en la navbar con opción de desconectar, siguiendo el estándar de dApp, para saber en todo momento mi estado de conexión sin ir a la ficha de un agente.

---

## Contexto técnico

Hoy el único lugar donde se puede conectar una wallet es el `PayToCallButton` en la ficha de un agente. La navbar no tiene ningún indicador de wallet ni botón de conexión. El flujo de conexión y el modal deben extraerse como componentes reutilizables que WAS-46 también reutilizará.

---

## Acceptance Criteria

1. La navbar muestra un botón **"Connect Wallet"** cuando no hay wallet conectada.
2. Al hacer clic en "Connect Wallet", se abre un modal con los connectors disponibles (deduplicados, sin "Injected" expuesto como opción raw).
3. Cuando hay wallet conectada, el botón muestra la **dirección truncada** (ej. `0x1234...abcd`) junto con un indicador visual de red activa.
4. Al hacer clic en la dirección truncada, aparece un **dropdown** con la opción "Disconnect".
5. Al desconectar, el botón vuelve a mostrar "Connect Wallet" sin recargar la página.
6. El **estado de wallet es global** via wagmi — `PayToCallButton` y cualquier otro componente detectan el cambio automáticamente sin estado local duplicado.
7. En **mobile** (hamburger menu), el botón de wallet aparece como ítem del menú.
8. Si la wallet está en **red incorrecta**, mostrar indicador visual (badge de advertencia) sin bloquear la navegación.

---

## Scope — Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `src/components/WasiNavBar.tsx` | Modificar: integrar `WalletButton` |
| `src/features/payments/components/WalletConnectButton.tsx` | **Crear**: botón con dropdown estado conectado/desconectado |
| `src/features/payments/components/WalletConnectModal.tsx` | **Crear**: modal de connectors (extraer lógica de `PayToCallButton.tsx`) |
| `src/messages/en.json` | Agregar claves i18n para wallet UI |
| `src/messages/es.json` | Agregar claves i18n para wallet UI |

**Archivos NO tocar:**
- Contrato, ABIs, viem, Supabase — sin cambios
- `PayToCallButton.tsx` en esta HU (WAS-46 lo toca)

---

## Dependencias

- **Requiere:** Nada (wagmi ya está configurado en el proyecto)
- **Habilita:** WAS-46 (reutiliza `WalletConnectModal` creado aquí)

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| wagmi hooks son client-only → SSR error | Alta | Marcar `WasiNavBar` o el componente hijo con `'use client'`, o usar dynamic import con `ssr: false` |
| Modal duplicado si `PayToCallButton` tiene su propio modal local | Media | Asegurar que `WalletConnectModal` es el único modal de conexión; `PayToCallButton` lo reutiliza (WAS-46) |
| Deduplicación de connectors: "Injected" puede aparecer como Rabby y MetaMask a la vez | Baja | Filtrar por `id` único del connector en el listado |

---

## Estimación

**S (Small)** — ~1 día de dev. Requiere crear 2 componentes nuevos + modificar navbar + i18n. Sin cambios de backend ni DB.

---

## Definition of Done

- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Wallet visible en navbar en todas las páginas
- [ ] Estado compartido globalmente (wagmi) — sin estado local duplicado
- [ ] Traducciones en `en.json` / `es.json`
- [ ] Adversarial review completado antes del commit
- [ ] `git push origin master master:main`

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
*Sprint 7 — Wallet UX & Marketplace Polish*
