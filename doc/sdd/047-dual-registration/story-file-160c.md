# Story File — WAS-160c: Upgrade Modal + API + Mint via selfRegisterAgent

> SDD: doc/sdd/047-dual-registration/sdd.md
> Fecha: 2026-03-05
> Branch: feat/047-dual-registration
> Depende de: WAS-160a (schema), WAS-160g (contrato)

---

## Goal

Permitir que un agente registrado off-chain sea escalado a on-chain por su owner. UI modal con beneficios, estimado de gas, firma client-side de `selfRegisterAgent()`, y API backend que verifica receipt y actualiza DB.

## Acceptance Criteria (EARS)

1. WHEN el owner de un agente off-chain solicita upgrade a on-chain, THE sistema SHALL presentar un flujo de upgrade con: beneficios, estimado de gas, y confirmación de wallet. (AC5)
2. WHEN el owner confirma el upgrade y firma la transacción, THE sistema SHALL mintear el token ERC-8004 y asociar `token_id` + `chain_registered_at` al registro existente sin crear un nuevo UUID. (AC6)
3. IF la transacción de upgrade falla o es revertida, THEN THE sistema SHALL mantener el agente en estado off-chain sin modificaciones, mostrando error descriptivo al usuario. (AC7)
4. WHEN el owner inicia el upgrade, THE sistema SHALL mostrar estimado de gas en AVAX antes de solicitar firma. (AC10)
5. WHILE la transacción está pendiente, THE sistema SHALL mostrar estado "Upgrading..." con indicador de progreso. (AC11)

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/features/agents/components/UpgradeOnChainModal.tsx` | Crear | Modal: beneficios, gas estimate, balance AVAX, firma, polling receipt, estados | `ListingFeeModal.tsx` |
| 2 | `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts` | Crear | POST: auth JWT, CSRF, ownership, verify receipt on-chain, update DB | `status/route.ts` + patrón HAL-025 de WAS-141 |
| 3 | `src/app/[locale]/creator/agents/[slug]/page.tsx` (o detail page del creator) | Modificar | Agregar botón "Upgrade to On-chain" si `registration_type === 'off_chain'` | Botones existentes en la page |
| 4 | `messages/en.json` | Modificar | Agregar keys `agent.upgrade.*` | Keys existentes |
| 5 | `messages/es.json` | Modificar | Agregar keys `agent.upgrade.*` en español | Keys existentes |

## Exemplars

### Exemplar 1: ListingFeeModal.tsx
**Archivo**: `src/app/[locale]/publish/ListingFeeModal.tsx`
**Usar para**: Archivo #1
**Patrón clave**:
- Step machine: `confirm | signing | paying | done | error`
- `window.ethereum` check antes de firmar
- `useTranslations()` para i18n
- `useRouter()` para redirect post-success

### Exemplar 2: status/route.ts + WithdrawModal pattern (HAL-025)
**Archivo**: `src/app/api/creator/agents/[slug]/status/route.ts`
**Usar para**: Archivo #2
**Patrón clave**:
- `validateCsrf(req)`, `createClient()`, `auth.getUser()`, ownership check
- Zod validation del body
- Para receipt verification: `publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 })` + verificar `receipt.status === 'success'`

## Constraint Directives

### OBLIGATORIO
- Gas estimate via `estimateContractGas` de viem/publicClient (no hardcoded)
- Balance AVAX del creator via `publicClient.getBalance()`
- `selfRegisterAgent(slug, priceAtomics, 0n)` — creator firma client-side
- Backend verifica receipt ANTES de update DB (HAL-025)
- Update DB: `registration_type = 'on_chain'`, `on_chain_registered = true`, `chain_registered_at = NOW()`
- Si tx falla: NO modificar DB, mostrar error message extraído del error object
- Botón de upgrade SOLO visible si `registration_type === 'off_chain'` (AC9 de badge sub-HU)

### PROHIBIDO
- NO crear nuevo UUID al hacer upgrade
- NO usar operator server-side para el mint (creator firma)
- NO permitir upgrade si ya es on-chain
- NO agregar dependencias nuevas
- NO hardcodear direcciones de contrato ni ABI inline

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| Typecheck | Todos | TypeScript | type |
| Build | Todos | Next.js | integration |

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Verificar WAS-160a y WAS-160g mergeados
- [ ] W0.2: Leer `ListingFeeModal.tsx`, `status/route.ts`, página de agent detail del creator

### Wave 1 (Parallelizable)
- [ ] W1.1: Agregar i18n keys `agent.upgrade.*` → Archivos #4, #5
- [ ] W1.2: Crear API route `upgrade-onchain` → Archivo #2 → Exemplar 2

### Wave 2 (Depende de W1)
- [ ] W2.1: Crear `UpgradeOnChainModal.tsx` → Archivo #1 → Exemplar 1

### Wave 3 (Depende de W2)
- [ ] W3.1: Integrar botón + modal en agent detail page → Archivo #3

### Wave 4 (Verificación)
- [ ] W4.1: typecheck + build

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W1 | typecheck pasa |
| W2 | typecheck pasa |
| W3 | typecheck + build |
| W4 | full QA |

## Out of Scope

- Badge (WAS-160d)
- Discovery boost (WAS-160e)
- Publish flow changes (WAS-160b)
- Contrato (WAS-160g)
- Migration (WAS-160a)

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y pregunta a Architect.

---

*Story File generado por NexusAgil — F2.5*
