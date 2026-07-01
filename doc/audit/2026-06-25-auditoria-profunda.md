# Auditoría profunda de ingeniería — wasiai-v2

**Fecha:** 2026-06-25
**Alcance:** todo `src/` (377 archivos, ~44k LOC; 48 archivos de test, 475 tests).
**Método:** 4 auditores paralelos (arquitectura/TS, seguridad money-path, correctitud de negocio, testing) + verificación manual de los hallazgos CRÍTICA/ALTA. Toda cita es archivo:línea verificada.
**Stack:** Next.js 15 (App Router) · TypeScript strict · Supabase · viem/wagmi · contratos on-chain (WasiAIMarketplace) · x402 · Upstash Redis.

---

## 0. Baseline objetivo (medido)

| Métrica | Resultado |
|---|---|
| `tsc --noEmit` (strict) | ✅ 0 errores |
| Test suite | ✅ 475 pass · 1 skip · 0 fail |
| Coverage | ❌ **No medible** — falta `@vitest/coverage-v8` (nunca se midió) |
| tsconfig | `strict:true` sin flags extra (faltan `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |

---

## 1. Veredicto ejecutivo

**wasiai-v2 está bien construido en fundamentos (layering limpio, `any` casi nulo, env type-safe con zod, sin secrets en cliente, defensas EIP-3009/IDOR/SSRF maduras), pero a diferencia de wasiai-a2a tiene defectos de correctitud REALES en el money-path — algunos con pérdida de fondos.** No es código malo; es código bueno con bugs serios concentrados en el flujo de cobro/settlement.

**El hallazgo más grave (confirmado por DOS auditores independientes):** el settler interno `usdcSettler.ts` no valida que el destinatario del pago EIP-3009 (`auth.to`) sea el contrato del marketplace → un pago firmado a una wallet arbitraria pasa como "settled" y el caller recibe servicio gratis + WasiAI paga el gas. En prod el facilitator externo cubre el check, pero el path interno-baseline no tiene defensa en profundidad.

| Dimensión | Nota | Resumen |
|---|---|---|
| Arquitectura / capas | A− | Layering impecable; deuda en god-files + sin helper de error unificado |
| TypeScript idiomático | A | `any` ≈ 0 (1 en 44k LOC); faltan flags strict extra |
| Seguridad money-path | **B** | EIP-3009/IDOR/admin sólidos; pero DNS-rebinding que filtra credenciales + registro fail-open |
| Correctitud de negocio | **C+** | 1 fund-loss + order-bug de billing + floats USDC en todo el pipeline |
| Testing | **C** | Money-path central sin tests reales; coverage nunca medido |

---

## 2. Hallazgos consolidados (priorizados)

### 🔴 CRÍTICA / ALTA — money-path, corregir

| # | archivo:línea | Problema | Fix |
|---|---|---|---|
| V1 | `lib/contracts/usdcSettler.ts:140-253` | **El settler no valida `auth.to === payTo`/contrato.** Verifica firma + `value >= required` + timing, pero ejecuta `transferWithAuthorization(from, auth.to, ...)` (`:173,244`) con el `to` que venga firmado. Un caller firma un EIP-3009 con `to = su wallet`, lo manda como X-PAYMENT → verified+settled true, el USDC NO va al contrato, pero `handleInvoke` lo cuenta como pago, llama upstream e incrementa earnings. **Servicio gratis + gas regalado.** Confirmado por 2 auditores. (En prod el facilitator externo valida payTo; el baseline interno no.) | Pasar `payTo` a `settlePaymentDirectly`/`trySettle` y validar `auth.to.toLowerCase() === payTo.toLowerCase()` antes del settle. `listing-fee-pay/route.ts:48` ya hace este check — prueba de que falta acá. |
| V2 | `lib/invoke/handleInvoke.ts:355-403` | **Route A: orden invertido.** `logCall` (`:358`) → `signReceipt` (`:365`) → `check_and_deduct_budget` (`:395`). Si el débito devuelve `false` (concurrencia drenó el budget), `:401` solo loguea un warning y sigue → se devuelve `buildResponse` con `charged` y un **receipt firmado de un cobro que no ocurrió**. Divergencia entre `spent_usdc`, el receipt y el settlement on-chain. | Mover `check_and_deduct_budget` ANTES de logCall/signReceipt/buildResponse. Si `false` → 402 sin loguear cobro ni firmar receipt. |
| V3 | `lib/invoke/handleInvoke.ts:634,650-656` + `agents/[slug]/introspect/route.ts:146,155-161` | **DNS-rebinding TOCTOU que filtra credenciales.** Se valida la IP del `endpoint_url` pero `fetch(url)` re-resuelve DNS al conectar. Un agente con DNS de TTL bajo devuelve IP pública en validación y `127.0.0.1`/`169.254.169.254` en el fetch → el request manda `Authorization: Bearer ${webhook_secret}` al host interno/atacante. | Conectar a la IP ya validada fijando Host/SNI al hostname (patrón `health-probe.ts` que sí pinea), o agente con DNS pineado. |
| V4 | `overhead.ts`, `handleInvoke.ts:127,235`, `runSettlement.ts:206,246`, `voucher/route.ts:50`, `withdraw/route.ts:140` | **Montos USDC como `number` (float) en todo el pipeline.** USDC es 6-dec → debería ser BigInt atómico. `amounts.reduce((a,b)=>a+b)` + `amount*feeBps/10_000` + `Math.round(pending*1e6)` acumulan error binario → desincroniza earnings off-chain vs escrow on-chain → dispara `KEY_BALANCE_MISMATCH` (`runSettlement:275`). Las columnas DB ya son `numeric(20,6)`; el cómputo en JS las degrada. | BigInt de unidades atómicas como tipo canónico end-to-end; float solo para display. |

### 🟠 MEDIA — planificar

| # | archivo:línea | Problema | Fix |
|---|---|---|---|
| V5 | `agents/register/route.ts:279-281` | **Registro fail-open:** sin `OPEN_REGISTRATION_KEY` seteada → `authMethod='open'` (registro anónimo). La ausencia de una env abre el endpoint. Arma el `endpoint_url` atacante del SSRF (V3). | Fail-closed: sin la key → 401. |
| V6 | `handleInvoke.ts:562-582` | **Settle OK + upstream falla → no hay refund.** Se inserta en `settlement_failures` (auditoría) y se devuelve 502/503, pero el USDC ya está en el contrato y nunca se reembolsa al caller ni se acredita a nadie → fondos huérfanos. | Política de refund (voucher al `auth.from`) o cuenta de reconciliación. |
| V7 | `creator/withdraw/route.ts:148` | **`pending_earnings_usdc = 0` incondicional.** Si el creator acumula earnings entre firmar el voucher (T0) y el claim (T1), el claim libera solo `grossAmount` (T0) pero el reset borra todo → el creator pierde la diferencia. | Decrementar exactamente `realAmount` vía RPC atómico, no resetear a 0. |
| V8 | `creator/earnings/voucher/route.ts` + `withdraw` | **Sin lock entre voucher y withdraw → vouchers concurrentes** sobre el mismo balance (rate limit 10/h). Dos vouchers con nonces distintos podrían retirar 2× si el contrato tiene saldo. Defensa única = balance del contrato. | Verificar que no haya voucher `pending` no expirado antes de firmar; o estado "locked". |
| V9 | `onboard/step/route.ts:241,387` | **Onboarding no idempotente:** reintento del mismo step 7/8 antes de confirmar `completed` → segundo agente + segunda key (doble registro). | Update atómico `WHERE current_step = step` + check rowCount antes de efectos; o idempotency key. |
| V10 | ~20 rutas (`creator/wallet:49`, `admin/collections:32`, `models:48`, `register:344`, `handleInvoke:636,711`) | **Leak de `error.message`/`String(err)` de Supabase al cliente** (nombres de columnas/constraints/hosts). El patrón correcto ya existe (`invoke-agent/route.ts:110`) pero se aplica inconsistente. | Helper `jsonError(code,msg,status)` en `lib`; loguear detalle server-side; genérico al cliente. |
| V11 | `handleInvoke.ts:274-309` | **Mutex Redis liberado solo en el return feliz** — un throw entre adquisición (`:292`) y release deja el mutex colgado 15s (TTL). Sin `try/finally`. | Envolver la sección crítica en `try/finally` con release. |
| V12 | `handleInvoke.ts:155-624` | God-function ~470 líneas, validación de input **duplicada literal** (`:332-347` y `:522-537`), dos flujos de pago inline. | Dividir en `handleAgentKeyInvoke`/`handleX402Invoke`; extraer `callUpstream`/`buildResponse`. |
| V13 | `admin/disputes/route.ts:13`, `[id]/route.ts:13` | Bearer admin comparado con `===` (no constant-time) → timing side-channel teórico del `ADMIN_SECRET`. | `crypto.timingSafeEqual`. |
| V14 | `agents/register/route.ts:519-539` | Trabajo background (`update on-chain en DB`, health probe) como `.then().catch()` flotante **sin `after()`** → en serverless puede matarse antes de resolver (update perdido). `handleInvoke` sí usa `after()`. | Envolver en `after()` de `next/server`. |

### 🟡 BAJA — pulido

| # | archivo:línea | Problema |
|---|---|---|
| V15 | `app/[locale]/error.tsx:36` | `{error.message}` renderizado sin gate de `NODE_ENV` (a diferencia de `ErrorBoundary.tsx:63`). |
| V16 | `lib/webhooks/deliverWebhook.ts:21` | Entrega de webhook no re-valida la URL al enviar (DNS-rebinding de URL almacenada). |
| V17 | `tsconfig.json` | Faltan `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (como se agregaron en wasiai-a2a). |
| V18 | Chain IDs `43113/43114` + USDC addresses hardcodeados y repetidos (`agent-keys/page.tsx`, `handleInvoke.ts`); `eth_call` manual con selector ABI hardcodeado (`agent-keys/page.tsx:79`). | Centralizar en `lib/chains.ts`. |
| V19 | `register/route.ts:145` | `listUsers({perPage:1000})` sin paginar (TODO explícito) — cliff de escala. |
| V20 | God-files cliente: `agent-keys/page.tsx` (1064), `admin/page.tsx` (557) — múltiples componentes + lógica duplicada en un archivo. |
| V21 | ~9-15 strings en español hardcodeados que deberían estar en i18n (`messages/{en,es}.json`). |

---

## 3. Lo que está excelente

- **Layering impecable**: cero imports invertidos (`lib`/`shared` nunca importan de `features`/`app`).
- **`any` erradicado**: 1 solo `as any` real en 44k LOC.
- **Env type-safe** (`lib/env.ts`): zod único, fail-fast, sin `process.env.VAR!` dispersos.
- **Sin secrets en cliente**: `OPERATOR_PRIVATE_KEY` y demás nunca tocan un `'use client'`.
- **EIP-3009 correcto** (`usdcSettler.ts:166-227`): `recoverTypedDataAddress` + ERC-1271 fallback + rechazo de smart-accounts + normalización de `v`.
- **Retiros verificados on-chain, no por el cliente**: leen el evento del receipt (`KeyWithdrawn`/`EarningsClaimed`), validan keyId/owner/creator, extraen el monto real del log. El monto del cliente es solo "hint".
- **Voucher EIP-712**: `grossAmount` desde `pending_earnings_usdc` (DB), nunca del cliente; nonce 32B + deadline 1h.
- **Auth admin de mutaciones**: EIP-712 + allowlist de owner + anti-replay nonce/timestamp en Redis; el operador NO tiene privilegios admin; timelock 48h para fee.
- **IDOR**: sin leaks cross-tenant explotables; las rutas filtran por owner/creator del caller.
- **Anti-replay x402**: índice único sobre `nonce` + manejo de `23505 → payment_already_used`.
- **Débito de budget atómico**: `check_and_deduct_budget` (CHECK+DEDUCT en un UPDATE con rowlock) + mutex Redis fail-closed.
- **SSRF base**: `validateEndpointUrl` (HTTPS, RFC1918, link-local, metadata, ngrok) fail-closed; `health-probe.ts` pinea IP (template para el fix V3).

---

## 4. Testing — estado y plan

**Estado: insuficiente para un sistema de dinero.** Coverage **nunca se midió** (falta `@vitest/coverage-v8`). `handleInvoke.ts` (821 LOC, el corazón del money-path) **está mockeado en su único test** — su lógica real (débito, settle, refund, mutex, circuit breaker) no se ejecuta. Los retiros (`creator/withdraw`, `agent-keys/[id]/withdraw`) y todo `onboard/*` tienen **cero tests**. Sí hay piezas buenas: `overhead`/pricing, `usdcSettler.x402`, `settle-key-batches` (367 LOC).

**Plan priorizado (resumen):**
- **P0:** instalar `@vitest/coverage-v8` + ejecutar `handleInvoke` de verdad (débito, TOCTOU deducted=false, mutex 429, Redis-down fail-closed, budget 402, settle+upstream-falla → settlement_failures, nonce replay).
- **P1:** tests de retiros (monto > earnings, owner mismatch, keyId mismatch, post-withdraw fallback).
- **P2:** `CircuitBreaker`, `validateEndpointUrl` (SSRF), `signReceipt` — huérfanos de defensa en profundidad.
- **P3:** onboarding/register (state machine, slug duplicado, SSRF).

---

## 5. Recomendación de cierre

1. **Fix inmediato V1** (auth.to en el settler) — fund-loss confirmado por 2 auditores; fix quirúrgico + test.
2. **V2 (orden Route A)** y **V3 (DNS-rebinding + leak de credencial)** — siguientes en prioridad.
3. **V4 (floats USDC)** — refactor de tipos end-to-end; más grande, planificar.
4. **V5/V10/V11** quick wins de seguridad/higiene.
5. **Instalar coverage + tests P0** del money-path antes de seguir agregando features.

A diferencia de wasiai-a2a (que estaba A con holgura), wasiai-v2 tiene **bugs de dinero reales** que conviene cerrar antes de escalar a mainnet con volumen.
