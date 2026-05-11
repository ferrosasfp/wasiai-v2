# SDD #073 — WAS-V2-2: wasiai-facilitator as primary x402 settler, Ultravioleta DAO as fallback

> SPEC_APPROVED: no
> Fecha: 2026-05-11
> Tipo: feature
> SDD_MODE: full (QUALITY)
> Branch: `feat/was-v2-2-wasiai-facilitator-primary`
> Artefactos: `doc/sdd/073-was-v2-2-wasiai-facilitator-primary/`

---

## 1. Resumen

Hoy `wasiai-v2` resuelve x402 settlements en producción contra Ultravioleta DAO
(`facilitator.ultravioletadao.xyz`), porque la env var `X402_FACILITATOR_URL` de Vercel
apunta a ese host. La tx
`0x5fbf570bbc64d477586bb7aeaa71d5e6a1b4f6c540419172ec5b43f2e77733f2` (mainnet) confirmó
que el operator UVD (`0x46140a86…f9b`) pagó gas en nuestra payment path —
demostrando que el marketplace depende upstream de UVD, no de la facilidad propia
(`wasiai-facilitator-production.up.railway.app`).

Esta HU introduce un **router dual** entre `usdcSettler.settlePaymentX402()` y los
clientes HTTP existentes (`verifyExternal` / `settleExternal`): cuando el toggle
`WASIAI_FACILITATOR_AS_PRIMARY=true` está activo, y la chain del payment cae en una
allowlist hardcoded, el router intenta **wasiai-facilitator primero**; si falla
(5xx, timeout, `CHAIN_UNAVAILABLE`, `INVALID_PAYLOAD`), cae automáticamente a
Ultravioleta. Si el nonce EIP-3009 ya fue consumido (`NONCE_ALREADY_USED` / HTTP 409),
**no hay fallback** — devuelve `verified:true settled:false` y deja que el caller
decida (idempotency guard, CD-5).

Cuando el toggle está OFF (default), el comportamiento es idéntico al main actual:
todo va a `X402_FACILITATOR_URL` (Ultravioleta en prod), zero regression.

**Resultado esperado:**
- Soberanía operacional (gas y operator wallets propios) en chains soportadas
- Resiliencia con fallback automático sin pérdida de payments
- Telemetría granular: `facilitatorUsed`, `fallbackTriggered`, `fallbackReason`, `durationMs`
- Rollout zero-risk: merge con flag OFF, flip por env var cuando ops confirme readiness

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-V2-2 |
| **Tipo** | feature |
| **SDD_MODE** | full (QUALITY) |
| **Categoría de riesgo** | ALTA — payment path con USDC mainnet |
| **Objetivo** | Elevar wasiai-facilitator a PRIMARY con fallback automático a Ultravioleta DAO |
| **Reglas de negocio** | Sin doble-charge, sin retries que consuman nonce, observabilidad estructurada |
| **Scope IN** | router puro + config extend + settler delegation + .env.example + tests |
| **Scope OUT** | wasiai-facilitator repo, uvd-x402-sdk, contracts, RLS migrations, packages/sdk |
| **Missing Inputs** | TODOS RESUELTOS EN SECCIÓN 11 |

### Acceptance Criteria (EARS) — heredados del work-item

> 15 ACs trazables en sección 12.4 (Test Plan). Resumen:
>
> - **AC-1, AC-2** — toggle OFF / malformed → Ultravioleta-only (zero regression)
> - **AC-3, AC-4** — chain in/out of allowlist → routing decision
> - **AC-5** — happy path wasiai (200 + 200)
> - **AC-6, AC-7, AC-8** — fallback triggers (5xx / timeout / known error code)
> - **AC-9** — both fail → estructurado log + `both_failed:true`
> - **AC-10** — idempotency guard (NONCE_ALREADY_USED) — NO fallback
> - **AC-11** — telemetría estructurada `[settler]` con campos extendidos
> - **AC-12** — `.env.example` documenta `WASIAI_FACILITATOR_AS_PRIMARY` + `WASIAI_FACILITATOR_URL`
> - **AC-13, AC-14, AC-15** — ≥15 tests nuevos, zero regression, traceability AC→test

Texto literal de cada AC en `work-item.md` líneas 49–137.

---

## 3. Context Map (Codebase Grounding)

### 3.1 Archivos leídos (verificados con Glob/Read)

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/lib/contracts/usdcSettler.ts` (431L) | settle path completo, donde se inserta el router | wrapper pattern, append-only legacy, tri-state cache, `logger.info('[settler]', {...})` estructurado |
| `src/lib/contracts/x402-facilitator-config.ts` (53L) | env reading patterns, cache tri-state | `let cached: string | null | undefined`, `__resetForTesting()`, lazy read, warn-once |
| `src/lib/contracts/x402-facilitator-client.ts` (245L) | HTTP client, envelope builder, error mapping | `ExternalResult<T>` discriminated union, `mapFacilitatorErrorToSettlementResult`, `KNOWN_FACILITATOR_CODES` set, `CHAIN_TO_EIP155` map |
| `src/lib/contracts/__tests__/x402-facilitator-config.test.ts` (43L) | test pattern config | `vi.resetModules()` + `delete process.env.X`, dynamic `await import()` |
| `src/lib/contracts/__tests__/usdcSettler.x402.test.ts` (243L) | E2E wrapper test pattern | `vi.mock('@/lib/contracts/x402-facilitator-config', ...)`, mock `verifyExternal/settleExternal`, fast `expiredPayload` |
| `src/lib/contracts/__tests__/x402-facilitator-client.test.ts` (212L) | client test pattern | `vi.stubGlobal('fetch', vi.fn())`, `it.each` para tabla error mapping |
| `src/app/api/v1/models/[slug]/invoke/route.ts` (843L) | consumer del settle, ctx construction | `SettlePaymentX402Ctx` constructor en `settleX402()`, `network: 'avalanche' \| 'avalanche-testnet'` literal |
| `.env.example` (96L) | env var conventions | sección `# ─── Pagos x402 ───` líneas 29–35, comentarios bilingües, default unset |
| `packages/sdk/src/_future/x402.ts` (97L) | resolver MI-1 | header `// OUT OF SCOPE — HU futura`, importa `uvd-x402-sdk/backend` que NO está en SDK package.json |
| `packages/sdk/src/_future/handlers/express.ts` (133L) | resolver MI-1 | mismo header, import de `../x402` (dead chain) |
| `packages/sdk/src/_future/handlers/nextjs.ts` (217L) | resolver MI-1 | idem |
| `packages/sdk/src/index.ts` (23L) | resolver MI-1 | exports SOLO `AgentsResource`, `HttpClient`, `invokeAgent` — NO toca `_future/*` |
| `packages/sdk/package.json` (33L) | resolver MI-1 | `"build": "tsup src/index.ts --format cjs,esm --dts --clean"` — entry único, no incluye `_future/*` |
| `package.json` raíz | resolver MI-3 | `"uvd-x402-sdk": "^2.25.0"` declarado pero `grep -r "uvd-x402-sdk" src/` retorna ZERO matches |
| `doc/sdd/WAS-V2-1-auto-blindaje.md` (290L) | aprender de F1 anterior | AB-WAS-V2-1-2 (multi-state guards), AB-WAS-V2-1-3 (append-only), AB-WAS-V2-1-5 (no spread con Zod strict) |
| `doc/sdd/072-wkh-66-v2-thin-proxy/auto-blindaje.md` (113L) | aprender de HU previa | DOM vs Next RequestInit, branch hygiene durante cleanup |

### 3.2 Exemplars verificados

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| `facilitator-router.ts` (NEW) — módulo puro con tri-state config cache + dispatch | `x402-facilitator-config.ts:21-46` (cache lazy + `__resetForTesting`) | mismo módulo, mismo patrón → testabilidad consistente |
| `facilitator-router.ts` dispatch logic | `usdcSettler.ts:363-430` (wrapper `settlePaymentX402`) | discriminación por result.ok + early-return + structured log |
| `facilitator-router.ts` error mapping para idempotency | `x402-facilitator-client.ts:111-136` (`KNOWN_FACILITATOR_CODES` + `mapFacilitatorErrorToSettlementResult`) | hardcoded set de códigos canónicos x402, prefijo `CODE: msg` |
| `__tests__/facilitator-router.test.ts` (NEW) | `__tests__/usdcSettler.x402.test.ts:1-243` | vi.mock per-module + dynamic import + `it.each` para matrix de routing |
| `x402-facilitator-config.ts` MODIFY (extend con `isWasiaiFacilitatorPrimary` + allowlist) | mismo archivo: pattern de `getFacilitatorUrl` líneas 21-46 | tri-state cache + warn-once + lazy reads |
| `.env.example` MODIFY (documentar `WASIAI_FACILITATOR_AS_PRIMARY`) | mismas líneas 29–35 (sección `# ─── Pagos x402 ───`) | header en español, bullets de comportamiento, rollback ops |

### 3.3 Estado de BD relevante

| Tabla | Existe | Relevante |
|-------|--------|-----------|
| `agents`, `agent_calls`, `agent_keys`, `settlement_failures` | Sí | NO se tocan en esta HU — el router opera antes del logCall, no inserta filas nuevas |
| Migraciones nuevas | N/A | NO se requieren — la HU es puramente lógica de routing en memoria |

### 3.4 Componentes reutilizables encontrados

- **`buildX402V2Envelope(payload, ctx)`** en `x402-facilitator-client.ts:84-107` — el router lo invoca UNA vez, no se duplica.
- **`verifyExternal(envelope, url, signal)`** + **`settleExternal(envelope, url, signal)`** en `x402-facilitator-client.ts:230-244` — el router los reusa tal cual, pasándoles distintos `facilitatorUrl` (wasiai vs UVD).
- **`mapFacilitatorErrorToSettlementResult`** en `x402-facilitator-client.ts:124-136` — ya mapea `NONCE_ALREADY_USED` si lo agregamos al set canónico (CD-NEW-SDD-2 abajo).
- **`getFacilitatorUrl()`** en `x402-facilitator-config.ts:24-46` — devuelve la URL de Ultravioleta cuando `X402_FACILITATOR_URL` está set; el router la usa para el path UVD.
- **`logger`** en `@/lib/logger` — mantenemos convención `logger.info('[settler]', { ...campos estructurados })` para no romper Grafana/Sentry histogramas existentes.

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/lib/contracts/x402-facilitator-config.ts` | MODIFY | Extender con `isWasiaiFacilitatorPrimary(): boolean`, `getWasiaiFacilitatorUrl(): string \| null` (lee `WASIAI_FACILITATOR_URL`), `WASIAI_CHAIN_ALLOWLIST` const exportada. `__resetFacilitatorUrlCacheForTesting()` resetea TODAS las caches del módulo. `getFacilitatorUrl()` (Ultravioleta path) permanece intacto (CD-3, CD-8). | mismo archivo líneas 21-46 |
| `src/lib/contracts/facilitator-router.ts` | NEW | Módulo puro: `trySettle(payload, required, ctx)` — dispatch por toggle × allowlist, llama `tryWasiai` y `tryUltravioleta` (helpers internos), aplica idempotency guard (CD-5), emite log estructurado (AC-11). Sin estado de runtime. Sin async module init. | `usdcSettler.ts:363-430` (wrapper) + `x402-facilitator-client.ts:111-136` (error mapping) |
| `src/lib/contracts/usdcSettler.ts` | MODIFY | Refactorizar BODY de `settlePaymentX402()` para delegar `await facilitatorRouter.trySettle(payload, required, ctx)` — firma pública INTACTA (CD-3). Toda la lógica de routing/telemetría sale del settler. Internal path (`settlePaymentDirectly`) sigue siendo invocable desde el router cuando `url === null`. | append-only pattern de AB-WAS-V2-1-3 |
| `.env.example` | MODIFY | En la sección `# ─── Pagos x402 ───` (líneas 29-35), agregar `WASIAI_FACILITATOR_AS_PRIMARY=` con comentario explicando toggle + allowlist + interacción con `X402_FACILITATOR_URL`. `WASIAI_FACILITATOR_URL=` (nueva, opcional) si el operador quiere apuntar wasiai-facilitator a un host distinto. | mismas líneas 29-35 |
| `src/lib/contracts/__tests__/facilitator-router.test.ts` | NEW | ≥15 unit tests cubriendo toda la decision matrix (toggle × chain × wasiai-ok/fail × uvd-ok/fail) + idempotency + telemetry assertions. | `__tests__/usdcSettler.x402.test.ts:1-243` |
| `src/lib/contracts/__tests__/x402-facilitator-config.test.ts` | MODIFY | Agregar tests para `isWasiaiFacilitatorPrimary`, `getWasiaiFacilitatorUrl`, `WASIAI_CHAIN_ALLOWLIST` const inmutabilidad. | mismo archivo |

### 4.2 Modelo de datos

N/A — ningún cambio en BD. Tabla `settlement_failures` ya existe (used by invoke route line 565); el router no la toca.

### 4.3 Componentes / Servicios

```
┌────────────────────────────────────────────────────────────────┐
│ src/app/api/v1/models/[slug]/invoke/route.ts                   │
│   └─> settleX402() construye ctx                                │
│        └─> settlePaymentX402(payload, required, ctx)            │
└──────────────────────┬─────────────────────────────────────────┘
                       │
        ┌──────────────▼────────────────┐
        │ usdcSettler.ts                 │
        │ settlePaymentX402(...) :       │  CD-3 firma intacta
        │  • start = Date.now()          │
        │  • return await trySettle(...) │  ← delegación
        └──────────────┬────────────────┘
                       │
        ┌──────────────▼────────────────────────────────────┐
        │ facilitator-router.ts (NEW)                       │
        │ trySettle(payload, required, ctx) :               │
        │  1. const cfg = readConfigOnce()                  │
        │     cfg = { primary: bool, wasiaiUrl, uvdUrl }    │
        │  2. if !primary || !allowlist.has(ctx.chain)      │
        │       → return tryUltravioleta(payload, ...)      │
        │  3. const wasiaiResult = tryWasiai(payload, ...)  │
        │  4. if wasiaiResult.outcome === 'ok'              │
        │       → return wasiaiResult.result + log          │
        │  5. if wasiaiResult.code === 'NONCE_ALREADY_USED' │
        │       OR HTTP 409 (CD-5)                          │
        │       → return wasiaiResult.result + log          │
        │       (NO fallback, idempotency guard)            │
        │  6. log fallback reason                           │
        │  7. const uvdResult = tryUltravioleta(...)        │
        │  8. log final outcome (both_failed if applicable) │
        │  9. return uvdResult.result                       │
        │                                                   │
        │ tryWasiai(payload, ctx, url) :                    │
        │  • envelope = buildX402V2Envelope(payload, ctx)   │
        │  • signal = AbortSignal.timeout(30_000)           │
        │  • verifyRes = await verifyExternal(envelope,     │
        │                  url, signal)                     │
        │  • if !ok → classify error                        │
        │  • settleRes = await settleExternal(...)          │
        │  • return { outcome, result, code }               │
        │                                                   │
        │ tryUltravioleta(payload, ctx, url) :              │
        │  • if url === null → fall back to                 │
        │      settlePaymentDirectly(payload, required)     │
        │  • else same as tryWasiai but against uvdUrl      │
        └──────────────┬────────────────────────────────────┘
                       │
        ┌──────────────▼────────────────────────────────────┐
        │ x402-facilitator-client.ts (UNCHANGED)            │
        │ • verifyExternal(envelope, url, signal)           │
        │ • settleExternal(envelope, url, signal)           │
        │ • buildX402V2Envelope(payload, ctx)               │
        │ • mapFacilitatorErrorToSettlementResult(...)      │
        └────────────────────────────────────────────────────┘
```

**Por qué módulo nuevo en vez de inline en `usdcSettler.ts`?**
1. Testabilidad: `vi.mock('@/lib/contracts/facilitator-router', …)` aísla el wrapper completo.
2. Single responsibility: settler hace settle, router hace routing.
3. AB-WAS-V2-1-3 (append-only): el body de `settlePaymentX402` se simplifica a `return await trySettle(...)`. El refactor es seguro porque toda la lógica nueva vive en un archivo NUEVO; el archivo legacy solo cambia su delegación.

### 4.4 Flujo principal (Happy Path)

**Toggle OFF — exactly como hoy:**

1. Caller invoca `settlePaymentX402(payload, '1000', ctx)`
2. `settlePaymentX402` invoca `facilitatorRouter.trySettle(payload, '1000', ctx)`
3. Router lee `isWasiaiFacilitatorPrimary()` → `false`
4. Router invoca `tryUltravioleta(payload, ctx, getFacilitatorUrl())`
5. Si `getFacilitatorUrl()` returns null → `settlePaymentDirectly(payload, '1000')`
6. Si returns URL → POST `/verify` + `/settle` contra UVD via `verifyExternal/settleExternal`
7. Log estructurado `{ facilitatorUsed: 'ultravioleta' | 'internal', fallbackTriggered: false }`
8. Return `SettlementResult`

**Toggle ON, chain in allowlist, wasiai OK:**

1-2. Idem
3. `isWasiaiFacilitatorPrimary()` → `true`
4. `WASIAI_CHAIN_ALLOWLIST.has(networkToEip155(ctx.network))` → `true`
5. Router invoca `tryWasiai(payload, ctx, wasiaiUrl)`
6. `verifyExternal` returns ok → `settleExternal` returns ok
7. Log `{ facilitatorUsed: 'wasiai', fallbackTriggered: false, ok: true, durationMs: ... }`
8. Return `{ verified: true, settled: true, transactionHash: settleRes.body.transactionHash }`

**Toggle ON, chain in allowlist, wasiai 5xx → fallback:**

1-5. Idem
6. `verifyExternal` returns `{ ok: false, error: { error: 'CHAIN_UNAVAILABLE: …' } }` (HTTP 5xx classification)
7. Router checks if error is `NONCE_ALREADY_USED` → no
8. Router invoca `tryUltravioleta(payload, ctx, uvdUrl)`
9. UVD returns ok
10. Log `{ facilitatorUsed: 'ultravioleta', fallbackTriggered: true, fallbackReason: 'wasiai_5xx', wasiai_status: <status>, ok: true }`
11. Return `SettlementResult` de UVD

**Toggle ON, chain NOT in allowlist:**

1-3. Idem
4. `WASIAI_CHAIN_ALLOWLIST.has(...)` → `false`
5. Log debug `{ reason: 'chain_not_in_allowlist' }`
6. Router invoca `tryUltravioleta(...)` directo
7. Sin intentos contra wasiai

### 4.5 Flujo de error

**Caso A — both fail (AC-9):**

1. wasiai responde 5xx
2. Router fallback a UVD
3. UVD también responde 5xx (o timeout)
4. Log `{ facilitatorUsed: 'ultravioleta', fallbackTriggered: true, fallbackReason: 'wasiai_5xx', wasiai_outcome: 'fail', uvd_outcome: 'fail', both_failed: true, ok: false, errorCode: <UVD error code> }`
5. Return `{ verified: false, settled: false, error: '<LAST_ERROR from UVD>' }`

**Caso B — idempotency guard (AC-10, CD-5) — CRÍTICO:**

1. wasiai responde HTTP 409 OR body `{ code: 'NONCE_ALREADY_USED' }`
2. `mapFacilitatorErrorToSettlementResult` retorna `{ verified: true, settled: false, error: 'NONCE_ALREADY_USED: …' }`
3. Router INSPECCIONA `extractCode(result.error)` → `'NONCE_ALREADY_USED'`
4. Router NO LLAMA `tryUltravioleta`
5. Log `{ facilitatorUsed: 'wasiai', fallbackTriggered: false, idempotencyGuardTriggered: true, ok: false, errorCode: 'NONCE_ALREADY_USED' }`
6. Return `{ verified: true, settled: false, error: 'NONCE_ALREADY_USED: …' }`

**Caso C — toggle malformed (AC-2):**

1. `process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'mAyBe'`
2. `isWasiaiFacilitatorPrimary()` → cache miss; parse `=== 'true'` → `false`
3. PRIMERA llamada emite `logger.warn('[facilitator-router] WASIAI_FACILITATOR_AS_PRIMARY malformed; defaulting to false', { raw_redacted: 'mAyBe' })` UNA SOLA VEZ (warn-once flag)
4. Subsequente calls usan cache, sin warn
5. Comportamiento = toggle OFF

---

## 5. Decisiones Técnicas (DT)

### DTs heredadas del work-item (aceptadas)

- **DT-A (humano)** — Chain allowlist HARDCODED: `['eip155:2366', 'eip155:2368', 'eip155:43113', 'eip155:43114']`. Aceptada. Vive en `x402-facilitator-config.ts` como `export const WASIAI_CHAIN_ALLOWLIST: ReadonlySet<string> = new Set([...]) as const`.

- **DT-B (humano)** — Feature flag `WASIAI_FACILITATOR_AS_PRIMARY=true|false`. Default `false`. Lectura en `x402-facilitator-config.ts` via `isWasiaiFacilitatorPrimary()`. Tri-state cache reusa el mismo patrón que `getFacilitatorUrl()`.

- **DT-C (humano)** — Fallback INMEDIATO en 5xx/timeout/`CHAIN_UNAVAILABLE`/`INVALID_PAYLOAD`. Sin retries contra wasiai. Aceptada.

- **DT-D (analyst)** — Router como módulo puro `facilitator-router.ts` sin estado runtime. Confirmada y refinada:
  - Caches solo para configuración (toggle, URLs, allowlist) leídas vía helpers de `x402-facilitator-config.ts` — NO se duplican lecturas.
  - Funciones puras: `trySettle`, `tryWasiai`, `tryUltravioleta`, `classifyWasiaiOutcome`, `isIdempotencyGuard`.
  - Test reset helper `__resetRouterCacheForTesting()` NO necesario (sin caches propias; usa las del config).

- **DT-E (analyst)** — `settlePaymentX402()` delega a `facilitator-router.trySettle()`. Firma `(payload, required, ctx) → SettlementResult` INTACTA. Confirmada.

- **DT-F (analyst)** — Idempotency guard inspecciona el error code del resultado wasiai. Refinada: el guard se dispara cuando:
  - `result.error` empieza con `'NONCE_ALREADY_USED:'` (extracción canónica vía `extractCode(error)`)
  - **OR** wasiai responde HTTP 409 (mapeado a `NONCE_ALREADY_USED` por el error map del client — ver DT-G abajo)

### Nuevas DTs (Architect F2)

- **DT-G (Architect F2) — Error classification para fallback:** El router clasifica el outcome de `tryWasiai` en 5 categorías mutuamente exclusivas:

  | Categoría | Trigger | Acción del router |
  |-----------|---------|-------------------|
  | `'ok'` | `verifyExternal.ok && settleExternal.ok` | Return success, NO fallback |
  | `'idempotency_guard'` | error code = `'NONCE_ALREADY_USED'` (sea por body o HTTP 409 mapeado) | Return wasiai's result, NO fallback (CD-5) |
  | `'fallback_5xx'` | HTTP 5xx en verify o settle | Fallback to UVD, log `fallback_reason: 'wasiai_5xx'` |
  | `'fallback_unreachable'` | `'CHAIN_UNAVAILABLE: facilitator unreachable'` (timeout/DNS/abort) | Fallback to UVD, log `fallback_reason: 'wasiai_unreachable'` |
  | `'fallback_known_error'` | error code en `{'CHAIN_UNAVAILABLE', 'INVALID_PAYLOAD'}` (en body, no infrastructure) | Fallback to UVD, log `fallback_reason: 'wasiai_<code_lowercase>'` |

  El router NO inspecciona HTTP status code directamente — `verifyExternal`/`settleExternal` ya mapean a `SettlementResult` con `error: 'CODE: msg'`. El router extrae el code via `extractCode(error)` y lo categoriza.

  **Pendiente:** `mapFacilitatorErrorToSettlementResult` actualmente NO incluye `'NONCE_ALREADY_USED'` en `KNOWN_FACILITATOR_CODES` (set en `x402-facilitator-client.ts:111-122`). Si el facilitator devuelve HTTP 409 con body `{code: 'NONCE_ALREADY_USED'}`, hoy se mapea a `'INVALID_PAYLOAD'` (fallback unknown→INVALID_PAYLOAD line 134). DT-G requiere **agregar `'NONCE_ALREADY_USED'` al set** del client, de modo que el router pueda detectarlo cleanly. Es un cambio mínimo, alineado con CD-8 (no duplicar lecturas/lógica fuera del módulo dueño).

- **DT-H (Architect F2) — Configuración del wasiai URL:** Default hardcoded `'https://wasiai-facilitator-production.up.railway.app'` (chain inmutable conforme AB-WAS-V2-1-4 — same Railway host). Override opcional via env var `WASIAI_FACILITATOR_URL` (NEW). Helper `getWasiaiFacilitatorUrl(): string` siempre devuelve un string válido (nunca null) — usa la default si la env var no está set o está malformada.

  **Por qué default hardcoded y no requerido:** seguir el patrón de WAS-V2-1 donde el operador puede flipar el toggle sin tener que setear N env vars. Reduce surface de error operacional. La env var existe SOLO para tests/staging que apuntan a otro host (`WASIAI_FACILITATOR_URL=https://staging-fac.railway.app`).

- **DT-I (Architect F2) — Telemetría unificada en el router, no en el settler:** Toda la lógica de log estructurado AC-11 se mueve del wrapper `settlePaymentX402` al router. El settler deja UN ÚNICO log: `logger.info('[settler]', { ...result fields })` al final del `trySettle`, dentro del router. Esto evita doble-logging del mismo settlement y reduce confusión de Grafana.

  **Campos del log estructurado (AC-11):**
  - `requestId: string` (heredado del ctx)
  - `agentSlug: string`
  - `facilitatorUsed: 'wasiai' | 'ultravioleta' | 'internal'`
  - `fallbackTriggered: boolean`
  - `fallbackReason?: 'wasiai_5xx' | 'wasiai_unreachable' | 'wasiai_invalid_payload' | 'wasiai_chain_unavailable' | 'chain_not_in_allowlist' | 'toggle_off'`
  - `idempotencyGuardTriggered?: boolean` (true cuando AC-10 dispara)
  - `wasiai_outcome?: 'ok' | 'fail' | 'guard' | 'skipped'`
  - `uvd_outcome?: 'ok' | 'fail' | 'skipped' | 'internal_used'`
  - `both_failed?: boolean` (AC-9)
  - `durationMs: number`
  - `ok: boolean` (`verified && settled`)
  - `errorCode?: string` (extraído del último error vía `extractCode`)

  **NO en el log (CD-4):** signatures, raw authorization payloads, private keys, full envelope. Solo metadata bounded.

- **DT-J (Architect F2) — Network → eip155 mapping:** El router compara `ctx.network` (literal `'avalanche' | 'avalanche-testnet'`) contra `WASIAI_CHAIN_ALLOWLIST`. Como `ctx.network` viene del invoke route que hardcodea solo Avalanche, la comparación contra Kite chains (2366/2368) JAMÁS matchea desde wasiai-v2 hoy. Las Kite entries en el allowlist son **forward-compat** para consumers externos (e.g. wasiai-a2a) que pasen ctx con un network distinto en el futuro.

  Reuso `CHAIN_TO_EIP155` map ya existente en `x402-facilitator-client.ts:79-82` — el router lo importa y traduce `ctx.network → eip155:<id>`. Si el network NO está en el map (chain desconocida), router defaults a `'chain_not_in_allowlist'` y bypassa wasiai. (Defense in depth.)

  **Consecuencia operacional:** mientras `ctx.network` solo sea `'avalanche' | 'avalanche-testnet'`, las entradas Kite del allowlist son inertes pero correctas. El día que un consumer agregue `'kite-mainnet'` al type union de `SettlePaymentX402Ctx.network`, basta con agregar `'kite-mainnet': 'eip155:2366'` al `CHAIN_TO_EIP155` map — el router empieza a routear a wasiai sin cambios adicionales.

---

## 6. Resolución de Missing Inputs (MIs)

### MI-1 — `packages/sdk/src/_future/` in-scope o out-of-scope?

**Decisión: OUT OF SCOPE.** Justificación verificada:

1. `packages/sdk/package.json:20` — build entry es `tsup src/index.ts --format cjs,esm --dts --clean`. NO incluye `_future/*`.
2. `packages/sdk/src/index.ts:1-23` — exports SOLO `WasiAI`, `AgentsResource`, `HttpClient`, `invokeAgent`, types, errors. CERO referencias a `_future/x402` ni handlers.
3. `_future/x402.ts:1` — header literal: `// OUT OF SCOPE — HU futura`. Idem `express.ts:1` y `nextjs.ts:1`.
4. `_future/x402.ts:6-13` — importa `from 'uvd-x402-sdk/backend'`. Pero `packages/sdk/package.json` NO declara `uvd-x402-sdk` en deps ni devDeps. Si `_future/` fuera compilado, el build fallaría con MODULE_NOT_FOUND.
5. `grep -r "_future" packages/sdk` retorna ZERO matches en archivos no-`_future/`. Es código dead.
6. `grep -rE "from .*_future|import .*_future" .` (root) → ZERO matches.

El hardcode `DEFAULT_FACILITATOR = 'https://facilitator.ultravioletadao.xyz'` en esos 3 archivos NO impacta runtime (código no se compila ni ejecuta). Limpiarlo es un nice-to-have pero NO es required para esta HU.

**Recomendación follow-up (no bloqueante):** crear ticket `WAS-V2-3-cleanup-sdk-future-dead-code` para borrar `packages/sdk/src/_future/` por completo. No incluido en esta HU para mantener el blast radius mínimo (paid-path únicamente).

### MI-2 — `CHAIN_TO_EIP155` faltan Kite chains (2366, 2368)

**Decisión: NO extender el map en esta HU.** Justificación:

1. `SettlePaymentX402Ctx.network` está tipado como `'avalanche' | 'avalanche-testnet'` (literal union, `x402-facilitator-client.ts:44`). El compiler RECHAZA cualquier otro valor.
2. El único consumer hoy (`src/app/api/v1/models/[slug]/invoke/route.ts:27,136`) hardcodea `CHAIN = CHAIN_ID_NUM === 43114 ? 'avalanche' : 'avalanche-testnet'`. Wasiai-v2 jamás envía Kite chains en ctx.
3. El router no necesita `CHAIN_TO_EIP155` para tomar la decisión de allowlist: usa el mismo map para traducir `ctx.network` a `eip155:<id>` y luego compara contra `WASIAI_CHAIN_ALLOWLIST`. Las Kite entries del allowlist quedan **inertes pero documentadas** (DT-J).
4. Cuando wasiai-a2a o algún otro consumer agregue Kite support, será una HU separada que expandirá el type union de `network`. Esa HU agregará `'kite-mainnet': 'eip155:2366'` al map. Hoy seríamos especulativos (YAGNI).

**Riesgo aceptado:** si un consumer futuro pasa `ctx.network = 'kite-mainnet'` sin actualizar el map, TypeScript ya rechaza por type narrow. El test `facilitator-router.test.ts` verifica que solo los 4 valores `eip155:*` permitidos están en el set.

### MI-3 — Transport para Ultravioleta fallback

**Decisión: HTTP POST via `verifyExternal/settleExternal` (los mismos clients que wasiai).** Justificación verificada:

1. `grep -rE "import.*uvd-x402-sdk|require.*uvd-x402-sdk" src/` → ZERO matches en runtime code.
2. `uvd-x402-sdk@^2.25.0` aparece en `package.json` root y `_future/x402.ts` ONLY. `_future/` es dead code (ver MI-1).
3. En PRODUCCIÓN HOY, Ultravioleta se consume via `X402_FACILITATOR_URL=https://facilitator.ultravioletadao.xyz` (env Vercel) → `getFacilitatorUrl()` → `verifyExternal/settleExternal` → HTTP POST con envelope x402 v2. **Ya es el transport actual; no hay nada que cambiar.**
4. wasiai-facilitator implementa la misma especificación x402 v2 (envelope Zod `.strict()`, /verify + /settle endpoints, HTTP POST JSON). Esto fue confirmado en WAS-V2-1 (AB-WAS-V2-1-5).

**Resultado:** ambos facilitators usan EXACTAMENTE el mismo client (`verifyExternal/settleExternal`), solo cambia el `facilitatorUrl` argumento. El router pasa `wasiaiUrl` o `uvdUrl` según corresponda.

**No new transport. No new deps. `uvd-x402-sdk` puede quedar en deps por ahora (Scope OUT — no se toca).**

---

## 7. Constraint Directives (Anti-Alucinación)

### Heredados del work-item (CD-1..8)

- **CD-1:** TypeScript strict — cero `any` explícito en archivos nuevos/modificados.
- **CD-2:** Backward compat total — toggle OFF/unset = comportamiento idéntico al main pre-HU.
- **CD-3:** Firma pública `settlePaymentX402(payload, required, ctx) → Promise<SettlementResult>` NO CAMBIA.
- **CD-4:** Logs nunca contienen signatures, private keys, ni authorization payloads completos.
- **CD-5:** Idempotency — `NONCE_ALREADY_USED` / HTTP 409 → NO fallback a UVD. EVITAR DOBLE-CHARGE ON-CHAIN.
- **CD-6:** Chains no-allowlist → UVD es PRIMARY+ONLY. Zero breaking change.
- **CD-7:** Cada AC-1..AC-11 tiene ≥1 test named explícito.
- **CD-8:** `WASIAI_FACILITATOR_URL` (Ultravioleta path, WAS-V2-1) sigue siendo leído SOLO por `getFacilitatorUrl()`. NO duplicar lecturas.

### Nuevos CDs del SDD (CD-9..14)

- **CD-9 (de DT-G) — Error classification single-source:** El router invoca `extractCode(error)` UNA VEZ y switchea sobre el resultado. PROHIBIDO inspeccionar HTTP status codes directamente en el router — esa info ya fue mapeada a `SettlementResult.error` por `x402-facilitator-client.ts`.

- **CD-10 (de DT-I) — Single log emission per settlement:** El log estructurado `[settler]` se emite EXACTAMENTE UNA VEZ por settlement, al final de `trySettle()`. PROHIBIDO emitir logs intermedios info-level desde `tryWasiai` o `tryUltravioleta`. Logs de debug (e.g. `'chain_not_in_allowlist'`) pueden usar `logger.debug` pero NO `logger.info`.

  **Razón:** Grafana cuenta `logger.info('[settler]', ...)` para histogramas de p50/p95. Doble-log infla la métrica.

- **CD-11 (de AB-WAS-V2-1-5) — No spread en envelope builder:** El router NO construye envelopes propios; delega a `buildX402V2Envelope`. PROHIBIDO `...ctx`, `...payload` o `...envelope` en `facilitator-router.ts`. Si esto cambia en el futuro, agregar test que valide `Object.keys(env) === [...schema order]`.

- **CD-12 — `NONCE_ALREADY_USED` debe estar en el set canónico del client:** Agregar `'NONCE_ALREADY_USED'` a `KNOWN_FACILITATOR_CODES` en `x402-facilitator-client.ts:111-122`. Si no está, `mapFacilitatorErrorToSettlementResult` mapea cualquier código desconocido a `'INVALID_PAYLOAD'`, y el router NO puede distinguir idempotency guard de un payload inválido → BUG CRÍTICO (doble-charge potencial).

- **CD-13 — `WASIAI_FACILITATOR_AS_PRIMARY` se lee SOLO en `x402-facilitator-config.ts`:** Heredando el patrón de WAS-V2-1 CD-NEW-SDD-2. PROHIBIDO `process.env.WASIAI_FACILITATOR_AS_PRIMARY` fuera de `x402-facilitator-config.ts`. Tests deben mockear el módulo, no el env var directamente (el cache impediría reset confiable).

- **CD-14 — Append-only para `usdcSettler.ts`:** El refactor del body de `settlePaymentX402` REDUCE líneas (delegación a router) pero NO toca `settlePaymentDirectly()` (líneas 185-338). El diff de las primeras 338 líneas del archivo debe ser **vacío** post-HU. F4 QA valida con `git diff src/lib/contracts/usdcSettler.ts:1-338` → ZERO líneas modificadas.

### Heredados de Auto-Blindajes históricos (proceso)

- **CD-PROC-1 (de AB-WAS-V2-1-2):** Tests combinatoriales — el matrix `toggle × allowlist × wasiai-ok/fail × uvd-ok/fail` produce 2^4 = 16 estados; ≥8 tests cubren cada quadrant relevante. PROHIBIDO `if (verified && settled) return success` sin guards explícitos para los otros 3 cuadrantes.

- **CD-PROC-2 (de AB-WAS-V2-1-5):** Zod `.strict()` upstream → el router NO inyecta keys nuevas al envelope. Reusa `buildX402V2Envelope` sin modificaciones.

### PROHIBIDO general

- NO modificar `wasiai-facilitator` repo
- NO modificar `uvd-x402-sdk` ni `packages/sdk/`
- NO agregar deps nuevas (ningún `npm install`)
- NO refactorizar `x402-facilitator-client.ts` más allá de DT-G (agregar `NONCE_ALREADY_USED` al set)
- NO refactorizar `settlePaymentDirectly()` (líneas 185-338)
- NO leer `process.env.WASIAI_FACILITATOR_AS_PRIMARY` fuera de `x402-facilitator-config.ts`
- NO hardcodear el toggle a `true` ni el wasiaiUrl en imports — todo viene de config helpers
- NO emitir logs duplicados (`[settler]` solo una vez por settlement)
- NO usar `any` (CD-1)
- NO modificar tests existentes salvo si los rompe el refactor (CD-2 backward compat)

---

## 8. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|--------|--------------|---------|------------|
| R-1 | Doble-charge on-chain si el guard `NONCE_ALREADY_USED` falla y se hace fallback a UVD | Baja | **CRÍTICO** (USDC real en mainnet) | CD-12 garantiza el código está en el set canónico; CD-5 + DT-F implementan el guard; test AC-10 valida que `settleExternal` JAMÁS se llama post-409 |
| R-2 | Regresión en payment path actual durante refactor del settler | Media | Alta (toda la facturación pasa por aquí) | CD-14 (append-only en líneas 1-338); CD-2 (toggle OFF = identidad); AC-14 (todos los tests de WAS-V2-1 verdes); test reset helpers en config |
| R-3 | Cache stale del toggle entre tests | Media | Media (false positives/negatives) | `__resetFacilitatorUrlCacheForTesting()` extendido para resetear TODAS las caches; tests usan `vi.resetModules()` antes de cada `await import()` |
| R-4 | `mapFacilitatorErrorToSettlementResult` mapea `NONCE_ALREADY_USED` a `INVALID_PAYLOAD` (por estar fuera del set) | Alta si no se agrega | **CRÍTICO** (R-1 escenario) | CD-12 explícito; verificación en F4 con `grep "NONCE_ALREADY_USED" x402-facilitator-client.ts` retorna match |
| R-5 | Telemetría duplicada infla histogramas Grafana | Media | Bajo (operacional) | CD-10 (single log emission); test asserta `logger.info` called once per settlement |
| R-6 | UVD timing change (latencia adicional cuando wasiai falla → fallback) | Media | Bajo | Both calls usan `AbortSignal.timeout(30_000)`; total budget worst case 60s. Si esto es inaceptable, ops puede bajar timeout futuro. Documentar en `.env.example`. |
| R-7 | El operador olvida setear `OPERATOR_PRIVATE_KEY` en wasiai-facilitator Railway antes del flip | Media | Alta (wasiai-facilitator responde 500 en `/settle` por falta de signer) | Runbook de ops (out of code scope): pre-flip checklist — verificar Railway env, hacer un smoke test con $0.01 USDC en Fuji. AB-WAS-V2-1-4 ya cubre el operator pattern |
| R-8 | El facilitator devuelve un nuevo error code no contemplado | Baja | Bajo | Fallback chain en error classification: códigos desconocidos → `'INVALID_PAYLOAD'` (current behavior). Router los trata como `fallback_known_error` → fallback a UVD (defensive). Log incluye `errorCode` para detectar en producción. |

---

## 9. Dependencias

- **WAS-V2-1 (DONE):** `x402-facilitator-config.ts`, `x402-facilitator-client.ts`, `settlePaymentX402` wrapper — la HU actual EXTIENDE estos archivos sin romperlos.
- **wasiai-facilitator (Railway, DONE):** Servicio `https://wasiai-facilitator-production.up.railway.app` debe estar UP y con `OPERATOR_PRIVATE_KEY` configurada. No es responsabilidad de esta HU; ops verifica vía runbook (R-7 arriba).
- **Ultravioleta DAO facilitator (third party, UP):** `https://facilitator.ultravioletadao.xyz` debe seguir funcionando como hoy. No depende de esta HU.

---

## 10. Waves de Implementación

Reorganización vs work-item: mantenemos 3 waves pero refinamos boundaries.

### Wave 0 (Serial Gate) — config preparation

- W0.1: Modificar `src/lib/contracts/x402-facilitator-config.ts`:
  - Agregar `isWasiaiFacilitatorPrimary(): boolean` (tri-state cache + warn-once para malformed)
  - Agregar `getWasiaiFacilitatorUrl(): string` (default hardcoded + override env, nunca null)
  - Agregar `WASIAI_CHAIN_ALLOWLIST: ReadonlySet<string>` exportada
  - Extender `__resetFacilitatorUrlCacheForTesting()` para resetear TODAS las caches del módulo
- W0.2: Modificar `src/lib/contracts/x402-facilitator-client.ts`:
  - Agregar `'NONCE_ALREADY_USED'` a `KNOWN_FACILITATOR_CODES` (CD-12)
  - Ningún otro cambio en este archivo
- W0.3: Tests para W0.1 y W0.2 en `__tests__/x402-facilitator-config.test.ts` y `__tests__/x402-facilitator-client.test.ts` — extender, no reemplazar tests existentes
- W0.4: Typecheck + tests pasan (`npm run typecheck && npm test -- contracts`)

### Wave 1 (Serial — depende de W0) — Router

- W1.1: Crear `src/lib/contracts/facilitator-router.ts`:
  - Export `trySettle(payload, required, ctx) → Promise<SettlementResult>`
  - Helpers internos: `tryWasiai`, `tryUltravioleta`, `classifyWasiaiOutcome`, `extractFallbackReason`
  - Sin `any`, sin caches propias (delega a `x402-facilitator-config.ts`)
  - Importa `buildX402V2Envelope`, `verifyExternal`, `settleExternal`, `CHAIN_TO_EIP155` de `x402-facilitator-client.ts`
  - Importa `settlePaymentDirectly` de `usdcSettler.ts` (para el caso `getFacilitatorUrl() === null && !isWasiaiFacilitatorPrimary()`)
  - Emite UN log `logger.info('[settler]', { ... })` al final (CD-10)
- W1.2: Crear `src/lib/contracts/__tests__/facilitator-router.test.ts` con ≥15 tests
- W1.3: Typecheck + tests pasan

### Wave 2 (Serial — depende de W1) — Settler delegation + docs

- W2.1: Modificar `src/lib/contracts/usdcSettler.ts`:
  - Body de `settlePaymentX402` se reduce a:
    ```
    return await facilitatorRouter.trySettle(payload, required, ctx)
    ```
  - Remover el logging interno (queda en el router, CD-10)
  - Mantener intactas las líneas 1-338 (CD-14)
- W2.2: Modificar `.env.example`:
  - Sección `# ─── Pagos x402 ───` extendida con comentarios sobre `WASIAI_FACILITATOR_AS_PRIMARY` y `WASIAI_FACILITATOR_URL`
- W2.3: Verificar tests existentes pasan sin modificación (AC-14):
  - `__tests__/usdcSettler.x402.test.ts` (18 tests) — todos PASS
  - `__tests__/x402-facilitator-config.test.ts` (4 tests) — todos PASS
  - `__tests__/x402-facilitator-client.test.ts` (15 tests) — todos PASS
  - Si alguno falla, EVALUAR si es regresión (BLOCKER) o si el test mockea internals del wrapper (acceptable update)
- W2.4: Full typecheck + suite completa pasa

### Dependencias entre waves

| Wave | Depende de | Razón |
|------|-----------|-------|
| W0 | — | Base de configuración + cliente |
| W1 | W0 | router importa helpers de W0.1 + necesita W0.2 para distinguir `NONCE_ALREADY_USED` |
| W2 | W1 | settler delega a router |

**Paralelización: NO.** Las waves son estrictamente secuenciales.

---

## 11. Test Plan

### 11.1 Estructura de tests

| Archivo | Acción | Tests nuevos | AC cubiertos |
|---------|--------|-------------|--------------|
| `__tests__/x402-facilitator-config.test.ts` | EXTEND | ~6 tests | AC-1, AC-2 (config helpers), AC-12 (constants exposure) |
| `__tests__/x402-facilitator-client.test.ts` | EXTEND | ~2 tests | CD-12 (NONCE_ALREADY_USED mapping) |
| `__tests__/facilitator-router.test.ts` (NEW) | NEW | ≥15 tests | AC-1..AC-11 (todas las ACs del matrix) |
| `__tests__/usdcSettler.x402.test.ts` | NO CHANGE | 0 | AC-14 (zero regression) |

**Total nuevos: ≥23 tests. Mínimo AC-13: ≥15.**

### 11.2 Mapping AC → test (CD-7, AC-15)

| AC | Test file | Test name (suggested) |
|----|-----------|----------------------|
| AC-1 | `facilitator-router.test.ts` | `AC-1: toggle unset → routes to ultravioleta, wasiai never invoked` |
| AC-1 | `facilitator-router.test.ts` | `AC-1: toggle = 'false' → routes to ultravioleta` |
| AC-1 | `facilitator-router.test.ts` | `AC-1: toggle = 'FALSE' (case insensitive) → routes to ultravioleta` |
| AC-2 | `facilitator-router.test.ts` | `AC-2: toggle = 'maybe' (malformed) → routes to ultravioleta + warn once` |
| AC-2 | `facilitator-router.test.ts` | `AC-2: malformed toggle does NOT throw at module init` |
| AC-3 | `facilitator-router.test.ts` | `AC-3: toggle on + chain avalanche-testnet (eip155:43113) → wasiai called first` |
| AC-3 | `facilitator-router.test.ts` | `AC-3: toggle on + chain avalanche (eip155:43114) → wasiai called first` |
| AC-4 | `facilitator-router.test.ts` | `AC-4: toggle on + unknown chain → bypasses wasiai, calls ultravioleta directly + logs chain_not_in_allowlist` |
| AC-5 | `facilitator-router.test.ts` | `AC-5: toggle on + chain allowed + wasiai verify+settle ok → returns wasiai txHash, ultravioleta NEVER called` |
| AC-6 | `facilitator-router.test.ts` | `AC-6: wasiai 500 on verify → fallback to ultravioleta + log fallback_reason wasiai_5xx + wasiai_status` |
| AC-6 | `facilitator-router.test.ts` | `AC-6: wasiai 503 on settle → fallback to ultravioleta + log fallback_reason wasiai_5xx` |
| AC-7 | `facilitator-router.test.ts` | `AC-7: wasiai unreachable (CHAIN_UNAVAILABLE) → fallback + log wasiai_unreachable` |
| AC-8 | `facilitator-router.test.ts` | `AC-8: wasiai returns INVALID_PAYLOAD body → fallback + log wasiai_invalid_payload` |
| AC-8 | `facilitator-router.test.ts` | `AC-8: wasiai returns CHAIN_UNAVAILABLE body → fallback + log wasiai_chain_unavailable` |
| AC-9 | `facilitator-router.test.ts` | `AC-9: both wasiai and ultravioleta fail → returns last error + log both_failed:true` |
| AC-10 | `facilitator-router.test.ts` | `AC-10 (CRITICAL): wasiai returns NONCE_ALREADY_USED → NO fallback, returns verified:true settled:false` |
| AC-10 | `facilitator-router.test.ts` | `AC-10 (CRITICAL): wasiai HTTP 409 mapped to NONCE_ALREADY_USED → NO fallback, settleExternal NEVER called on UVD` |
| AC-11 | `facilitator-router.test.ts` | `AC-11: log structure includes facilitatorUsed, fallbackTriggered, fallbackReason, durationMs, ok, errorCode` |
| AC-11 | `facilitator-router.test.ts` | `AC-11: log emitted exactly once per settlement (CD-10)` |
| AC-12 | (manual review) | `.env.example contains WASIAI_FACILITATOR_AS_PRIMARY in # Pagos x402 section` |
| AC-12 | `x402-facilitator-config.test.ts` | `WASIAI_CHAIN_ALLOWLIST is exported and immutable` |
| AC-13 | (aggregate) | All 15+ tests above |
| AC-14 | (regression) | Existing 18 tests in `usdcSettler.x402.test.ts` PASS unchanged |
| AC-15 | (this table) | Each AC traceable to ≥1 named test |
| CD-12 | `x402-facilitator-client.test.ts` | `NONCE_ALREADY_USED is in KNOWN_FACILITATOR_CODES and maps with verified:true (settle phase)` |

### 11.3 Convenciones de tests

- Use `vi.mock('@/lib/contracts/x402-facilitator-config', () => ({ ... }))` + `vi.mock('@/lib/contracts/x402-facilitator-client', ...)` — siguiendo `usdcSettler.x402.test.ts:25-39`
- Use `await import('@/lib/contracts/facilitator-router')` (dynamic) tras `vi.resetModules()` para reset de caches — siguiendo `x402-facilitator-config.test.ts:10-15`
- Use `expiredPayload` fixture cuando se quiera triggear el internal path rápido — siguiendo `usdcSettler.x402.test.ts:53-63`
- Mockear `logger` con `vi.fn()` y assertar `expect(logger.info).toHaveBeenCalledWith('[settler]', expect.objectContaining({ ... }))`
- Assertar contadores de calls explícitamente: `expect(verifyExternal).toHaveBeenCalledTimes(1)` para evitar false positives (un test que cuenta como AC-5 happy path debe también assertar que UVD NO se invocó)

---

## 12. Implementation Readiness Check

```
READINESS CHECK:
[x] Cada AC tiene al menos 1 archivo asociado en sección 4.1 (verified)
[x] Cada archivo en sección 4.1 tiene un Exemplar válido verificado con Glob/Read
[x] No hay [NEEDS CLARIFICATION] pendientes — MI-1, MI-2, MI-3 resueltos en sección 6
[x] Constraint Directives incluyen >3 PROHIBIDO (CD-1..14 + PROC + general → 20+ items)
[x] Context Map tiene >2 archivos leídos (16 archivos en sección 3.1)
[x] Scope IN y OUT explícitos y no ambiguos (sección 4.1, work-item)
[x] No hay BD: N/A — sin migrations
[x] Flujo Happy Path completo (3 sub-flujos en sección 4.4)
[x] Flujo Error definido (3 casos en sección 4.5: both fail, idempotency, toggle malformed)
[x] Test plan con ≥1 test por AC (sección 11.2, traceability matrix)
[x] Risks identificados con mitigación (sección 8, 8 riesgos)
[x] Waves con dependencies claras (sección 10)
[x] Auto-blindajes históricos consultados y aplicados (CD-PROC-1, CD-PROC-2)
```

Si CR/AR encuentra que alguno falla → BLOCKER, regresar a F2.

---

## 13. Notas para el Dev (preview pre-F2.5)

> Estas son **hints**, no el contrato del Story File. El Story File de F2.5 será el contrato definitivo.

1. **Empezá por W0.2 (CD-12).** Agregar `'NONCE_ALREADY_USED'` al set de `x402-facilitator-client.ts` es 1 línea + 1 test. Es la dependencia crítica para AC-10.

2. **Reusar tri-state cache pattern.** El nuevo `isWasiaiFacilitatorPrimary` es estructuralmente idéntico a `getFacilitatorUrl`. Copy-paste-adapt es válido (similar pattern, mismo módulo).

3. **Type narrowing del network → eip155.** El router necesita un helper `networkToEip155(network)` que use el map existente. Si el network NO está en el map (caso defensivo), retornar `null` y el router usa eso como señal de `chain_not_in_allowlist`.

4. **Tests primero o tests después?** Recomendado: TDD por AC. Cada AC del 1 al 11 → escribir el test fallando → implementar la rama del router → ver test pasar → siguiente AC.

5. **`tryWasiai` y `tryUltravioleta` deben retornar un discriminated union estructurado**, no `SettlementResult` directo. Ejemplo conceptual:

   ```
   type SettleAttempt =
     | { outcome: 'ok'; result: SettlementResult }
     | { outcome: 'guard'; result: SettlementResult; code: 'NONCE_ALREADY_USED' }
     | { outcome: 'fail'; result: SettlementResult; reason: FallbackReason; code: string }
   ```

   Esto hace el dispatch en `trySettle` exhaustivo (TS-checked).

6. **No olvidar el caso `getFacilitatorUrl() === null && !primary`.** Es el path que va a `settlePaymentDirectly` (internal). Test AC-1 con `WASIAI_FACILITATOR_AS_PRIMARY` unset Y `X402_FACILITATOR_URL` unset.

7. **CD-14 verificación:** después de modificar `usdcSettler.ts`, ejecutar:
   ```
   git diff src/lib/contracts/usdcSettler.ts
   ```
   y verificar que los cambios estén SOLO en las líneas 340+ (la sección `WAS-V2-1: External facilitator opt-in wrapper`). Las líneas 1-338 deben tener diff vacío.

---

## 14. Uncertainty Markers

| Marker | Sección | Descripción | Bloqueante? |
|--------|---------|-------------|-------------|
| (ninguno) | — | Todos los MIs resueltos en sección 6. Todas las DTs (A..J) decididas en sección 5. | NO |

> Gate: NINGÚN `[NEEDS CLARIFICATION]` pendiente. Listo para SPEC_APPROVED humano.

---

## 15. Referencias

- Work item: `doc/sdd/073-was-v2-2-wasiai-facilitator-primary/work-item.md`
- Pre-requisito: `doc/sdd/WAS-V2-1-external-facilitator-optin.md` (DONE)
- Auto-blindajes históricos:
  - `doc/sdd/WAS-V2-1-auto-blindaje.md` (AB-WAS-V2-1-2 multi-state, AB-WAS-V2-1-3 append-only, AB-WAS-V2-1-5 no spread)
  - `doc/sdd/072-wkh-66-v2-thin-proxy/auto-blindaje.md`
- Project context: `.nexus/project-context.md` (stack, golden path, ownership patterns)
- Tx evidencia decisión humana: `0x5fbf570bbc64d477586bb7aeaa71d5e6a1b4f6c540419172ec5b43f2e77733f2`
- Operadores:
  - Ultravioleta: `0x46140a86c01d930d2eaa9be7b4833d42b72c5f9b`
  - WasiAI (wasiai-facilitator Railway): `0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba`
- Facilitators:
  - wasiai-facilitator: `https://wasiai-facilitator-production.up.railway.app`
  - Ultravioleta DAO: `https://facilitator.ultravioletadao.xyz`

---

*SDD generado por nexus-architect F2 — 2026-05-11 — WAS-V2-2*
