# Story File — WAS-160b: Publish Flow — 3 Paths según Wallet

> SDD: doc/sdd/047-dual-registration/sdd.md
> Fecha: 2026-03-05
> Branch: feat/047-dual-registration
> Depende de: WAS-160a (schema), WAS-160g (contrato), WAS-158 (Pinata→Supabase)

---

## Goal

Refactorizar el flujo de publicación para que el path de registro dependa del contexto de wallet: sin wallet → off-chain automático, con wallet → elige on-chain u off-chain, AgentKit API → on-chain sugerido. El creator firma `selfRegisterAgent()` client-side cuando elige on-chain.

## Acceptance Criteria (EARS)

1. WHEN un creator sin wallet conectada publica un agente, THE sistema SHALL registrarlo off-chain (solo Supabase) automáticamente, sin solicitar transacción blockchain.
2. WHEN un creator con wallet conectada publica un agente, THE sistema SHALL presentar la opción de registrar on-chain (gas fee) u off-chain (gratis), permitiendo elegir.
3. WHEN un agente con AgentKit wallet se registra vía API, THE sistema SHALL sugerir registro on-chain como default, con opción de elegir off-chain.
4. WHILE un agente está registrado solo off-chain, THE sistema SHALL permitir funcionalidad completa: discovery, invocación, pagos, keys, edición.

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/app/[locale]/publish/PublishForm.tsx` | Modificar | Detectar wallet via `useAccount()`, mostrar RegistrationChoiceModal si wallet conectada, call `selfRegisterAgent` client-side si elige on-chain | `ListingFeeModal.tsx` |
| 2 | `src/app/[locale]/publish/RegistrationChoiceModal.tsx` | Crear | Modal con 2 opciones: on-chain (gas) / off-chain (free) + gas estimate | `ListingFeeModal.tsx` |
| 3 | `src/app/api/creator/agents/[slug]/status/route.ts` | Modificar | Aceptar `registration_type` en body, condicionar `registerAgentOnChain()` solo si NO viene ya on-chain del client | `status/route.ts` (mismo archivo) |
| 4 | `src/app/api/v1/agents/register/route.ts` | Modificar | Agregar `register_on_chain` optional al schema, condicionar registro on-chain | Mismo archivo |
| 5 | `src/features/models/types/models.types.ts` | Modificar | Agregar `RegistrationType`, `token_id`, `chain_registered_at` al tipo Agent | Mismo archivo |
| 6 | `src/lib/contracts/WasiAIMarketplace.ts` | Modificar | Agregar ABI de `selfRegisterAgent` al array | Mismo archivo |
| 7 | `messages/en.json` | Modificar | Agregar keys `publish.registrationChoice.*` | Keys existentes en `publish.*` |
| 8 | `messages/es.json` | Modificar | Agregar keys `publish.registrationChoice.*` en español | Keys existentes en `publish.*` |

## Exemplars

### Exemplar 1: ListingFeeModal.tsx
**Archivo**: `src/app/[locale]/publish/ListingFeeModal.tsx`
**Usar para**: Archivos #1, #2
**Patrón clave**:
- `'use client'` + `useState` para step machine (`confirm | signing | paying | done | error`)
- Detección wallet: `window.ethereum`
- `useTranslations('publish')` para i18n
- Props: `slug, onCancel, locale`

### Exemplar 2: status/route.ts
**Archivo**: `src/app/api/creator/agents/[slug]/status/route.ts`
**Usar para**: Archivo #3
**Patrón clave**:
- `validateCsrf(req)` primero
- `createClient()` + `auth.getUser()` para auth
- `createServiceClient()` para writes
- Ownership check: `existing.creator_id !== user.id`
- `registerAgentOnChain()` fire-and-forget con `.catch()`

### Exemplar 3: register/route.ts
**Archivo**: `src/app/api/v1/agents/register/route.ts`
**Usar para**: Archivo #4
**Patrón clave**:
- Zod schema con `.optional()` y `.default()`
- Multi-auth (JWT/agent-key/open)
- `registerAgentOnChain()` condicional al final

## Constraint Directives

### OBLIGATORIO
- Detectar wallet con `useAccount()` de wagmi (ya importado en el proyecto)
- `selfRegisterAgent()` client-side via wagmi `useWriteContract` — creator firma y paga gas
- Backend verifica receipt on-chain antes de marcar `registration_type = 'on_chain'` (HAL-025)
- Status route: aceptar `registration_type` en Zod schema (optional)
- Register API: `register_on_chain` optional, default `?? !!data.creator_wallet`
- i18n: keys en EN y ES simétricos

### PROHIBIDO
- NO usar `registerAgentOnChain()` server-side para humanos con wallet (es client-side ahora)
- NO romper el flujo de listing fee (WAS-131) — RegistrationChoiceModal se muestra DESPUÉS del fee gate
- NO eliminar el campo `on_chain_registered` del tipo Agent (mantener retrocompat)
- NO agregar dependencias nuevas
- NO hardcodear ABI — importar de `WasiAIMarketplace.ts`
- NO modificar archivos fuera de esta tabla

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| Typecheck (`npx tsc --noEmit`) | Todos | TypeScript | type |
| Build (`npm run build`) | Todos | Next.js | integration |

### Criterio Test-First

| Tipo de cambio | Test-first? |
|----------------|-------------|
| API route logic | Sí (si hay tests existentes) |
| Modal UI | No |
| Types | No |
| i18n keys | No |

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Verificar que WAS-160a (migration) y WAS-160g (contrato) están mergeados
- [ ] W0.2: Leer `ListingFeeModal.tsx`, `PublishForm.tsx`, `status/route.ts`, `register/route.ts`

### Wave 1 (Parallelizable)
- [ ] W1.1: Actualizar types en `models.types.ts` → Archivo #5
- [ ] W1.2: Agregar ABI `selfRegisterAgent` en `WasiAIMarketplace.ts` → Archivo #6
- [ ] W1.3: Agregar i18n keys → Archivos #7, #8

### Wave 2 (Depende de W1)
- [ ] W2.1: Crear `RegistrationChoiceModal.tsx` → Archivo #2 → Exemplar 1
- [ ] W2.2: Modificar `status/route.ts` → Archivo #3 → Exemplar 2
- [ ] W2.3: Modificar `register/route.ts` → Archivo #4 → Exemplar 3

### Wave 3 (Depende de W2)
- [ ] W3.1: Modificar `PublishForm.tsx` — integrar wallet detection + RegistrationChoiceModal → Archivo #1

### Wave 4 (Verificación)
- [ ] W4.1: `npx tsc --noEmit` — typecheck
- [ ] W4.2: `npm run build` — build limpio

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | Contexto entendido |
| W1 | typecheck pasa |
| W2 | typecheck pasa |
| W3 | typecheck + build pasan |
| W4 | full QA |

## Out of Scope

- Badge on-chain (WAS-160d)
- Upgrade modal (WAS-160c)
- Discovery boost (WAS-160e)
- Contrato (WAS-160g)
- Migration (WAS-160a)

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y pregunta a Architect.

---

*Story File generado por NexusAgil — F2.5*
