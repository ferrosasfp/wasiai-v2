# AUDIT PROGRESS LOG
**Started:** 2026-02-23
**Completed:** 2026-02-23
**Final build:** ✅ PASS — all 30 routes compile, no errors

---

## FASE 1 — Quick Wins + Críticos ✅ COMPLETE

- [x] **S-01**: `next.config.mjs` — CSP: `unsafe-eval`/`unsafe-inline` condicionado a `NODE_ENV === 'development'`
- [x] **T-03**: `src/lib/env.ts` — Zod schema completo para todas las env vars. `src/lib/supabase/server.ts` actualizado para usar `env.*`
- [x] **P-01**: `dashboard/page.tsx` — queries paralizadas con `Promise.all()`. Earnings extraídas a Suspense (A-02 aplicado aquí también)
- [x] **P-03**: `ModelCard.tsx` — envuelto en `React.memo()`
- [x] **P-04**: `ModelCard.tsx` — `sizes="40px"` y `priority={index < 3}` en Image; `index` prop desde homepage
- [x] **P-08**: `WasiNavBar.tsx` — `useMemo` en NAV_LINKS
- [x] **P-09/10/11**: Cache times — `s-maxage=300, stale-while-revalidate=600` en APIs, `revalidate=300` en homepage
- [x] **S-11**: `parseInt` con radix 10 en `api/v1/models/route.ts` y `api/v1/agents/route.ts`
- [x] **T-18**: Todos los `/en/login` hardcodeados en WasiNavBar → locale-aware (`/${locale}/login`)
- [x] **S-10**: Debug info en error responses condicionado a `NODE_ENV === 'development'` (invoke route)
- [x] **T-06**: `supabase/server.ts` — empty catch documentado con comentario explicativo
- [x] **T-08**: `chain.ts` — `CHAIN_NETWORKS` tipado con `as const` en lugar de `any[]`
- [x] **T-22**: Alt text y ARIA labels en WasiNavBar (aria-label, aria-current, aria-expanded, aria-controls, aria-hidden)
- [x] **T-33**: Null check en `subscription?.unsubscribe()` en WasiNavBar

---

## FASE 2 — Seguridad + Performance ✅ COMPLETE

- [x] **S-02**: `src/lib/security/csrf.ts` con `validateCsrf()`. Aplicado en:
  - `api/creator/wallet/route.ts`
  - `api/agent-keys/route.ts` (POST + DELETE)
  - `api/models/route.ts`
- [x] **S-03**: `src/lib/schemas/api.schemas.ts` con `paginationSchema` y `mcpRequestSchema`. Aplicado en MCP route
- [x] **T-01**: `supabase/migrations/0009_create_user_files.sql` creado. `src/actions/storage.ts` actualizado con ownership check completo (enqueue on upload, check ownership on delete)
- [x] **T-04**: `src/hooks/useAuth.ts` — `.catch()` y `.finally()` agregados
- [x] **T-05**: `src/app/[locale]/agent-keys/page.tsx` — `handleRevoke` envuelto en try/catch/finally
- [x] **P-02**: `invoke/route.ts` — `Promise.all([lookupModel, lookupKey])` aplicado
- [x] **P-06**: `src/app/[locale]/publish/page.tsx` — dynamic import con loading skeleton
- [x] **A-04**: `src/app/[locale]/(auth)/error.tsx` creado
- [x] **T-06**: Documentado (ya hecho en Fase 1)
- [x] **T-08**: Documentado (ya hecho en Fase 1)
- [x] **P-09**: Cache `s-maxage=300, stale-while-revalidate=600` en `api/v1/agents/route.ts`
- [x] **P-11**: Cache `private, max-age=30` en `api/agent-keys/route.ts`

---

## FASE 3 — Arquitectura + Polish ✅ COMPLETE

- [x] **A-07**: `src/lib/schemas/model.schema.ts` creado. PublishForm y `api/models/route.ts` usan el schema compartido
- [x] **T-10**: `src/types/api.types.ts` — `ApiSuccess<T>`, `ApiError`, `ok()`, `fail()`, `paginated()`
- [x] **T-11**: `src/hooks/useFileUpload.ts` — hook extraído. Integrado en PublishForm
- [x] **T-12**: Tipos inline actualizados para usar tipos compartidos (ModelCapability, CreateModelDraft)
- [x] **T-17**: `src/components/ErrorBoundary.tsx` creado. PayToCallButton envuelto en ModelCallSection
- [x] **T-19**: `src/components/ErrorMessage.tsx` creado con ErrorMessage, FormErrorMessage, AlertErrorMessage
- [x] **T-22**: Documentado (hecho en Fase 1)
- [x] **A-05**: `ConnectWallet.tsx` — valida chain ID y muestra `WrongNetworkBanner` cuando está en red incorrecta
- [x] **A-06**: `PayToCallButton.tsx` — valida `payTo` con `isAddress()` y valida `connectedChain.id` antes de firmar
- [x] **T-14**: `src/constants/config.ts` — magic numbers centralizados (USDC_MULTIPLIER, PAYMENT_TIMEOUT_SECONDS, UPSTREAM_TIMEOUT_MS, etc.)
- [x] **S-08**: `src/lib/logger.ts` creado. Reemplazados `console.log/error/warn` en:
  - `invoke/route.ts`
  - `marketplaceClient.ts`
  - `usdcSettler.ts`
- [x] **A-01**: `invoke/route.ts` — funciones extraídas: `build402Instructions()`, `settleX402()`, `recordOnChain()`. POST handler ahora usa estas funciones
- [x] **A-02**: Dashboard extraído — `EarningsSection` en `_components/EarningsSection.tsx` con Suspense + skeleton fallback
- [x] **T-15/16**: n/a — strings en WasiNavBar y auth forms ya usan next-intl translations o son estables
- [x] **T-20**: `src/app/global-error.tsx` — ya existía, no se modificó
- [x] **A-12**: `src/actions/wallet.ts` — usa `isAddress()` de viem en lugar de regex
- [x] **P-12**: `useContractRead.ts` — `argsKey` ahora es `useMemo()` para evitar `JSON.stringify` en cada render
- [x] **T-33**: Documentado (hecho en Fase 1)
- [x] **T-28**: `LoginForm.tsx` ya usaba `Link` de `@/i18n/navigation` (locale-aware), no requería cambio

---

## FASE 4 — Backlog ✅ COMPLETE

- [x] **T-07**: `supabase/migrations/0010_create_pending_recordings.sql` creado. `src/lib/chain/pendingRecordings.ts` con `enqueuePendingRecording()` y `processPendingRecordings()` con backoff exponencial (5m→20m→80m→320m→1280m). `invoke/route.ts` actualizado para enqueue on failure. `src/app/api/cron/retry-recordings/route.ts` creado como endpoint para Vercel Cron (cada 10min)
- [⚠️] **P-07**: **SKIP — riesgo alto, documentado abajo**

---

## NOTAS / SKIPS

### P-07: Web3Provider route group (skip)
**Razón:** Mover el Web3Provider a un route group `(web3)` requiere mover físicamente muchos directorios de páginas (`wallet/`, `publish/`, `models/[slug]/`, `creator/dashboard/`, `contracts/`). Esto rompe rutas existentes, requiere actualizar todos los links, y tiene un riesgo muy alto de regresión. **El beneficio** (reducir ~30KB del bundle en rutas sin Web3) no justifica el riesgo en este contexto. Dejar para una PR dedicada con pruebas de integración.

### Zod v4 compatibility
El proyecto usa Zod v4 (`^4.3.6`). Se detectó y corrigió el breaking change: `errorMap` → `error` en `z.enum()` params.

### golden path — NO MODIFICADO
La lógica de pagos (`probe → sign EIP-712 → pay USDC → invoke → record → earnings → withdraw`) NO fue modificada. Solo se refactorizó la estructura del código (extracción de helpers, parallelización de lookups) sin cambiar el flujo lógico.

---

## FILES CREATED/MODIFIED

### New files:
- `src/lib/env.ts` — centralized env validation
- `src/lib/security/csrf.ts` — CSRF origin validation
- `src/lib/schemas/api.schemas.ts` — shared API schemas
- `src/lib/schemas/model.schema.ts` — shared model schema
- `src/lib/logger.ts` — structured logger
- `src/lib/chain/pendingRecordings.ts` — retry logic
- `src/types/api.types.ts` — API response types
- `src/constants/config.ts` — magic numbers
- `src/hooks/useFileUpload.ts` — file upload hook
- `src/components/ErrorBoundary.tsx` — error boundary
- `src/components/ErrorMessage.tsx` — reusable error display
- `src/app/[locale]/(auth)/error.tsx` — auth route error boundary
- `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` — async sub-component
- `src/app/api/cron/retry-recordings/route.ts` — cron endpoint
- `supabase/migrations/0009_create_user_files.sql` — file ownership table
- `supabase/migrations/0010_create_pending_recordings.sql` — retry queue table

### Modified files (key changes):
- `next.config.mjs` — CSP conditional on dev
- `src/lib/supabase/server.ts` — uses env.ts, documented empty catch
- `src/lib/chain.ts` — as const instead of any[]
- `src/lib/contracts/marketplaceClient.ts` — logger, retry enqueue
- `src/lib/contracts/usdcSettler.ts` — logger
- `src/components/WasiNavBar.tsx` — useMemo, locale-aware links, ARIA
- `src/features/models/components/ModelCard.tsx` — React.memo, Image optimization
- `src/features/wallet/components/ConnectWallet.tsx` — chain validation + WrongNetworkBanner
- `src/features/payments/components/PayToCallButton.tsx` — isAddress + chain validation
- `src/features/models/components/ModelCallSection.tsx` — ErrorBoundary wrapper
- `src/app/[locale]/creator/dashboard/page.tsx` — Suspense, optimized queries
- `src/app/[locale]/publish/page.tsx` — dynamic import
- `src/app/[locale]/publish/PublishForm.tsx` — shared schema, useFileUpload
- `src/app/[locale]/agent-keys/page.tsx` — try/catch in handleRevoke
- `src/app/api/v1/models/[slug]/invoke/route.ts` — helpers extracted, retry enqueue
- `src/app/api/v1/models/route.ts` — parseInt radix, cache headers
- `src/app/api/v1/agents/route.ts` — cache headers
- `src/app/api/v1/mcp/route.ts` — Zod input validation
- `src/app/api/models/route.ts` — CSRF, shared schema
- `src/app/api/agent-keys/route.ts` — CSRF, cache headers
- `src/app/api/creator/wallet/route.ts` — CSRF
- `src/actions/storage.ts` — ownership tracking
- `src/actions/wallet.ts` — viem isAddress()
- `src/hooks/useAuth.ts` — .catch()/.finally()
- `src/hooks/useContractRead.ts` — P-12 fix
