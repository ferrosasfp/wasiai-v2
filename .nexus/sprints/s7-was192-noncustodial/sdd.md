# SDD #S7-05: WAS-192 — Claridad non-custodial en landing y onboarding

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: improvement
> SDD_MODE: mini
> Branch: feat/s7-05-noncustodial-copy

## 1. Resumen
WasiAI nunca custodia fondos de usuarios — los pagos son firmados directamente por el wallet del usuario vía EIP-3009. Pero esto no se comunica en ningún lugar visible. Usuarios asumen que WasiAI guarda su dinero como un banco. Esta HU añade mensajes claros de "non-custodial" en landing, onboarding y página de pago.

## 2. Work Item
| Campo | Valor |
|-------|-------|
| **#** | S7-05 / WAS-192 |
| **Tipo** | improvement (copy + UI mínimo) |
| **Scope IN** | Landing page, onboarding flow, i18n (en + es) |
| **Scope OUT** | Cambios de backend, smart contracts, docs técnicos |

## 3. Context Map

### Exemplars
| Para modificar | Seguir patrón de |
|---------------|-----------------|
| i18n strings | `messages/en.json` + `messages/es.json` — patrón existente |
| Componente badge | Componentes existentes en `src/components/` o `src/features/` |

### Archivos a explorar (Builder debe leer)
- `src/app/[locale]/page.tsx` — landing principal
- `src/app/[locale]/(auth)/` — onboarding/signup
- `messages/en.json` — i18n existente
- Buscar `PayToCallButton` o similar — donde se inicia el pago

## 4. Archivos afectados
| Archivo | Acción | Qué cambia |
|---------|--------|-----------|
| `messages/en.json` | Modificar | Añadir namespace `nonCustodial.*` |
| `messages/es.json` | Modificar | Mismo en español |
| Landing page | Modificar | Añadir badge/callout "Non-custodial · You control your funds" |
| Onboarding/connect wallet | Modificar | Añadir tooltip o nota explicativa |

## 5. Copy exacto

**Badge corto (landing hero):**
- EN: "Non-custodial · Your wallet, your funds"
- ES: "No custodial · Tu wallet, tus fondos"

**Tooltip en paso de pago:**
- EN: "WasiAI never holds your funds. You sign payments directly with your wallet — we never have access to your USDC."
- ES: "WasiAI nunca custodia tus fondos. Firmas los pagos directamente con tu wallet — nunca tenemos acceso a tu USDC."

**Nota en onboarding (primer uso):**
- EN: "How payments work: You sign with your wallet → USDC moves directly to the agent creator → WasiAI takes a small fee. Your keys, your money."
- ES: "Cómo funcionan los pagos: Firmas con tu wallet → el USDC va directo al creador → WasiAI cobra una pequeña comisión. Tus llaves, tu dinero."

## 6. Acceptance Criteria (EARS)
1. WHEN a user visits the landing page, THE page SHALL display the non-custodial badge visibly in the hero section.
2. WHEN a user reaches the payment step, THE UI SHALL show the non-custodial tooltip explaining the flow.
3. WHEN `locale = 'es'`, THE copy SHALL be in Spanish.
4. WHEN `locale = 'en'`, THE copy SHALL be in English.

## 7. Constraint Directives
### PROHIBIDO
- NO modificar lógica de backend
- NO crear componentes nuevos si hay uno reutilizable (badge, tooltip)
- NO inventar copy — usar exactamente el texto de la sección 5

---
*SDD — MINI | Sprint 7*
