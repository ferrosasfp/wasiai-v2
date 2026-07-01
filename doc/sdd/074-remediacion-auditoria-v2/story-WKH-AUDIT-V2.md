# Story File — WKH-AUDIT-V2 (074): Remediación auditoría profesional

> Contrato de implementación autocontenido. **El Dev sigue ESTE archivo wave por wave SIN volver a leer el SDD ni el codebase para decidir.** Cada cambio, firma, exemplar (archivo:línea) y test está aquí.
> SPEC_APPROVED: sí | Branch: `feat/074-remediacion-auditoria-v2` | Repo: `wasiai-v2`
> SDD origen: `doc/sdd/074-remediacion-auditoria-v2/sdd.md`

---

## 1. Contexto compacto (qué se construye y por qué)

Auditoría staff-level (2026-05-29) detectó 6 hallazgos. Esta HU los cierra, todos quirúrgicos:

| # | Sev | Qué arregla | AC |
|---|-----|-------------|----|
| H-1 | CRÍTICO | `GET /api/admin/agents` autentica por `x-admin-wallet` (spoofeable) + wallets hardcodeadas → cambiar a EIP-712 | AC-1 |
| H-2 | CRÍTICO | `PATCH /api/admin/agents/:id` mismo problema spoofeable | AC-2 |
| H-3 | CRÍTICO | `/admin` no está en `isProtectedRoute` del middleware (páginas sin proteger) | AC-4 |
| H-4 | MEDIO | CSP estática de `next.config.mjs` tiene `unsafe-inline`/`unsafe-eval` en `script-src` y debilita el nonce per-request | AC-5 |
| H-5 | MEDIO | `agents/[slug]/invoke` hace self-call HTTP `fetch()` a `models/[slug]/invoke` vía `NEXT_PUBLIC_SITE_URL` | AC-6 |
| H-6 | LOW | `console.log('[Middleware Run]...')` en cada request sin guard `isDev` | AC-7 |
| H-3-zod | — | body PATCH sin validación zod (cast directo) | AC-3 |

**Resultado esperado:** rutas admin de agentes exigen firma EIP-712 (mismo patrón que `fee`/`settlement`); middleware bloquea páginas `/admin` sin sesión; CSP estática sin `unsafe-*` en scripts; invoke resuelve in-process sin fetch ni env var de URL; logging gateado.

---

## 2. Scope IN (lista exhaustiva de archivos a tocar)

### Producción (7 archivos: 6 modificados + 1 nuevo)
1. `middleware.ts` — modificar (W1)
2. `next.config.mjs` — modificar (W2)
3. `src/app/api/admin/agents/route.ts` — modificar (W3)
4. `src/app/api/admin/agents/[id]/route.ts` — modificar (W3)
5. `src/lib/invoke/handleInvoke.ts` — **CREAR** (W4)
6. `src/app/api/v1/models/[slug]/invoke/route.ts` — modificar a thin wrapper (W4)
7. `src/app/api/v1/agents/[slug]/invoke/route.ts` — modificar (W4)

### Tests (8 casos en archivos nuevos; `src/__tests__/` no existe aún → crearlo)
- `src/app/api/admin/agents/__tests__/auth.test.ts` (AC-1 ×2)
- `src/app/api/admin/agents/__tests__/patch-auth.test.ts` (AC-2 + AC-3)
- `src/__tests__/middleware-admin.test.ts` (AC-4) — **crear dir `src/__tests__/`**
- `src/__tests__/csp-headers.test.ts` (AC-5)
- `src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts` (AC-6)
- `src/__tests__/middleware-console.test.ts` (AC-7)

### Scope OUT (NO tocar)
`admin/disputes`, `admin/collections`, `admin/treasury`, `admin/status`; **comportamiento** de `models/[slug]/invoke` (solo extracción bit-exact); RLS Postgres; migraciones; flujo x402/settlement; trial/402 de `agents/[slug]/invoke` (líneas 33-62); CSP nonce del middleware (líneas 102-128).

---

## 3. Anti-Hallucination Checklist (APIs que SÍ existen vs que NO debés inventar)

### ✅ PODÉS usar (verificado en codebase)

**`verifyAdminSignature` — `@/lib/admin/verifyAdminSignature` (verificado `src/lib/admin/verifyAdminSignature.ts:43-46`):**
```ts
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'

export interface AdminActionMessage {
  action:    string
  nonce:     `0x${string}`
  timestamp: bigint
}
export async function verifyAdminSignature(
  signature: `0x${string}`,
  message:   AdminActionMessage,
): Promise<{ ok: boolean; reason?: string }>
```
- Address autorizada = `WASIAI_OWNER_ADDRESS` (server-only env, NO `NEXT_PUBLIC_*`).
- Anti-replay: timestamp 5 min + nonce en Redis. Reasons posibles: `signature_expired`, `not_authorized`, `nonce_already_used`, `invalid_signature`.

**Helper `verifyAuth` — COPIAR LITERAL de `src/app/api/admin/fee/route.ts:30-40`:**
```ts
async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}
```
- Headers EIP-712 esperados: `x-admin-signature`, `x-admin-nonce`, `x-admin-timestamp`.
- Uso (de `fee/route.ts:74-75`):
  ```ts
  const auth = await verifyAuth(request, 'listAgents')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })
  ```

**`zod` `^4.3.6` instalado** — `import { z } from 'zod'`. Schema a nivel módulo (patrón `src/app/api/admin/collections/route.ts:7,44`).

**`createServiceClient` — `@/lib/supabase/server`** (ya importado en ambas rutas admin).

**`handleInvoke` (NUEVO, lo creás vos en W4):**
```ts
import { handleInvoke } from '@/lib/invoke/handleInvoke'
export async function handleInvoke(request: NextRequest, slug: string): Promise<NextResponse>
```
- **Firma EXACTA y NO negociable:** `(request: NextRequest, slug: string)` → recibe el `slug` ya resuelto (no `{ params }`). El SDD §10 D-B1 descarta `(slug, apiKey, body)` del work-item DT-2 porque el flujo lee mucho más del request.

**Imports permitidos:** `next/server`, `@/lib/admin/verifyAdminSignature`, `@/lib/invoke/handleInvoke` (nuevo), `zod`, `@/lib/supabase/server`, y todos los imports que YA tiene `models/[slug]/invoke/route.ts` (se mueven con el código).

### ❌ NO inventes / NO uses
- ❌ NO `ethers` — el stack es `viem`.
- ❌ NO una variante nueva de verificador de firma — usá `verifyAdminSignature` tal cual.
- ❌ NO `fetch()` interno ni `NEXT_PUBLIC_SITE_URL` en el invoke (CD-4).
- ❌ NO leer `x-admin-wallet` para autorización (debe ignorarse / eliminarse).
- ❌ NO `any` explícito (TypeScript strict).
- ❌ NO tocar el CSP nonce del middleware (líneas 102-128).
- ❌ NO `console.log` sin guard en el middleware.
- ❌ NO cambiar los paths de import en `handleInvoke.ts` (los tests mockean por path — CD-3).

---

## 4. Constraint Directives heredados (PROHIBIDO / OBLIGATORIO)

### OBLIGATORIO
- **CD-OBL-1:** Auth admin SOLO con `verifyAdminSignature`. Replicar `verifyAuth(request, action)` de `fee/route.ts:30-40` LITERAL. Actions: `'listAgents'` (GET), `'updateAgent'` (PATCH).
- **CD-OBL-2:** zod desde `import { z } from 'zod'`. Schema `.strict()` a nivel módulo.
- **CD-OBL-3:** Imports solo de módulos verificados existentes (ver §3).

### PROHIBIDO
- **CD-1:** No degradar el EIP-712 de `settlement`/`fee`/`collections`. El fix es **aditivo**: copiar, no inventar.
- **CD-2:** No tocar/debilitar el CSP nonce per-request de `middleware.ts:102-128`. Único cambio en middleware además de `/admin`: gatear el `console.log`. El `'unsafe-eval'` condicional de dev (línea 110) **se mantiene** — está permitido por CD-2.
- **CD-3 (CRÍTICA):** No romper tests existentes de `src/app/api/v1/models/[slug]/invoke/__tests__/` ni `src/app/api/v1/models/[slug]/__tests__/`. La extracción mantiene comportamiento exacto y **los mismos paths de import** (los mocks son por path: `@/lib/supabase/server`, `@/lib/contracts/usdcSettler`, `@/lib/chain`, `@/lib/constants`, etc.).
- **CD-4:** No usar `NEXT_PUBLIC_*` para resolver siteUrl en H-5. Eliminar el uso de `NEXT_PUBLIC_SITE_URL` en `agents/[slug]/invoke/route.ts`. Llamada in-process, sin env var de URL.
- **CD-5:** El `/admin` en `isProtectedRoute` NO debe bloquear `/api/admin/*`. El matcher ya excluye `/api/` vía early-return (`middleware.ts:25-33`); `isProtectedRoute` solo afecta páginas. **No tocar ese early-return.**
- **CD-6:** Eliminar el hardcode de wallets de `agents/route.ts:5-12` y `[id]/route.ts:5-12` COMPLETO: `OPERATOR_ADDRESS`, `OWNER_ADDRESS`, las 2 wallets literales y el array `ADMIN_WALLETS`. Nada a medias.
- **CD-7 (mover, no copiar — AB-WAS-V2-1-3):** PROHIBIDO copiar la lógica de invoke a `handleInvoke.ts` dejando una copia en el route. Se **mueve** (route queda thin wrapper). No deben coexistir dos versiones del algoritmo de payment.
- **CD-8 (guards bit-exact — AB-WAS-V2-1-2):** No alterar los guards de settlement al mover (`!settlement.verified` → 402 en líneas 493-507; `!settlement.settled` → 502 code `settle_failed` en líneas 509-518). Mover **bit-exact**. El test `x402-settle-fail.test.ts` valida esto.
- **CD-9:** No modificar el path trial/402 de `agents/[slug]/invoke/route.ts:33-62`. Solo se reemplaza el bloque `fetch()` (líneas 64-101 — desde `const siteUrl` hasta el `return new NextResponse`).
- **CD-10:** No ampliar scope a otras rutas admin ni cambiar comportamiento de `models/[slug]/invoke` (solo extracción).

---

## 5. Waves de implementación (orden y dependencias)

**Orden obligatorio:** W0 → W1 → W2 → W3 → W4. W1/W2/W3 son independientes (archivos distintos), pero W4 va **última** para validar la regresión con todo lo anterior estable. No empieces W4 sin W0-W3 verdes.

---

### Wave 0 — Setup / verificación (serial gate, sin código de prod)

- **W0.1:** Confirmar `npx tsc --noEmit` pasa baseline (estado limpio) y la suite actual está verde:
  ```
  npx tsc --noEmit
  npx vitest run "src/app/api/v1/models/[slug]"
  ```
- **W0.2:** Inventariar qué símbolos usa el **GET** (`route.ts:627-662`) y **OPTIONS** (`route.ts:840-842`) de `models/[slug]/invoke/route.ts`, para decidir qué imports/constantes quedan en el route y cuáles se mueven a `handleInvoke.ts`. Ya verificado:
  - GET usa: `createClient` (no `createServiceClient`), `SITE_URL`, `CHAIN_NAME`, `CHAIN_ID_NUM`, `CONTRACT_ADDRESS`, `IS_MAINNET`. → **estos imports/consts se CONSERVAN en el route.ts** (o se re-importan); GET no se mueve.
  - OPTIONS usa: `X402_CORS_HEADERS`. → conservar accesible en el route (re-declarar o importar de `handleInvoke` si se exporta).
- **W0.3:** Confirmar que `src/__tests__/` no existe (correcto) — crearlo en W1.
- **Verificación W0:** baseline typecheck OK + suite invoke verde.

---

### Wave 1 — middleware (H-3 + H-6) — archivo: `middleware.ts`

**Cambio 1 (H-3, AC-4):** agregar `/admin` a `isProtectedRoute` (líneas 70-75).
```ts
// ANTES (middleware.ts:70-75)
const isProtectedRoute =
  routePathname.includes('/creator/dashboard') ||
  routePathname.includes('/creator/agents') ||
  routePathname.includes('/publish') ||
  routePathname.includes('/agent-keys') ||
  routePathname.includes('/pipelines')

// DESPUÉS — agregar una línea
const isProtectedRoute =
  routePathname.includes('/creator/dashboard') ||
  routePathname.includes('/creator/agents') ||
  routePathname.includes('/publish') ||
  routePathname.includes('/agent-keys') ||
  routePathname.includes('/pipelines') ||
  routePathname.includes('/admin')
```
El redirect 307 ya existe en líneas 80-89 (`NextResponse.redirect(new URL('/${locale}/login', ...))`). No tocar.

**Cambio 2 (H-6, AC-7):** gatear el `console.log` de línea 67 con `isDev`. Hoy `const isDev = ...` está declarado en línea 106 (después del log). **Mover** esa declaración a antes de la línea 67.
```ts
// Mover esta línea (hoy en 106) a antes del bloque del log (antes de línea 64-67):
const isDev = process.env.NODE_ENV === 'development'
...
// línea 67 — gatear:
if (isDev) console.log('[Middleware Run] Path:', routePathname, 'strip:', pathWithoutLocale, 'hasUser:', !!user)
```
- **IMPORTANTE:** eliminar la declaración duplicada de `isDev` en línea 106 (queda una sola, movida arriba). No tocar el bloque CSP (102-128) salvo eliminar esa línea `const isDev`.

**NO TOCAR:** early-return `/api/` (25-33) [CD-5], bloque CSP nonce (102-128 menos la línea de `isDev`) [CD-2], matcher (131-136).

**Tests W1:**
- `src/__tests__/middleware-admin.test.ts` (AC-4):
  - Mockear `@supabase/ssr` `createServerClient` → `auth.getUser()` resuelve `{ data: { user: null } }`; mockear `next-intl/middleware` para que `intlMiddleware(request)` retorne un `NextResponse.next()` con status 200 (no 307).
  - Caso A: request a `/en/admin` sin user → `res.status === 307` y `res.headers.get('location')` incluye `/en/login`.
  - Caso B: `getUser()` → `{ data: { user: { id: '...' } } }` → request a `/en/admin` → NO redirige a login (status != 307 o location no es `/login`).
- `src/__tests__/middleware-console.test.ts` (AC-7):
  - Spy `vi.spyOn(console, 'log')`. Togglear `process.env.NODE_ENV`.
  - `production` → invocar middleware → `expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('[Middleware Run]'), ...)`.
  - `development` → `expect(console.log).toHaveBeenCalled()` con `[Middleware Run]`.
  - Mockear igual `@supabase/ssr` y `next-intl/middleware`.

**Verificación W1:** `npx tsc --noEmit` + `npx vitest run src/__tests__/middleware-admin.test.ts src/__tests__/middleware-console.test.ts`.

---

### Wave 2 — CSP (H-4, AC-5) — archivo: `next.config.mjs`

**Cambio:** línea 10 del array `cspDirectives`.
```js
// ANTES (next.config.mjs:10)
"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",

// DESPUÉS
"script-src 'self' https://vercel.live",
```
**NO TOCAR** ninguna otra directiva (`style-src`, `connect-src`, `img-src`, etc.) ni el resto del archivo.

**Test W2:**
- `src/__tests__/csp-headers.test.ts` (AC-5):
  - `next.config.mjs` no exporta `cspDirectives` (es const interna). Opción robusta: leer el archivo como texto (`fs.readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf-8')`), extraer la línea `script-src` con regex, y assert:
    - `expect(scriptSrcLine).not.toContain("'unsafe-inline'")`
    - `expect(scriptSrcLine).not.toContain("'unsafe-eval'")`
    - `expect(scriptSrcLine).toContain("'self'")`
  - (Nota: validar SOLO la directiva `script-src`; `style-src` puede seguir con `'unsafe-inline'` legítimamente.)

**Verificación W2:** `npx tsc --noEmit` + `npx vitest run src/__tests__/csp-headers.test.ts`.

---

### Wave 3 — admin agents auth + zod (H-1 + H-2 + H-3-zod)

#### W3.1 — `src/app/api/admin/agents/route.ts` (AC-1)

1. Eliminar COMPLETO (CD-6): `OPERATOR_ADDRESS` (5), `OWNER_ADDRESS` (6), `ADMIN_WALLETS` (7-12), el import `import { headers } from 'next/headers'` (3).
2. Cambiar import línea 1: `import { NextResponse } from 'next/server'` → `import { NextRequest, NextResponse } from 'next/server'`. Agregar:
   ```ts
   import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
   ```
3. Pegar el helper `verifyAuth` LITERAL (de §3 / `fee/route.ts:30-40`) a nivel módulo.
4. Cambiar firma `export async function GET()` → `export async function GET(request: NextRequest)`.
5. Reemplazar el check de wallet (líneas 17-21) por:
   ```ts
   const auth = await verifyAuth(request, 'listAgents')
   if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })
   ```
6. El resto del handler (supabase select, enrich, summary, líneas 22-74) **NO cambia**. Mantener `export const dynamic = 'force-dynamic'`.

#### W3.2 — `src/app/api/admin/agents/[id]/route.ts` (AC-2 + AC-3)

1. Mismas eliminaciones de wallets/headers que W3.1 (CD-6).
2. Imports:
   ```ts
   import { NextRequest, NextResponse } from 'next/server'
   import { createServiceClient } from '@/lib/supabase/server'
   import { z } from 'zod'
   import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
   ```
3. Pegar `verifyAuth` LITERAL.
4. Schema a nivel módulo (CD-OBL-2, D-A3 `.strict()`):
   ```ts
   const patchSchema = z.object({
     status:               z.enum(['active', 'reviewing', 'draft', 'suspended']).optional(),
     consecutive_failures: z.number().int().optional(),
   }).strict()
   ```
5. Cambiar firma del PATCH a `NextRequest`:
   ```ts
   export async function PATCH(
     request: NextRequest,
     { params }: { params: Promise<{ id: string }> },
   ) {
   ```
6. **Auth ANTES de parsear body** (AC-2: 401 sin firma NO debe mutar DB):
   ```ts
   const auth = await verifyAuth(request, 'updateAgent')
   if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })
   ```
7. Reemplazar el cast (línea 29) + `allowed` array (31-34) por:
   ```ts
   const raw = await request.json().catch(() => null)
   const parsed = patchSchema.safeParse(raw)
   if (!parsed.success) {
     return NextResponse.json({ error: 'Invalid body', detail: parsed.error.flatten() }, { status: 400 })
   }
   const body = parsed.data
   ```
8. El bloque `update` (36-45) y manejo de error (47-51) se mantienen, usando `body.status` / `body.consecutive_failures` ya validados.

**Tests W3:**
- `src/app/api/admin/agents/__tests__/auth.test.ts` (AC-1 ×2):
  - Mockear `@/lib/admin/verifyAdminSignature` (`verifyAdminSignature`) y `@/lib/supabase/server` (`createServiceClient`). NO llamar Redis real.
  - Caso 1: `GET` con header `x-admin-wallet: 0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba` y SIN `x-admin-signature` → `verifyAuth` retorna `Missing admin auth headers` → `res.status === 401`. Confirma que `x-admin-wallet` se ignora.
  - Caso 2: `GET` con los 3 headers EIP-712 presentes + mock `verifyAdminSignature` → `{ ok: true }` + mock `createServiceClient().from()` chain devolviendo agentes → `res.status === 200`.
  - Construir el request con `new NextRequest('http://localhost/api/admin/agents', { headers })` e invocar `GET(request)`.
- `src/app/api/admin/agents/__tests__/patch-auth.test.ts` (AC-2 + AC-3):
  - AC-2: `PATCH` con `x-admin-wallet` spoofeado + body `{ status: 'suspended' }`, SIN firma → `res.status === 401` Y `expect(mockUpdate).not.toHaveBeenCalled()` (prueba no-mutación). Mock `createServiceClient` con un `update` spy en el chain.
  - AC-3a: `PATCH` con firma válida (mock `verifyAdminSignature` → `{ ok: true }`) + body `{ status: 'invalid_value' }` → `res.status === 400`, body tiene `detail`.
  - AC-3b: firma válida + body `{ unknown_field: true }` (sin `status`) → `.strict()` rechaza → `res.status === 400`, `update` NO llamado (no muta, no crashea).
  - `makeParams`: `{ params: Promise.resolve({ id: 'agent-uuid' }) }`. Invocar `PATCH(request, makeParams(...))`.

**Verificación W3:** `npx tsc --noEmit` + `npx vitest run src/app/api/admin/agents/__tests__/`.

---

### Wave 4 — invoke in-process (H-5, AC-6) — la más compleja, va última

#### W4.1 — CREAR `src/lib/invoke/handleInvoke.ts`

**Mover** (no copiar — CD-7) desde `src/app/api/v1/models/[slug]/invoke/route.ts` a este nuevo archivo:
- **El cuerpo del POST** (líneas 151-624) → como `export async function handleInvoke(request: NextRequest, slug: string): Promise<NextResponse>`.
  - El POST actual abre con `const { slug } = await params` (línea 156). En `handleInvoke`, **eliminar esa línea** — `slug` llega como parámetro. El resto del cuerpo (desde `const supabase = createServiceClient()` línea 158 hasta el cierre línea 624) se mueve **bit-exact**, incluyendo los guards de settlement (493-518) [CD-8].
- **Helpers que solo usa el POST:** `extractPaymentFromHeaders` (40-53), `build402Instructions` (63-92), `settleX402` (116-139), `callUpstream` (666-734), `logCall` (736-787), `buildResponse` (788-839).
- **Tipos:** `SupabaseServiceClient` (57), `SettlementResult` (58), `X402PaymentHeader` (98-114).
- **Constantes módulo:** `X402_CORS_HEADERS` (4-9), `CONTRACT_ADDRESS` (24), `CHAIN_ID_NUM` (25), `CHAIN` (27), `USDC_ADDR` (28-30).
- **Imports que viajan con el código movido** (mismo path — CD-3): `createServiceClient` y `createClient` de `@/lib/supabase/server`, `keyHashToBytes32`, `signReceipt`, `settlePaymentX402`/tipos, `validateEndpointUrlAsync`, `getState`/`wrapWithCircuitBreaker`, `retryWithBackoff`, rate-limit helpers, `CHAIN_NAME`/`IS_MAINNET`, `logger`, `calcPlatformOverhead`/`GasSource`, `triggerAgentEvent`, `SITE_URL`, `isAgentInScope`, `validateInput`, `assertPaymentType`, `buildRequirements`, `createHash`, `NextRequest`/`NextResponse`/`after`.
- **NO mover:** GET (627-662) ni OPTIONS (840-842) — quedan en el route.

> Regla mecánica: si un símbolo lo usa **solo** el POST/sus helpers → se mueve. Si lo usa GET u OPTIONS (`createClient`, `SITE_URL`, `CHAIN_NAME`, `CHAIN_ID_NUM`, `CONTRACT_ADDRESS`, `IS_MAINNET`, `X402_CORS_HEADERS`) → se **conserva accesible en el route** (re-import o re-declaración). `X402_CORS_HEADERS`, `CONTRACT_ADDRESS`, `CHAIN_ID_NUM` son usados por ambos → declararlos donde haga falta sin duplicar lógica (pueden exportarse desde `handleInvoke` e importarse en route, o re-importarse de su fuente original `@/lib/constants`/`@/lib/chain`).

#### W4.2 — `src/app/api/v1/models/[slug]/invoke/route.ts` (thin wrapper)

```ts
import { handleInvoke } from '@/lib/invoke/handleInvoke'
// ...imports que GET/OPTIONS necesitan (createClient, SITE_URL, CHAIN_NAME, CHAIN_ID_NUM, CONTRACT_ADDRESS, IS_MAINNET, X402_CORS_HEADERS)...

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  return handleInvoke(request, slug)
}

// GET (627-662) y OPTIONS (840-842) SE MANTIENEN intactos en el route.
```
- **CD-3:** el test `x402-settle-fail.test.ts` importa `{ POST } from '@/app/api/v1/models/[slug]/invoke/route'` y construye un `NextRequest`. Como el POST delega `handleInvoke(request, slug)` con el mismo request, **el test sigue pasando sin modificarlo**. Verificá esto en la regresión.

#### W4.3 — `src/app/api/v1/agents/[slug]/invoke/route.ts` (AC-6)

- **Mantener intacto** el bloque trial/402 (líneas 33-62) [CD-9] y `CORS` (14-18) y `OPTIONS` (20-22).
- **Reemplazar** el bloque `fetch()` (líneas 64-101: desde `const siteUrl = ...` hasta el `return new NextResponse(responseText, ...)`) por llamada in-process. Como `handleInvoke` autentica leyendo `request.headers.get('x-agent-key')` (línea 167 del POST original) pero aquí la key viene en `X-API-Key`, **clonar el request agregando el header `x-agent-key`** (D-B2):
  ```ts
  // apiKey ya está en scope (líneas 31). Clonar request con x-agent-key:
  const fwdHeaders = new Headers(request.headers)
  fwdHeaders.set('x-agent-key', apiKey)
  const clonedBody = await request.clone().text()
  const fwdRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: fwdHeaders,
    body: clonedBody || '{}',
  })

  const res = await handleInvoke(fwdRequest, slug)

  // Re-emitir respuesta con CORS (mismo shape que hoy)
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      ...CORS,
    },
  })
  ```
- **Eliminar:** `siteUrl`, `invokeUrl`, `fetch`, el `AbortSignal.timeout`, el catch 502 (`invoke_proxy_error`), y todo uso de `NEXT_PUBLIC_SITE_URL` [CD-4].
- Agregar import: `import { handleInvoke } from '@/lib/invoke/handleInvoke'`.

**Tests W4:**
- `src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts` (AC-6):
  - `vi.stubGlobal('fetch', vi.fn())`. Mockear `@/lib/invoke/handleInvoke` → `handleInvoke: vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }))`. Mockear `@/lib/supabase/server` (`createServiceClient`) por si entra el path de key.
  - `delete process.env.NEXT_PUBLIC_SITE_URL` (o no setearla).
  - `POST` con header `X-API-Key: wasi_test` y body válido → `res.status === 200` (no 502) Y `expect(fetch).not.toHaveBeenCalled()` Y `expect(handleInvoke).toHaveBeenCalledWith(expect.anything(), 'echo')`.
  - `makeParams`: `{ params: Promise.resolve({ slug: 'echo' }) }`.
- **Regresión obligatoria (CD-3):** correr SIN modificarlos y deben quedar verdes:
  ```
  npx vitest run "src/app/api/v1/models/[slug]/invoke/__tests__" "src/app/api/v1/models/[slug]/__tests__"
  ```
  (4 archivos en `invoke/__tests__`: `invoke-gas-transparency`, `settlement-failure-serialization`, `x402-flag-unset`, `x402-settle-fail`; 2 en `models/[slug]/__tests__`: `invoke-gas-transparency`, `settlement-failure-serialization`.)

**Verificación W4:** `npx tsc --noEmit` + `npx vitest run "src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts" "src/app/api/v1/models/[slug]"`.

---

## 6. Patrones a seguir (exemplars verificados)

| Necesitás | Copiá de | Líneas verificadas |
|-----------|----------|--------------------|
| Helper `verifyAuth` + uso | `src/app/api/admin/fee/route.ts` | 30-40 (helper), 74-75 (uso) |
| Firma `verifyAdminSignature` + tipo | `src/lib/admin/verifyAdminSignature.ts` | 33-46 |
| Zod schema a nivel módulo en ruta admin | `src/app/api/admin/collections/route.ts` | 7, 44-50 |
| Estructura POST/GET/OPTIONS + helpers a mover | `src/app/api/v1/models/[slug]/invoke/route.ts` | POST 151-624, GET 627-662, OPTIONS 840-842, helpers 40-139/666-839 |
| Guards settlement (mover bit-exact) | `src/app/api/v1/models/[slug]/invoke/route.ts` | 493-518 |
| Mocking vi.hoisted + vi.mock por path | `src/app/api/v1/models/[slug]/invoke/__tests__/x402-settle-fail.test.ts` | 11-111 |
| Bloque a reemplazar en proxy agents | `src/app/api/v1/agents/[slug]/invoke/route.ts` | 64-101 (reemplazar), 33-62 (NO tocar) |
| Patrón `makeRequest`/`makeParams` para tests de route | `x402-settle-fail.test.ts` | 163-177 |

---

## 7. Definition of Done (por AC + comando de verificación)

| AC | Done cuando | Verificación |
|----|-------------|--------------|
| AC-1 | `GET /api/admin/agents` 401 sin firma EIP-712 (ignora `x-admin-wallet`), 200 con firma owner. Sin wallets hardcodeadas. | `npx vitest run src/app/api/admin/agents/__tests__/auth.test.ts` |
| AC-2 | `PATCH` 401 sin firma + DB NO mutada (`update` no llamado). `x-admin-wallet` ignorado. | `npx vitest run src/app/api/admin/agents/__tests__/patch-auth.test.ts` |
| AC-3 | Body PATCH validado con zod `.strict()`; `invalid_value`→400 con detail; `unknown_field`→400 sin mutar. | mismo comando (patch-auth) |
| AC-4 | Sin sesión a `/en/admin` → 307 a `/en/login`; con sesión → no redirige. | `npx vitest run src/__tests__/middleware-admin.test.ts` |
| AC-5 | `next.config.mjs` `script-src` sin `unsafe-inline`/`unsafe-eval`. Nonce del middleware intacto. | `npx vitest run src/__tests__/csp-headers.test.ts` |
| AC-6 | Proxy agents resuelve in-process (no 502) sin `NEXT_PUBLIC_SITE_URL`; `fetch` nunca llamado. | `npx vitest run "src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts"` |
| AC-7 | `[Middleware Run]` solo en `development`. | `npx vitest run src/__tests__/middleware-console.test.ts` |

**Gates globales (DEBEN pasar al cerrar):**
```
npm run build
npx tsc --noEmit
npx vitest run src/__tests__/ src/app/api/admin/agents/__tests__/ "src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts" "src/app/api/v1/models/[slug]"
```
- `npm run build` y `npx tsc --noEmit` → 0 errores TS, sin `any` explícito.
- Regresión `models/[slug]` verde **sin modificar** esos tests (CD-3).
- Hardcode de wallets eliminado de AMBAS rutas admin (CD-6). `NEXT_PUBLIC_SITE_URL` ya no aparece en `agents/[slug]/invoke/route.ts` (CD-4): `grep -rn "NEXT_PUBLIC_SITE_URL" "src/app/api/v1/agents/[slug]/invoke/route.ts"` → 0 resultados.

---

## 8. Notas operativas para el Dev

- `src/__tests__/` **no existe** — crealo. `vitest.config.ts` incluye `src/**/*.test.{ts,tsx}`, así que se recoge automáticamente.
- En los tests de middleware, mockear `@supabase/ssr` (`createServerClient`) y `next-intl/middleware` ANTES de importar `middleware` (patrón vi.mock/vi.hoisted como en `x402-settle-fail.test.ts`).
- Para AC-7, `process.env.NODE_ENV` es read-only en algunos setups; usar `vi.stubEnv('NODE_ENV', 'production')` / `vi.unstubAllEnvs()`.
- `WASIAI_OWNER_ADDRESS` + Upstash Redis env pueden faltar en test → por eso TODOS los tests de auth **mockean `verifyAdminSignature`** (no llaman Redis ni recover real).
- TypeScript strict: nada de `any` explícito. Para bodies, `z.infer`/`unknown` + `safeParse`.
