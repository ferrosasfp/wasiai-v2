# SDD #074: Remediación auditoría profesional — seguridad + calidad

> SPEC_APPROVED: no
> Fecha: 2026-05-29
> Tipo: improvement (security hardening + quality)
> SDD_MODE: full
> Branch: feat/074-remediacion-auditoria-v2
> Artefactos: doc/sdd/074-remediacion-auditoria-v2/
> Work Item: doc/sdd/074-remediacion-auditoria-v2/work-item.md
> Estimación: M | Clasificación: QUALITY (auth surface + security headers + middleware)

---

## 1. Resumen

Cierra 6 hallazgos de auditoría staff-level (2026-05-29): dos críticos de seguridad (auth admin por `x-admin-wallet` spoofeable en `GET /api/admin/agents` y `PATCH /api/admin/agents/:id`; `/admin` ausente de `isProtectedRoute` en `middleware.ts`), una CSP estática conflictiva con el nonce per-request, un self-call HTTP interno en el proxy de invoke, y dos issues de calidad (body PATCH sin zod, `console.log` sin guard).

Todos los fixes son quirúrgicos y circunscritos a los archivos del Scope IN. El resultado esperado: las rutas admin de agentes exigen firma EIP-712 (mismo patrón que `settlement`/`fee`), el middleware bloquea páginas `/admin` sin sesión, la CSP estática deja de incluir `unsafe-inline`/`unsafe-eval` para `script-src`, y la invocación de agente resuelve in-process sin round-trip HTTP ni dependencia de `NEXT_PUBLIC_SITE_URL`.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 074 |
| **Tipo** | improvement (security + quality) |
| **SDD_MODE** | full |
| **Objetivo** | Cerrar 6 hallazgos de auditoría (2 críticos auth, CSP, self-call, 2 quality) sin expandir scope ni romper tests existentes. |
| **Reglas de negocio** | Auth admin SOLO vía EIP-712 (`verifyAdminSignature`). Sin hardcodes de wallets. CSP nonce per-request es la única defensa de scripts. Invoke in-process sin URL env var. |
| **Scope IN** | Ver tabla 4.1 — 6 archivos (5 modificados + 1 nuevo) + tests. |
| **Scope OUT** | `admin/disputes` (Bearer), `admin/collections`, `admin/treasury`, `admin/status` (GET público on-chain), `models/[slug]/invoke/route.ts` (solo extraer lógica, no modificar comportamiento), RLS Postgres, migraciones, flujo x402/settlement. |
| **Missing Inputs** | Ninguno bloqueante — los 2 [NEEDS CLARIFICATION] del work-item se resuelven en §10. |

### Acceptance Criteria (EARS)

Heredados del work-item (AC-1..AC-7). Resumen verificable:

1. **AC-1** — WHEN llega `GET /api/admin/agents`, THE system SHALL rechazar con 401 toda request sin firma EIP-712 válida (`x-admin-signature`/`x-admin-nonce`/`x-admin-timestamp`) verificada por `verifyAdminSignature()`; ausente/expirada/no autorizada → 401; válida del owner → 200.
2. **AC-2** — WHEN llega `PATCH /api/admin/agents/:id`, THE system SHALL rechazar con 401 sin firma EIP-712 válida, e IGNORAR `x-admin-wallet` para autorización. Sin firma → 401 y NO mutar la DB.
3. **AC-3** — WHEN llega `PATCH /api/admin/agents/:id` con firma válida, THE system SHALL validar el body con zod (`{ status?: 'active'|'reviewing'|'draft'|'suspended', consecutive_failures?: number }`) y devolver 400 con detalle zod si no conforma.
4. **AC-4** — WHEN un usuario sin sesión Supabase navega a un path con `/admin`, THE system SHALL redirigir a `/{locale}/login` con HTTP 307. WHILE hay sesión válida, SHALL permitir el acceso.
5. **AC-5** — WHEN Next.js sirve cualquier página, THE system SHALL NO incluir `unsafe-inline` ni `unsafe-eval` en `script-src` del CSP estático de `next.config.mjs`. WHILE `middleware.ts` emite el nonce per-request, el CSP estático NO debe conflictuar.
6. **AC-6** — WHEN llega `POST /api/v1/agents/:slug/invoke` con `X-API-Key` válida, THE system SHALL invocar el handler canónico in-process (función compartida) SIN `fetch()` saliente a `${NEXT_PUBLIC_SITE_URL}/api/v1/models/:slug/invoke`. IF `NEXT_PUBLIC_SITE_URL` no está seteada o es localhost, THEN la invocación SHALL resolver igual (no 502, no depender de la var).
7. **AC-7** — WHILE `NODE_ENV !== 'development'`, THE system SHALL NO emitir `[Middleware Run]`. WHEN `NODE_ENV === 'development'`, SHALL emitirlo.

---

## 3. Context Map (Codebase Grounding)

### Archivos leídos

| Archivo | Por qué | Patrón / hallazgo extraído |
|---------|---------|----------------------------|
| `src/lib/admin/verifyAdminSignature.ts:43-78` | Contrato exacto del verificador EIP-712 | Firma `verifyAdminSignature(signature: \`0x${string}\`, message: AdminActionMessage): Promise<{ ok: boolean; reason?: string }>`. `AdminActionMessage = { action: string; nonce: \`0x${string}\`; timestamp: bigint }`. Anti-replay vía timestamp (5 min) + nonce Redis. Address autorizada: `WASIAI_OWNER_ADDRESS` (server-only, líneas 12-17). |
| `src/app/api/admin/fee/route.ts:30-40,74-75` | **Exemplar canónico** de auth por headers EIP-712 | Helper `verifyAuth(request, action)`: lee `x-admin-signature` / `x-admin-nonce` / `x-admin-timestamp`; si falta alguno → `{ ok:false, status:401, reason:'Missing admin auth headers' }`; construye `message = { action, nonce, timestamp: BigInt(tsHdr) }`; llama `verifyAdminSignature`; retorna `{ ok:false, status:401, reason }` en fallo. Uso: `const auth = await verifyAuth(request, 'proposeFee'); if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })`. |
| `src/app/api/admin/settlement/route.ts:31-52` | 2º exemplar EIP-712 (inline) | Misma lectura de headers + `actionMap` por acción + `verifyAdminSignature`. Confirma que el patrón de headers (no body) es el estándar para auth admin. |
| `src/app/api/admin/agents/route.ts:5-21` | Ruta a remediar (H-1) | `ADMIN_WALLETS` hardcodeado (incluye `0xf432...447Ba` y `0x94DC...B9eD`) + `OPERATOR`/`OWNER` desde `NEXT_PUBLIC_*`. Auth: `headers().get('x-admin-wallet')` ∈ `ADMIN_WALLETS`. **Spoofeable.** Usa `import { headers } from 'next/headers'` + `export async function GET()` sin `request`. |
| `src/app/api/admin/agents/[id]/route.ts:5-34` | Ruta a remediar (H-2, H-3 zod) | Mismo `ADMIN_WALLETS` hardcodeado. `PATCH(req: Request, { params })`. Body: `await req.json() as { status?: string; consecutive_failures?: number }` (cast, sin zod, línea 29). Validación manual `allowed` array (líneas 31-34). |
| `src/app/api/admin/collections/route.ts:7,44` | Exemplar de zod en ruta admin | `import { z } from 'zod'` + `const createSchema = z.object({ name: z.string().min(1).max(100), ... })`. Confirma `zod ^4.3.6` disponible (package.json) y patrón de schema a nivel módulo. |
| `middleware.ts:62-75,102-128,131-136` | Rutas a remediar (H-3, H-4 CSP coexistencia, H-6) | `isProtectedRoute` (líneas 70-75) lista paths con `.includes(...)`. `isDev` declarado en línea 106. `console.log('[Middleware Run]...')` en línea 67 (sin guard). CSP nonce per-request líneas 108-126 (NO tocar salvo console.log). Matcher (línea 134) ya excluye `/api/` vía el early-return de líneas 25-33. |
| `next.config.mjs:7-23,32` | Ruta a remediar (H-4) | `cspDirectives` array; línea 10: `"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live"`. Se sirve como header estático en `securityHeaders` (línea 32) sobre `source: '/(.*)'`. |
| `src/app/api/v1/agents/[slug]/invoke/route.ts:64-91` | Ruta a remediar (H-5) | Construye `siteUrl` desde `NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'` (línea 65) y hace `fetch(invokeUrl, { headers: { 'x-agent-key': apiKey } })` (líneas 77-85); en catch → 502 (líneas 86-91). Mapea `X-API-Key` → `x-agent-key`. Maneja también el path sin apiKey (trial / 402, líneas 33-62) — **fuera del scope del fix**, NO tocar. |
| `src/app/api/v1/models/[slug]/invoke/route.ts:1-843` | Origen de la lógica a extraer (H-5) | POST canónico (líneas 151-624): rate-limit, lookup model+key paralelo, Route A (agent key budget) y Route B (x402). Constantes módulo (`CONTRACT_ADDRESS`, `USDC_ADDR`, `CHAIN`, `SITE_URL`) y helpers (`build402Instructions`, `settleX402`, `callUpstream`, `logCall`, `buildResponse`). El POST recibe `(request: NextRequest, { params: Promise<{slug}> })` y retorna `NextResponse`. GET y OPTIONS también viven aquí. |
| `src/app/api/v1/models/[slug]/invoke/__tests__/x402-settle-fail.test.ts:1-30` | **Restricción de tests (CD-3)** | Importa el route handler real y mockea `@/lib/supabase/server`, `settlePaymentX402`, `callUpstream`, `logCall`, etc. via `vi.hoisted` + `vi.mock`. La extracción NO debe cambiar los símbolos que estos tests mockean ni el comportamiento observable del POST. |
| `src/app/api/v1/models/[slug]/invoke/__tests__/x402-flag-unset.test.ts:1-72` | Restricción de tests (CD-3) | Testea el boundary `settlePaymentX402` (no el route). Sin impacto directo si la extracción no toca `usdcSettler`. |
| `vitest.config.ts:7-10` | Infra de test | `environment: jsdom`, `setupFiles: ['./vitest.setup.ts']`, `include: ['src/**/*.test.{ts,tsx}']`, alias `@`→`src`. Tests nuevos: `*.test.ts` bajo `src/**`. |
| `doc/sdd/WAS-V2-1-auto-blindaje.md` | Auto-blindaje histórico (DONE previa) | AB-WAS-V2-1-3 (append-only refactor) y AB-WAS-V2-1-2 (multi-state guards). Aplicables a H-5 (extracción sin tocar legacy) — ver §5 CD-7, CD-8. |

### Exemplars verificados (todos confirmados con Read)

| Para crear/modificar | Seguir patrón de | Razón |
|----------------------|------------------|-------|
| Auth EIP-712 en `agents/route.ts` y `agents/[id]/route.ts` | `src/app/api/admin/fee/route.ts:30-40` (helper `verifyAuth`) | Patrón header-based EIP-712 más limpio del codebase. Copiar `verifyAuth` literal. |
| Zod schema del body PATCH | `src/app/api/admin/collections/route.ts:7,44` | `import { z }` + schema a nivel módulo en ruta admin. |
| `src/lib/invoke/handleInvoke.ts` (nuevo) | `src/app/api/v1/models/[slug]/invoke/route.ts` (mover POST + helpers) | La lógica canónica vive ahí; se mueve íntegra a `lib/` y el route pasa a thin wrapper. |
| Tests nuevos | `src/app/api/v1/models/[slug]/invoke/__tests__/x402-settle-fail.test.ts` (vi.hoisted + vi.mock) | Patrón de mocking de Supabase/deps para tests de route handlers. |

### Estado de BD relevante

| Tabla | Existe | Columnas relevantes | Cambios |
|-------|--------|---------------------|---------|
| `agents` | Sí | `id, slug, status, consecutive_failures, ...` | Ninguno — solo lectura/update existente. Sin migración. |

### Componentes reutilizables encontrados

- `verifyAdminSignature` (`src/lib/admin/verifyAdminSignature.ts`) — reutilizar, NO crear variante.
- Helper `verifyAuth(request, action)` de `fee/route.ts` — replicar literal en las rutas de agents.
- `zod` `^4.3.6` (package.json) — disponible, no agregar dependencia.

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar | AC | Wave |
|---------|--------|-------------|----------|----|------|
| `middleware.ts` | Modificar | Agregar `routePathname.includes('/admin')` a `isProtectedRoute` (líneas 70-75). Mover/referenciar `isDev` (decl. línea 106) antes de línea 67 y gatear `console.log` con `if (isDev)`. | self (líneas 70-75, 106) | AC-4, AC-7 | W1 |
| `next.config.mjs` | Modificar | En `cspDirectives` línea 10, eliminar `'unsafe-inline'` y `'unsafe-eval'` de `script-src` → `"script-src 'self' https://vercel.live"`. NO tocar otras directivas. | self (líneas 7-23) | AC-5 | W2 |
| `src/app/api/admin/agents/route.ts` | Modificar | Eliminar `ADMIN_WALLETS`/`OPERATOR_ADDRESS`/`OWNER_ADDRESS` (líneas 5-12) y el check `headers().get('x-admin-wallet')` (líneas 17-21). Cambiar firma a `GET(request: NextRequest)`. Agregar helper `verifyAuth(request, 'listAgents')`. 401 si `!auth.ok`. | `fee/route.ts:30-40,46` | AC-1 | W3 |
| `src/app/api/admin/agents/[id]/route.ts` | Modificar | Igual auth con action `'updateAgent'`. Reemplazar cast + `allowed` array (líneas 29-34) por zod schema. 400 con detalle zod si no conforma. Auth ANTES de parsear body. | `fee/route.ts:30-40` + `collections/route.ts:44` | AC-2, AC-3 | W3 |
| `src/lib/invoke/handleInvoke.ts` | **Crear** | Mover la lógica canónica de invocación desde `models/[slug]/invoke/route.ts` (POST + helpers + constantes módulo) a una función exportada `handleInvoke(request: NextRequest, slug: string): Promise<NextResponse>`. | `models/[slug]/invoke/route.ts` | AC-6 | W4 |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | POST pasa a thin wrapper: `return handleInvoke(request, slug)`. GET y OPTIONS se mantienen (o se mueven sus deps a lib según §10.B). Sin cambio de comportamiento observable. | self | AC-6 (CD-3) | W4 |
| `src/app/api/v1/agents/[slug]/invoke/route.ts` | Modificar | Reemplazar bloque `fetch()` (líneas 64-91) por `handleInvoke(request, slug)`. Mapear `X-API-Key` → header `x-agent-key` antes de llamar (ver §10.B). NO tocar el path trial/402 (líneas 33-62). Eliminar uso de `NEXT_PUBLIC_SITE_URL`. | `handleInvoke.ts` | AC-6 | W4 |
| Tests (vitest) | Crear | ≥1 test por AC (8 archivos/casos — ver §11). | `x402-settle-fail.test.ts` | todos | por wave |

### 4.2 Modelo de datos

N/A — sin cambios de BD, sin migración (Scope OUT explícito del work-item).

### 4.3 Componentes / Servicios

**`src/lib/invoke/handleInvoke.ts` (nuevo) — diseño (resuelve [NEEDS CLARIFICATION] B):**

Estrategia: **mover** (no copiar) el cuerpo del POST canónico + sus helpers/constantes de módulo a `lib/invoke/handleInvoke.ts`. El route de models queda como thin wrapper. Esto evita duplicar la lógica de payment (riesgo de divergencia, ver AB-WAS-V2-1-3) y permite que ambos routes (`models` y `agents`) la consuman.

- Firma pública: `export async function handleInvoke(request: NextRequest, slug: string): Promise<NextResponse>`.
  - Recibe `slug` ya resuelto (los routes hacen `const { slug } = await params` y lo pasan). Esto desacopla `handleInvoke` del shape `{ params: Promise<...> }` que difiere entre App Router versions.
- Se mueven a `handleInvoke.ts`: el cuerpo del POST (líneas 151-624), y los helpers/constantes que sólo usa el POST: `build402Instructions`, `settleX402`, `callUpstream`, `logCall`, `buildResponse`, `extractPaymentFromHeaders`, `X402PaymentHeader`, `PricingInfo`, `SettlementResult`, `SupabaseServiceClient`, y constantes `CONTRACT_ADDRESS`, `CHAIN_ID_NUM`, `CHAIN`, `USDC_ADDR`, `X402_CORS_HEADERS`.
- `route.ts` de models queda:
  - `import { handleInvoke } from '@/lib/invoke/handleInvoke'`
  - `POST(request, { params })` → `const { slug } = await params; return handleInvoke(request, slug)`
  - GET (líneas 627-662) y OPTIONS (840-842) **se mantienen en el route** (no son parte del invoke flow; mover sólo añade ruido). Si GET requiere `X402_CORS_HEADERS`/`SITE_URL`/`CHAIN_NAME`, esos imports se conservan en el route — son re-importables desde `@/lib/constants` y `@/lib/chain` sin acoplar a `handleInvoke`.

**`src/app/api/v1/agents/[slug]/invoke/route.ts` — diseño in-process (resuelve AC-6):**

- Mantener el bloque de `apiKey` (líneas 31-62): si no hay key → respuesta trial/402 actual (NO tocar).
- Si hay `apiKey`: en vez de `fetch()`, llamar `handleInvoke`. Problema: `handleInvoke` lee `request.headers.get('x-agent-key')`, pero aquí la key viene en `X-API-Key`. Solución sin URL ni fetch: construir un `NextRequest` clon con el header `x-agent-key` seteado y el mismo body, y pasarlo a `handleInvoke(clonedRequest, slug)`. Detalle de implementación en §10.B (decisión D-B2).
- Eliminar `siteUrl`/`invokeUrl`/`fetch`/timeout/502-catch. Los CORS de respuesta (`CORS` líneas 14-18) se mantienen: envolver la respuesta de `handleInvoke` re-emitiendo sus headers + CORS si se requiere (mismo shape que hoy).

### 4.4 Flujo principal (Happy Path)

**AC-1/AC-2 (admin auth):** request con `x-admin-signature`/`x-admin-nonce`/`x-admin-timestamp` válidos del owner → `verifyAuth` → `{ ok:true }` → handler procede (lista agentes / actualiza status) → 200.

**AC-3 (zod):** PATCH con firma válida → `verifyAuth` ok → `schema.safeParse(body)` → success → update.

**AC-4 (middleware):** sesión Supabase válida + path `/en/admin` → `isProtectedRoute=true` pero `user` presente → no redirige → pasa al handler.

**AC-6 (invoke):** `POST /api/v1/agents/echo/invoke` con `X-API-Key: wasi_...` → clon de request con `x-agent-key` → `handleInvoke(clon, 'echo')` in-process → respuesta del flujo Route A (budget) → 200, sin fetch.

### 4.5 Flujo de error

**AC-1/AC-2:** falta cualquier header de firma → 401 `{ error: 'Missing admin auth headers' }`. Firma de wallet no autorizada / expirada / nonce reusado → 401 `{ error: reason }`. **`x-admin-wallet` ya no se lee** → spoof imposible. En PATCH: el 401 ocurre ANTES de cualquier `.update()` → DB no mutada.

**AC-3:** body `{ status: 'invalid_value' }` → `safeParse` falla → 400 `{ error: 'Invalid body', detail: <zod error> }`. Body `{ unknown_field: true }` sin `status` → `.strict()` rechaza campos extra → 400 (o, si se decide pasthrough, no muta y no crashea — ver D-A3 en §10).

**AC-4:** sin cookie de sesión a `/en/admin` → `isProtectedRoute && !user` → `NextResponse.redirect('/en/login')` 307.

**AC-6:** key inválida → `handleInvoke` retorna 401 `invalid_key` (ya lo hace el flujo canónico). `NEXT_PUBLIC_SITE_URL` ausente → irrelevante (no se usa) → no 502.

---

## 5. Constraint Directives (Anti-Alucinación)

### OBLIGATORIO seguir

- **CD-OBL-1:** Auth admin SOLO con `verifyAdminSignature` (`src/lib/admin/verifyAdminSignature.ts`). Replicar el helper `verifyAuth(request, action)` de `fee/route.ts:30-40` LITERAL. Action strings: `'listAgents'` (GET) y `'updateAgent'` (PATCH).
- **CD-OBL-2:** Zod desde `import { z } from 'zod'` (ya instalado `^4.3.6`). Schema a nivel módulo como en `collections/route.ts:44`.
- **CD-OBL-3:** Imports solo de módulos verificados existentes: `@/lib/admin/verifyAdminSignature`, `@/lib/invoke/handleInvoke` (nuevo), `zod`, `next/server`.

### PROHIBIDO

- **CD-1 (heredado):** PROHIBIDO degradar el flujo EIP-712 de rutas que ya lo usan (`settlement`, `fee`, `collections`). El fix de H-1/H-2 es aditivo: copiar el patrón, no inventar variante.
- **CD-2 (heredado):** PROHIBIDO tocar/debilitar el CSP nonce per-request de `middleware.ts:102-128`. El único cambio en middleware además de `/admin` es gatear el `console.log` (H-6).
- **CD-3 (heredado, CRÍTICA):** PROHIBIDO romper tests existentes en `src/app/api/v1/models/[slug]/invoke/__tests__/` y `src/app/api/v1/models/[slug]/__tests__/`. La extracción a `lib/` debe mantener comportamiento exacto y los símbolos que esos tests mockean (`@/lib/supabase/server`, `@/lib/contracts/usdcSettler`, etc. — los mocks son por path, así que `handleInvoke` debe seguir importando de esos mismos paths).
- **CD-4 (heredado):** PROHIBIDO usar `NEXT_PUBLIC_*` para secret o para resolver siteUrl en H-5. La llamada in-process NO depende de ninguna env var de URL. Eliminar el uso de `NEXT_PUBLIC_SITE_URL` en `agents/[slug]/invoke/route.ts`.
- **CD-5 (heredado):** PROHIBIDO que el fix de H-3 bloquee `/api/admin/*`. El matcher ya excluye `/api/` (early-return middleware.ts:25-33); agregar `/admin` a `isProtectedRoute` solo afecta páginas.
- **CD-6:** PROHIBIDO eliminar el hardcode de wallets de `agents/route.ts:7-12` "dejándolo a medias". Debe eliminarse COMPLETO (incluyendo `OPERATOR_ADDRESS`, `OWNER_ADDRESS`, las wallets literales y el array). La única autorización es `verifyAdminSignature` (que usa `WASIAI_OWNER_ADDRESS`).
- **CD-7 (de AB-WAS-V2-1-3 — append-only / no duplicar lógica de payment):** PROHIBIDO copiar la lógica de invoke a `handleInvoke.ts` dejando una copia en el route. Debe **moverse** (route queda thin wrapper). No deben coexistir dos versiones del algoritmo de payment. Referencia: WAS-V2-1 auto-blindaje AB-WAS-V2-1-3.
- **CD-8 (de AB-WAS-V2-1-2 — multi-state guards en invoke):** PROHIBIDO alterar los guards existentes del flujo de settlement al mover el código (`!settlement.verified` → 402, `!settlement.settled` → 502, líneas 493-518). Mover bit-exact. El test `x402-settle-fail.test.ts` valida esto. Referencia: WAS-V2-1 auto-blindaje AB-WAS-V2-1-2.
- **CD-9:** PROHIBIDO modificar el path trial/402 de `agents/[slug]/invoke/route.ts:33-62` (free-trial guidance). Solo se reemplaza el bloque `fetch()` (líneas 64-91).
- **CD-10:** PROHIBIDO ampliar el scope a otras rutas admin (`disputes`, `treasury`, `status`, `collections`) ni a `models/[slug]/invoke/route.ts` (solo extraer, sin cambiar comportamiento).

---

## 6. Scope

**IN:** Los 6 archivos de tabla 4.1 (`middleware.ts`, `next.config.mjs`, `admin/agents/route.ts`, `admin/agents/[id]/route.ts`, `lib/invoke/handleInvoke.ts` nuevo, `v1/agents/[slug]/invoke/route.ts`) + el thin-wrapper en `models/[slug]/invoke/route.ts` + tests.

**OUT:** `admin/disputes`, `admin/collections`, `admin/treasury`, `admin/status`; cambio de comportamiento en `models/[slug]/invoke` (solo extracción); RLS Postgres; migraciones; flujo x402/settlement batch; refactors fuera de los 6 ítems.

---

## 7. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Extracción de invoke rompe tests existentes (route import + mocks por path) | M | A | CD-7/CD-8: mover bit-exact, mantener paths de import (los mocks son por path). Correr suite completa de `models/invoke/__tests__` en W4 antes de cerrar. |
| `handleInvoke` lee `x-agent-key` pero el proxy de agents recibe `X-API-Key` | A | M | D-B2 (§10): clonar request con header `x-agent-key` seteado; test AC-6 lo cubre. |
| CSP nonce ya inyecta `'unsafe-eval'` en dev (middleware.ts:110) — confundir con el fix estático | B | M | El fix es SOLO en `next.config.mjs`. El `'unsafe-eval'` condicional de dev en middleware está permitido por CD-2 (no se toca). |
| zod `.strict()` rechaza `consecutive_failures` legítimo o rompe un caller existente | B | M | Schema con ambos campos opcionales; revisar si algún caller envía campos extra (D-A3). Test AC-3 valida `invalid_value`→400 y `unknown_field`→no-crash. |
| Mover constantes de módulo (`CONTRACT_ADDRESS`, etc.) deja referencias colgantes en GET del route | M | M | Inventariar qué usa GET/OPTIONS; conservar sus imports en el route (re-import desde `@/lib/constants`, `@/lib/chain`). Typecheck en W4. |

---

## 8. Dependencias

- `verifyAdminSignature` ya existe y funciona (usado por settlement/fee/collections). Requiere `WASIAI_OWNER_ADDRESS` + Upstash Redis env (ya configurado).
- `zod ^4.3.6` instalado.
- No depende de ni bloquea otros WKH. WKH-070 (Auth Guard) toca `isProtectedRoute` de forma compatible (mismo bloque condicional).

---

## 9. Missing Inputs

Ninguno bloqueante. Los 2 [NEEDS CLARIFICATION] del work-item se resuelven en §10 con evidencia de código.

---

## 10. Resolución de [NEEDS CLARIFICATION] / Decisiones

### A) ¿`GET /api/admin/agents` debe exigir EIP-712? → **SÍ (D-A1)**

**Decisión:** SÍ exige EIP-712, en paridad con PATCH y con el resto de mutaciones admin.

**Evidencia:**
- El hallazgo H-1 (auth `x-admin-wallet` spoofeable) es **CRÍTICO**: hoy cualquiera con uno de los 4 valores hardcodeados (`agents/route.ts:7-12`) lee el listado completo de agentes incluyendo `consecutive_failures`, `creator_id`, `health_check` — datos operativos sensibles.
- No existe en el codebase un patrón de "GET admin con auth diferenciada por lectura": `fee/route.ts` GET es **público sin auth** (lectura on-chain pública, líneas 46-66) y `collections` GET es **público** (UI listing, líneas 25-41). Pero el listado de `agents` admin NO es público (expone datos internos), por eso hoy intenta autenticar — solo lo hace mal.
- Postura conservadora del work-item (Missing Inputs) y AC-1 ya lo especifican. Mantener.

**Diferencia con settlement/fee:** GET no recibe `request` hoy (`export async function GET()`). Hay que cambiar la firma a `GET(request: NextRequest)` para leer los headers de firma. Esto es compatible con App Router.

### B) Alcance exacto de `handleInvoke.ts` → **Mover POST + helpers del POST; GET/OPTIONS quedan en route (D-B1). Proxy clona request con `x-agent-key` (D-B2).**

**D-B1 (qué va a lib):** mover el cuerpo del POST y los helpers/constantes que **solo** usa el POST (`build402Instructions`, `settleX402`, `callUpstream`, `logCall`, `buildResponse`, `extractPaymentFromHeaders`, tipos, y constantes `CONTRACT_ADDRESS`/`USDC_ADDR`/`CHAIN`/`CHAIN_ID_NUM`/`X402_CORS_HEADERS`). NO mover GET (líneas 627-662) ni el A-01 que GET no usa. Firma: `handleInvoke(request: NextRequest, slug: string): Promise<NextResponse>` — recibe slug resuelto, no `{ params }`.

**Evidencia:** El work-item DT-2 propuso `(slug, apiKey, body)`. Lo ajusto a `(request, slug)` porque:
1. El flujo canónico lee MUCHO más que `apiKey`/`body` del request: `x-payment`/`payment-signature` (línea 459), `x-sandbox` (435), `x-forwarded-for`/`x-real-ip` (192-193), `x-request-id` (469), y hace `request.clone().json()` (336, 525). Pasar `(slug, apiKey, body)` obligaría a reconstruir todo el contexto del request y divergir del comportamiento → viola CD-3. Pasar el `NextRequest` íntegro preserva comportamiento exacto.
2. Los tests existentes (`x402-settle-fail.test.ts`) construyen un `NextRequest` y lo pasan al POST. Si el POST delega `handleInvoke(request, slug)` con el mismo request, los tests siguen pasando sin cambios.

**D-B2 (cómo el proxy de agents pasa la key):** el flujo canónico autentica por `request.headers.get('x-agent-key')` (línea 167). El proxy de agents recibe `X-API-Key`. Para invocar in-process: clonar el request agregando el header `x-agent-key`. Como `NextRequest` headers son inmutables, construir un nuevo `Request`/`NextRequest` con `new Headers(request.headers)`, `.set('x-agent-key', apiKey)`, mismo `method`/`body` (usar `request.clone()` para el body), y pasarlo a `handleInvoke(clon, slug)`. Sin `fetch`, sin URL.

**D-A3 (modo del zod schema):** schema con `.strict()` para rechazar campos desconocidos explícitamente (AC-3 exige que `{ unknown_field: true }` "no crashee ni mute"). Con `.strict()` + `safeParse`, campo extra → `success:false` → 400 (no muta). Alternativa `.passthrough()` permitiría el campo extra pero entonces hay que filtrar al construir el `update` (como hoy en líneas 36-38). **Decisión: `.strict()`** — es la opción más segura y alineada a AB-WAS-V2-1-5 (strict schemas). El schema: `z.object({ status: z.enum(['active','reviewing','draft','suspended']).optional(), consecutive_failures: z.number().int().optional() }).strict()`.

---

## 11. Test Plan (≥1 test por AC)

| AC | Test (caso) | Tipo | Archivo | Notas |
|----|-------------|------|---------|-------|
| AC-1 | `GET /api/admin/agents` con `x-admin-wallet: 0xf432...447Ba` (sin firma) → 401 | integration/vitest | `src/app/api/admin/agents/__tests__/auth.test.ts` | Mockear `verifyAdminSignature` (no llamar Redis real). Verificar que `x-admin-wallet` se ignora. |
| AC-1 | `GET /api/admin/agents` con firma EIP-712 mock-válida → 200 | integration/vitest | mismo archivo | Mock `verifyAdminSignature` → `{ ok:true }`; mock `createServiceClient`. |
| AC-2 | `PATCH /api/admin/agents/[id]` con `x-admin-wallet` spoofeado + `{status:'suspended'}` (sin firma) → **401 y `supabase.update` NO invocado** | integration/vitest | `src/app/api/admin/agents/__tests__/patch-auth.test.ts` | Assert `mockUpdate` no llamado (prueba no-mutación). |
| AC-3 | `PATCH` con firma válida + `{status:'invalid_value'}` → 400 con detalle zod | unit/vitest | mismo archivo (`patch-auth.test.ts`) | + caso `{unknown_field:true}` sin status → 400, no muta (`.strict()`). |
| AC-4 | request sin cookie a `/en/admin` → 307 redirect a `/en/login`; con sesión → no redirige | unit/vitest | `src/__tests__/middleware-admin.test.ts` | Mockear `@supabase/ssr` `createServerClient` → `getUser` null/válido; mock `next-intl/middleware`. |
| AC-5 | Parsear `cspDirectives` de `next.config.mjs` → `script-src` NO contiene `unsafe-eval` ni `unsafe-inline` | unit/vitest | `src/__tests__/csp-headers.test.ts` | Importar el array/config o leer el string; assert sobre la directiva `script-src`. |
| AC-6 | `POST /api/v1/agents/:slug/invoke` con `X-API-Key` válida y `NEXT_PUBLIC_SITE_URL` unset → resuelve (no 502); `fetch` NUNCA llamado | integration/vitest | `src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts` | `vi.stubGlobal('fetch', vi.fn())` + `expect(fetch).not.toHaveBeenCalled()`. Mock `@/lib/invoke/handleInvoke` → 200. |
| AC-7 | `NODE_ENV=production` → middleware NO emite `[Middleware Run]`; `development` → sí | unit/vitest | `src/__tests__/middleware-console.test.ts` | Spy en `console.log`; togglear `process.env.NODE_ENV`. |

> Regresión obligatoria (CD-3): correr `src/app/api/v1/models/[slug]/invoke/__tests__/*` y `src/app/api/v1/models/[slug]/__tests__/*` en W4 → deben seguir verdes sin modificarlos.

---

## 12. Waves de Implementación

### Wave 0 (Serial Gate — setup/verificación)
- W0.1: Verificar que `verifyAdminSignature` exporta `{ verifyAdminSignature, AdminActionMessage }` y que `WASIAI_OWNER_ADDRESS` está en env local/test (sino, mockear en tests).
- W0.2: Inventariar referencias en `models/[slug]/invoke/route.ts`: qué símbolos usa GET (líneas 627-662) y OPTIONS (840-842) para decidir qué constantes quedan en el route vs se mueven a `handleInvoke.ts`. Confirmar imports de mock por path que usan los tests existentes.
- Verificación: `npx tsc --noEmit` baseline + suite actual verde.

### Wave 1 (middleware — H-3 + H-6, bajo riesgo, mismo archivo)
- W1.1: `middleware.ts` — agregar `routePathname.includes('/admin')` a `isProtectedRoute` (líneas 70-75).
- W1.2: `middleware.ts` — mover `const isDev = process.env.NODE_ENV === 'development'` antes de línea 67 (o referenciarla) y gatear `if (isDev) console.log(...)`.
- Tests: `middleware-admin.test.ts` (AC-4), `middleware-console.test.ts` (AC-7).
- Verificación: typecheck + ambos tests verdes.

### Wave 2 (CSP — H-4, aislado)
- W2.1: `next.config.mjs` — línea 10: `"script-src 'self' https://vercel.live"` (quitar `'unsafe-inline'` y `'unsafe-eval'`). NO tocar otras directivas.
- Test: `csp-headers.test.ts` (AC-5).
- Verificación: typecheck + test verde.

### Wave 3 (admin agents auth + zod — H-1 + H-2 + H-3-zod, mismo patrón)
- W3.1: `admin/agents/route.ts` — eliminar `ADMIN_WALLETS`/wallets hardcodeadas (líneas 5-12), cambiar `GET()`→`GET(request: NextRequest)`, agregar `verifyAuth(request, 'listAgents')`, 401 si `!auth.ok`.
- W3.2: `admin/agents/[id]/route.ts` — mismo auth con `'updateAgent'` (ANTES de parsear body); reemplazar cast+`allowed` (líneas 29-34) por zod `.strict()` schema + `safeParse` → 400 con detalle.
- Tests: `auth.test.ts` (AC-1 ×2), `patch-auth.test.ts` (AC-2 + AC-3).
- Verificación: typecheck + tests verdes.

### Wave 4 (invoke in-process — H-5, mayor complejidad, va última)
- W4.1: Crear `src/lib/invoke/handleInvoke.ts` — mover POST + helpers/constantes (D-B1), exportar `handleInvoke(request, slug)`. Mantener imports por path idénticos (CD-3) y guards de settlement bit-exact (CD-8).
- W4.2: `models/[slug]/invoke/route.ts` — POST pasa a `return handleInvoke(request, slug)`; GET/OPTIONS intactos; conservar imports que GET necesita.
- W4.3: `v1/agents/[slug]/invoke/route.ts` — reemplazar bloque `fetch()` (64-91) por clon de request con `x-agent-key` (D-B2) + `handleInvoke(clon, slug)`; eliminar `NEXT_PUBLIC_SITE_URL`; mantener trial/402 (33-62) y CORS.
- Tests: `no-self-call.test.ts` (AC-6) + **regresión completa** de `models/invoke/__tests__` y `models/__tests__` (CD-3).
- Verificación: typecheck + suite completa verde.

> Waves W1, W2, W3 son independientes entre sí (archivos distintos) y podrían paralelizarse; W4 va última para que la regresión se valide con todo lo anterior estable.

---

## 13. Readiness Check (SDD)

```
[X] Cada AC tiene ≥1 archivo asociado en tabla 4.1 (AC-1..7 mapeados)
[X] Cada archivo en 4.1 tiene Exemplar verificado con Read (fee/route.ts, collections/route.ts, models/invoke, self)
[X] No hay [NEEDS CLARIFICATION] pendientes (A y B resueltos en §10 con evidencia)
[X] Constraint Directives ≥3 PROHIBIDO (CD-1..CD-10 = 10 prohibido + 3 obligatorio)
[X] Context Map ≥2 archivos leídos (14 archivos leídos con archivo:línea)
[X] Scope IN y OUT explícitos y no ambiguos (§6)
[X] BD: tabla `agents` verificada, sin cambios/migración
[X] Happy Path completo (§4.4 por AC)
[X] Flujo de error definido (§4.5 por AC, incluye no-mutación en 401 PATCH)
[X] Auto-blindaje histórico aplicado (AB-WAS-V2-1-3 → CD-7; AB-WAS-V2-1-2 → CD-8; AB-WAS-V2-1-5 → D-A3)
[X] Test plan ≥1 test por AC con archivo+caso concreto (§11, incluye x-admin-wallet spoof→401+no-mutación)
```

Sin TBDs ni [NEEDS CLARIFICATION] pendientes → listo para SPEC_APPROVED.

---

*SDD generado por NexusAgil — FULL — WKH-AUDIT-V2 (074)*
