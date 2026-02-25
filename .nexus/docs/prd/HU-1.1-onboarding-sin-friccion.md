# HU-1.1 — Onboarding sin fricción para creators

> **Estado:** HU_APPROVED ✅
> **Linear:** WAS-5
> **Sprint:** 1 (25 Feb – 1 Mar 2026)
> **Épica:** 1 — Creators Reales

---

## Historia de Usuario

Como **creator nuevo** que quiere publicar su primer agente,
quiero poder registrarme con email, completar un wizard guiado y publicar mi agente sin necesitar wallet ni USDC en el momento,
para estar en el marketplace y recibir invocaciones el mismo día que descubro WasiAI.

---

## Criterios de Aceptación

- [ ] **AC1:** Un creator puede registrarse con email + contraseña y llegar a un wizard de 3 pasos: Perfil básico → Publicar agente → Configurar wallet (opcional)
- [ ] **AC2:** El paso "Configurar wallet" es claramente marcado como *opcional* y puede saltarse. El creator puede completarlo desde el dashboard en cualquier momento.
- [ ] **AC3:** Si el creator publica un agente sin wallet configurada, sus earnings se acumulan en `creator_profiles.pending_earnings_usdc` — visible en el dashboard con el mensaje "Configura tu wallet para retirar".
- [ ] **AC4:** Cuando el creator hace click en "Retirar", el endpoint `/api/creator/withdraw` suma `pending_earnings_usdc` + earnings on-chain y ejecuta el `withdrawFor` por el total.
- [ ] **AC5:** El wizard redirige al formulario de publicación existente en el paso 2 — no es un formulario nuevo, es el `/publish` actual dentro del wizard.
- [ ] **AC6:** El wizard tiene máximo 3 pantallas antes de que el agente quede publicado.
- [ ] **AC7:** Si el creator intenta retirar earnings sin wallet configurada, recibe un mensaje claro: "Necesitas configurar tu wallet para retirar" con CTA al setup.

---

## Scope

**IN:**
- Wizard post-registro de 3 pasos (Perfil → Publicar → Wallet)
- Campo `pending_earnings_usdc numeric(20,6)` en `creator_profiles` + lógica de acumulación
- `/api/creator/withdraw` actualizado: suma `pending_earnings_usdc` + earnings on-chain → `withdrawFor` por el total
- UI en dashboard: saldo pendiente + CTA "Configura tu wallet"
- Guard en endpoint de withdrawal si `wallet_address` IS NULL → 400 con mensaje claro
- Migration 015: agregar `pending_earnings_usdc` a `creator_profiles`

**OUT:**
- Google / GitHub OAuth (roadmap)
- Invocar agentes gratis sin saldo (HU-3.1)
- Email de bienvenida o notificaciones (HU-8.3)
- Cambiar el formulario `/publish` (HU-1.2)

---

## Notas del Analyst

- **Dependencias:** Migration 015 — `pending_earnings_usdc numeric(20,6) DEFAULT 0` en `creator_profiles`. El cron `settle-key-batches` debe acumular en este campo si `wallet_address IS NULL` en lugar de intentar on-chain.
- **Riesgo crítico:** El cron actual intenta `withdrawFor(creator_wallet)` — si `wallet_address` es null, fallará silenciosamente. Agregar guard ANTES del cron: `if (!creator.wallet_address) → acumular en pending_earnings_usdc`.
- **Riesgo de negocio:** Si el creator nunca configura wallet, los earnings quedan en DB indefinidamente. Política de reclamación → fuera de scope, roadmap.

---

*Aprobada por Fer — 2026-02-25*
