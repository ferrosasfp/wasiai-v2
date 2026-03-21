# WAS-258 — Invoke: Reemplazar void Promise con after() en operaciones fire-and-forget

**Tipo:** QUALITY | **Clasificación:** Pipeline QUALITY completo (toca payment path) | **Fecha:** 2026-03-20  
**Archivo afectado:** `src/app/api/v1/models/[slug]/invoke/route.ts`

---

## Contexto

En Vercel serverless, al retornar la respuesta HTTP la función puede ser terminada antes de que los `void Promise.resolve(...)` background completen. Esto puede causar pérdida silenciosa de datos financieros (receipts, earnings, settlement failures).

`after()` de `next/server` (stable en Next.js 15) garantiza que las operaciones se completen incluso después de enviada la respuesta HTTP.

### Pre-condición

**GIVEN** el proyecto corre Next.js 15.x (stable `after()`). Verificado: `package.json` tiene `"next": "16.0.8"` ✅

### Las 3 instancias a migrar

**Instancia 1 — ~línea 361 (Route A, Agent Key):**
`receipt_signature` update en `agent_calls` — actualmente best-effort sin log de éxito. Comportamiento de "best effort" debe preservarse.

**Instancia 2 — ~línea 506 (Route B, x402):**
`settlement_failures` insert cuando pago cobrado pero upstream falla — **ya tiene** `.then()` con `logger.warn` (éxito) y `.catch()` con `logger.error` (fallo). Este logging DEBE preservarse.

**Instancia 3 — ~línea 542 (Route B, x402):**
`increment_pending_earnings` RPC — actualmente solo `.catch()` con `logger.error`.

---

## Acceptance Criteria (EARS)

- **AC1:** WHEN successful Agent Key invocation occurs, THE `receipt_signature` update to `agent_calls` SHALL use `after()` to guarantee execution post-response.
- **AC2:** WHEN x402 payment is settled but upstream fails, THE insert to `settlement_failures` SHALL use `after()` to guarantee execution post-response.
- **AC3:** WHEN successful x402 invocation occurs, THE `increment_pending_earnings` RPC call SHALL use `after()` to guarantee execution post-response.
- **AC4:** WHEN `after()` callbacks are registered, THE HTTP response SHALL be returned to the caller before the callbacks execute (no TTFB impact).
- **AC5:** WHEN any `after()` callback throws or rejects, THE error SHALL be logged at `logger.error` level with context including at minimum `{ err, slug }`.
- **AC6:** WHEN settlement_failures `after()` callback executes, BOTH success path (`logger.warn` with `txHash`) AND error path (`logger.error` with `txHash`) SHALL be logged preserving existing log context.
- **AC7:** WHEN the change is applied, THE TypeScript build SHALL pass with zero errors.

---

## Scope

**IN:** `src/app/api/v1/models/[slug]/invoke/route.ts` — las 3 instancias `void Promise.resolve(...)` identificadas.

**OUT:**
- `void triggerAgentEvent()` calls (~líneas 400 y 530) — sin cambios, son best-effort por diseño
- Lógica de pago principal (settlement, verificación x402)
- Ningún otro archivo de rutas API

---

## Rollback

`git revert` del commit. Las 3 operaciones vuelven a ser void Promise. Sin cambio de schema ni comportamiento visible al usuario.
