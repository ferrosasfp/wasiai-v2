# Work Item — [WKH-AUDIT-V2] Remediación auditoría profesional — seguridad + calidad

## Resumen

Cerrar 6 hallazgos detectados en auditoría staff-level del 2026-05-29 (calificación actual: B+, objetivo: A+).
Los hallazgos abarcan dos issues críticos de seguridad (admin auth spoofeable + `/admin` sin protección en middleware),
un problema de CSP duplicada/conflictiva, un self-call HTTP innecesario, y dos issues de calidad baja.
Todos los fixes son quirúrgicos y circunscritos a los archivos identificados.

---

## Sizing

- SDD_MODE: full
- Estimación: M
- Branch sugerido: `feat/074-remediacion-auditoria-v2`
- Clasificación NexusAgil: QUALITY (toca auth surface + security headers + middleware)

---

## Hallazgos verificados (con líneas reales al 2026-05-29)

| # | Severidad | Archivo | Líneas verificadas | Descripción |
|---|-----------|---------|-------------------|-------------|
| H-1 | CRÍTICO | `src/app/api/admin/agents/route.ts` | 18-21 | Auth por `x-admin-wallet` header — spoofeable por cualquier cliente |
| H-2 | CRÍTICO | `src/app/api/admin/agents/[id]/route.ts` | 22-25, 29 | Mismo patrón spoofeable + body sin zod |
| H-3 | CRÍTICO/defense-in-depth | `middleware.ts` | 70-75 | `/admin` ausente de `isProtectedRoute` |
| H-4 | MEDIO | `next.config.mjs` | 11 + `middleware.ts` 110 | CSP estática con `unsafe-inline`/`unsafe-eval` debilita el nonce per-request |
| H-5 | MEDIO | `src/app/api/v1/agents/[slug]/invoke/route.ts` | 65, 77 | Self-call HTTP a `/api/v1/models/[slug]/invoke` via `fetch()` |
| H-6 | LOW | `middleware.ts` | 67 | `console.log` en cada request, sin guard `isDev` |

**Nota sobre H-2 línea 29:** El cast `as { status?: string; consecutive_failures?: number }` no tiene validación zod.
El hallazgo de "body sin zod" es independiente del fix de auth — ambos deben resolverse en la misma ruta.

---

## Acceptance Criteria (EARS)

### AC-1 — Autenticación admin por EIP-712 en GET /api/admin/agents

WHEN a request reaches `GET /api/admin/agents`,
the system SHALL reject requests that do not provide a valid EIP-712 signature
(`x-admin-signature`, `x-admin-nonce`, `x-admin-timestamp` headers)
via `verifyAdminSignature()`, responding HTTP 401 if the signature is absent, expired, or from an unauthorized address.

**Test:** enviar `GET /api/admin/agents` con header `x-admin-wallet: 0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba` (sin firma EIP-712) → debe retornar 401. Sin el header y sin firma → 401. Con firma EIP-712 válida del `WASIAI_OWNER_ADDRESS` → 200.

---

### AC-2 — Autenticación admin por EIP-712 en PATCH /api/admin/agents/:id

WHEN a request reaches `PATCH /api/admin/agents/:id`,
the system SHALL reject requests that do not provide a valid EIP-712 signature
via `verifyAdminSignature()`, responding HTTP 401 if the signature is absent, expired, or from an unauthorized address.
The `x-admin-wallet` header SHALL be ignored for authorization purposes.

**Test:** enviar `PATCH /api/admin/agents/[valid-id]` con header `x-admin-wallet: 0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba` y body `{ "status": "suspended" }` (sin firma EIP-712) → debe retornar 401 y NO mutar el agente en DB. Verificar con `GET /api/admin/agents` que el status no cambió.

---

### AC-3 — Body PATCH /api/admin/agents/:id validado con zod

WHEN a request with a valid EIP-712 signature reaches `PATCH /api/admin/agents/:id`,
the system SHALL validate the request body with a zod schema that accepts only
`{ status?: 'active' | 'reviewing' | 'draft' | 'suspended', consecutive_failures?: number }`
and SHALL return HTTP 400 with a zod error detail if the body does not conform.

**Test:** enviar `PATCH /api/admin/agents/[valid-id]` con firma válida y body `{ "status": "invalid_value" }` → 400 con error de validación. Body `{ "unknown_field": true }` con `status` ausente → no debe crashear ni mutar.

---

### AC-4 — Middleware protege rutas `/admin`

WHEN an unauthenticated user (no Supabase session cookie) navigates to any path containing `/admin`,
the system SHALL redirect them to `/{locale}/login` with HTTP 307.

WHILE a Supabase session is valid, the system SHALL allow access to paths containing `/admin`
(auth API-level still verifies EIP-712 separately).

**Test:** request sin cookie de sesión a `/en/admin` → 307 redirect a `/en/login`. Request con sesión válida a `/en/admin` → no redirige (pasa al handler siguiente).

---

### AC-5 — CSP: `unsafe-inline`/`unsafe-eval` eliminados del header estático para scripts

WHEN Next.js serves any page response,
the system SHALL NOT include `unsafe-inline` or `unsafe-eval` in the `script-src` directive
of the `Content-Security-Policy` header emitted by `next.config.mjs`.

WHILE `middleware.ts` emits a per-request nonce-based CSP,
the system SHALL ensure the static CSP header from `next.config.mjs` does not override or
conflict with the nonce directive by removing `script-src` from the static headers config
OR by eliminating `unsafe-inline`/`unsafe-eval` from the static `script-src`.

**Test:** hacer `curl -I https://app.wasiai.io` (o localhost:3001) y verificar que el header `Content-Security-Policy` devuelto no contiene `unsafe-eval` en `script-src`. Confirmar que el nonce per-request sigue presente en la respuesta de middleware.

---

### AC-6 — Invocación de agente sin round-trip HTTP interno

WHEN a request reaches `POST /api/v1/agents/:slug/invoke` with a valid `X-API-Key`,
the system SHALL invoke the canonical agent handler in-process (via shared library function)
WITHOUT performing an outbound HTTP `fetch()` to `${NEXT_PUBLIC_SITE_URL}/api/v1/models/:slug/invoke`.

IF `NEXT_PUBLIC_SITE_URL` is not set or is set to a `localhost` value,
THEN the system SHALL NOT fail silently; the in-process invocation SHALL not require this variable.

**Test:** invocar un agente con API key válida desde un entorno donde `NEXT_PUBLIC_SITE_URL` no está seteado → la invocación debe resolverse correctamente (no 502). Verificar en logs que no hay salida `fetch()` hacia localhost ni hacia sí mismo.

---

### AC-7 — `console.log` en middleware gateado por `isDev`

WHILE `process.env.NODE_ENV !== 'development'`,
the system SHALL NOT emit the `[Middleware Run]` log line on every request.

WHEN `process.env.NODE_ENV === 'development'`,
the system SHALL emit the log line (comportamiento actual preservado para debug).

**Test:** en entorno con `NODE_ENV=production`, verificar que los logs de acceso a páginas no incluyen `[Middleware Run]`. En `NODE_ENV=development`, el log debe aparecer.

---

## Scope IN

| Archivo | Cambio |
|---------|--------|
| `src/app/api/admin/agents/route.ts` | Reemplazar auth por header con `verifyAdminSignature` (EIP-712). Agregar action string `'listAgents'`. |
| `src/app/api/admin/agents/[id]/route.ts` | Reemplazar auth por header con `verifyAdminSignature`. Agregar validación zod del body. Action string `'updateAgent'`. |
| `middleware.ts` | Agregar `/admin` a `isProtectedRoute`. Gatear `console.log` con `isDev`. |
| `next.config.mjs` | Eliminar `unsafe-inline` y `unsafe-eval` de `script-src` en el CSP estático. |
| `src/app/api/v1/agents/[slug]/invoke/route.ts` | Reemplazar `fetch()` interno por llamada in-process a función extraída de `src/lib/invoke/handleInvoke.ts` (nuevo archivo en lib). |
| `src/lib/invoke/handleInvoke.ts` (nuevo) | Extraer la lógica de invocación de `src/app/api/v1/models/[slug]/invoke/route.ts` en una función pura reutilizable. |
| Tests (vitest) | Un test por AC (7 tests mínimo — ver sección Test Plan). |

---

## Scope OUT

- No modificar `src/app/api/admin/disputes/` — usa `ADMIN_SECRET` Bearer, fuera del scope.
- No modificar `src/app/api/admin/collections/` — fuera del scope.
- No modificar `src/app/api/admin/treasury/` — fuera del scope.
- No modificar `src/app/api/v1/models/[slug]/invoke/route.ts` directamente, solo extraer lógica a `lib/`.
- No agregar RLS a nivel Postgres en esta HU.
- No migraciones de DB.
- No refactors fuera de los 6 ítems listados.
- No modificar el flujo x402 ni el settlement batch.
- `src/app/api/admin/status/route.ts` — GET sin auth (lectura pública on-chain), ya documentado así; fuera del scope.

---

## Decisiones técnicas (DT-N)

- **DT-1:** Para H-1 y H-2, usar `verifyAdminSignature` con un `action` string descriptivo (ej. `'listAgents'`, `'updateAgent'`). El patrón ya existe en `settlement/route.ts` y `fee/route.ts` — no inventar variante nueva. El `ADMIN_WALLETS` array con wallets hardcodeadas DEBE eliminarse de ambas rutas.

- **DT-2:** Para H-5 (self-call), la función extraída a `lib/invoke/handleInvoke.ts` debe recibir `(slug: string, apiKey: string, body: unknown): Promise<Response>` como firma mínima. El handler `models/[slug]/invoke/route.ts` pasa a ser un thin wrapper que llama `handleInvoke()`. El handler `agents/[slug]/invoke/route.ts` también llama `handleInvoke()` directamente — sin fetch.

- **DT-3:** Para H-4 (CSP), la opción preferida es eliminar el `script-src` completo del objeto `cspDirectives` en `next.config.mjs` (o setear `script-src 'self'` sin `unsafe-inline`/`unsafe-eval`) y dejar que el middleware nonce sea la única defensa para scripts. La directiva estática sigue siendo útil para `connect-src`, `img-src`, etc. — esas NO se tocan.

- **DT-4:** El guard en `middleware.ts` para `/admin` usa el mismo mecanismo `isProtectedRoute` existente (`routePathname.includes('/admin')`). Vercel Edge Runtime — no hay cambio de runtime.

- **DT-5:** `console.log` en middleware (H-6) se gateo con la variable `isDev` que YA está declarada en `middleware.ts:106` — solo hay que moverla antes de la línea 67 o referenciarla desde allí.

---

## Constraint Directives (CD-N)

- **CD-1:** PROHIBIDO degradar el flujo EIP-712 de las rutas admin que ya lo usan correctamente (`settlement/route.ts`, `fee/route.ts`, `collections/route.ts` si aplica). El fix para H-1 y H-2 debe ser aditivo: copiar el patrón existente, no inventar variante nueva.

- **CD-2:** PROHIBIDO eliminar o debilitar la CSP nonce per-request generada en `middleware.ts:104-126`. El fix de H-4 es solo sobre `next.config.mjs` — `middleware.ts` CSP logic no debe tocarse (salvo el `console.log` de H-6).

- **CD-3:** OBLIGATORIO que el fix de H-5 no rompa los tests existentes en `src/app/api/v1/models/[slug]/invoke/__tests__/` ni en `src/app/api/v1/models/[slug]/__tests__/`. La extracción a `lib/` debe mantener el comportamiento exacto del handler actual.

- **CD-4:** PROHIBIDO usar `NEXT_PUBLIC_*` para cualquier secret o para resolver el `siteUrl` en el fix de H-5. La llamada in-process no debe depender de ninguna env var de URL.

- **CD-5:** OBLIGATORIO que el fix de H-3 (middleware `/admin`) no bloquee las rutas de API `/api/admin/*` — el matcher del middleware ya excluye `/api/` en las líneas 25-33; la adición de `/admin` a `isProtectedRoute` solo afecta rutas de página.

---

## Test Plan (mínimo 1 test por AC)

| AC | Test | Tipo | Archivo sugerido |
|----|------|------|-----------------|
| AC-1 | `GET /api/admin/agents` con `x-admin-wallet` spoofeado → 401 | integration/vitest | `src/app/api/admin/agents/__tests__/auth.test.ts` |
| AC-1 | `GET /api/admin/agents` con firma EIP-712 válida → 200 | integration/vitest | mismo archivo |
| AC-2 | `PATCH /api/admin/agents/[id]` con `x-admin-wallet` spoofeado → 401, agente NO mutado | integration/vitest | `src/app/api/admin/agents/__tests__/patch-auth.test.ts` |
| AC-3 | `PATCH` con firma válida y `body.status = "invalid_value"` → 400 | unit/vitest | mismo archivo |
| AC-4 | Request sin sesión a `/en/admin` → 307 redirect a `/en/login` | unit/vitest (middleware mock) | `middleware.test.ts` o `src/__tests__/middleware-admin.test.ts` |
| AC-5 | Parse del header `Content-Security-Policy` emitido → no contiene `unsafe-eval` en `script-src` | unit/vitest | `src/__tests__/csp-headers.test.ts` |
| AC-6 | Invocar `POST /api/v1/agents/:slug/invoke` sin `NEXT_PUBLIC_SITE_URL` seteado → no 502 | integration/vitest | `src/app/api/v1/agents/[slug]/invoke/__tests__/no-self-call.test.ts` |
| AC-7 | En `NODE_ENV=production`, middleware no emite `[Middleware Run]` | unit/vitest | `src/__tests__/middleware-console.test.ts` |

---

## Missing Inputs

- [resuelto en F2] Arquitectura exacta de `handleInvoke.ts` — el Architect debe decidir si extrae la función completa de `models/[slug]/invoke/route.ts` o solo el núcleo de autenticación/invocación. Alcance a validar: los helpers A-01 internos (`build402Instructions`, etc.) ¿van todos a lib o solo el entry point?
- [resuelto en F2] Confirmar si `GET /api/admin/agents` (listado) debe exigir EIP-712 o si puede ser un GET público con autenticación diferenciada. Postura conservadora del work-item: SÍ exige EIP-712 (paridad con PATCH). Si el humano prefiere otro mecanismo, ajustar en F2.

---

## Análisis de paralelismo

Los 6 fixes son **independientes entre sí** a nivel de archivos tocados:

| Fix | Archivo exclusivo | ¿Bloquea otro fix? |
|-----|------------------|-------------------|
| H-1 + H-2 (auth agents) | `src/app/api/admin/agents/route.ts`, `[id]/route.ts` | No |
| H-3 (middleware /admin) | `middleware.ts` (solo isProtectedRoute + console.log) | No — H-6 también toca middleware pero son líneas distintas; pueden ir en el mismo wave |
| H-4 (CSP next.config) | `next.config.mjs` | No |
| H-5 (self-call) | `invoke/route.ts` + nuevo `lib/invoke/handleInvoke.ts` | No — es el fix más complejo, va en wave separada |
| H-6 (console.log) | `middleware.ts:67` | Puede agruparse con H-3 |

**Wave recomendada (para el Dev en F3):**
- Wave 1: H-3 + H-6 (middleware — mismo archivo, bajo riesgo)
- Wave 2: H-4 (next.config — bajo riesgo, aislado)
- Wave 3: H-1 + H-2 (admin agents auth + zod — mismo patrón, riesgo medio)
- Wave 4: H-5 (self-call extraction — mayor complejidad, va última para que los tests de los waves anteriores estén listos)

**Esta HU no bloquea ni es bloqueada por ningún WKH activo en _INDEX.md.**
WKH-070 (Auth Guard — F2 en curso) toca middleware pero en la sección `isProtectedRoute` de manera compatible: H-3 agrega `/admin` al mismo bloque condicional.
