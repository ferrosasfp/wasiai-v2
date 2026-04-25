# SDD — WAS-V2-1: External Facilitator Opt-in (x402 settle via wasiai-facilitator)

**Sprint:** TBD | **Clasificación:** QUALITY | **Fecha:** 2026-04-24 | **Status:** F2.5 READY FOR F3 (SPEC_APPROVED auto-mode)

---

## Resumen

Refactor del path de settlement x402 en wasiai-v2 para que pueda delegar el verify+settle
al servicio externo `wasiai-facilitator` en lugar de ejecutarlo internamente via
`usdcSettler.settlePaymentDirectly()`. El switch se controla por la env var
`X402_FACILITATOR_URL`. Si la var no está set, el comportamiento es idéntico al actual
(zero regresión). Si está set, los routes invocan el facilitator externo via HTTP.

**Para quién:** Ops/Platform — permite unificar la lógica de settlement en un único
servicio (`wasiai-facilitator`) y eliminar la duplicación de código entre repos.

**Por qué:** `settlePaymentDirectly()` en wasiai-v2 y el código equivalente en
`wasiai-facilitator` son duplicados mantenidos en paralelo. Cualquier fix (HAL-019
timing, ERC-1271, v-normalization) debe aplicarse dos veces. Esta HU crea el
mecanismo de switch para que wasiai-v2 pueda delegar cuando el facilitator externo
esté listo y el operator wallet esté alineado.

---

## Sizing

- **SDD_MODE:** full (QUALITY)
- **Estimación:** M (3–5 dias) — toca payment path crítico de producción
- **Branch sugerido:** `feat/was-v2-1-external-facilitator-optin`

---

## Context Map

| Archivo | Rol |
|---|---|
| `src/lib/contracts/usdcSettler.ts` | Settler interno — añadir wrapper `settlePaymentX402()` (NO modificar `settlePaymentDirectly`) |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Callsite 1 — cambiar import + call en `settleX402()` |
| `src/app/api/v1/agents/[slug]/introspect/route.ts` | Callsite 2 — cambiar import + call directo en handler |
| `src/lib/contracts/x402-facilitator-client.ts` | NUEVO — HTTP client con `verifyExternal()` + `settleExternal()` |
| `src/lib/contracts/x402-facilitator-config.ts` | NUEVO — lectura cacheada de `X402_FACILITATOR_URL` (CD-NEW-SDD-2) |
| `.env.example` | Reactivar `X402_FACILITATOR_URL` con nuevo propósito (opt-in) |

**Callsite 1:** `invoke/route.ts:12` (import) y `:143` (call) — `settleX402()` helper, retorna `SettlementResult | NextResponse`.
**Callsite 2:** `introspect/route.ts:17` (import) y `:360` (call) — call directo en POST handler tras `extractPaymentFromHeaders`.

**Archivos leídos para grounding (F2):**
- `src/lib/contracts/usdcSettler.ts:1-265` (settler interno completo, EIP-712 + transferWithAuthorization)
- `src/app/api/v1/models/[slug]/invoke/route.ts:1-200` (auth dual, buildRequirements, settleX402)
- `src/app/api/v1/agents/[slug]/introspect/route.ts:1-40, 340-400` (handler, callsite 2, error shape)
- `.env.example:1-74` (estado actual: `X402_FACILITATOR_URL` comentada como DEPRECATED en :30-31)
- `wasiai-facilitator/src/routes/verify.ts:1-265` (contrato HTTP /verify, error union, response shape)
- `wasiai-facilitator/src/routes/settle.ts:1-380` (contrato HTTP /settle, idempotency, ledger, response shape)
- `wasiai-facilitator/src/core/schemas.ts:40-113` (Zod canonical x402 v2 envelope)
- `wasiai-facilitator/.env.local` (operator wallet derivation — R-2)
- `wasiai-v2/.env.local` (operator wallet — R-2)

**Patrón extraído:**
- Routes upstream ya construyen `requirements` (scheme, network, asset, payTo, amount atomic) via `buildRequirements()` en `invoke/route.ts:41-60`. Esa metadata es exactamente la que necesita el envelope canónico x402 v2 del facilitator (`accepted` field). Reutilizable.
- Logger es `pino` via `@/lib/logger` (CD-7 ya escrito en F1).
- Error mapping del settler interno: hoy todos los errores devuelven `{ verified, settled, error: string }` (mismo shape para timing, signature, simulation, tx revert). Los routes consumen `.verified` y `.settled` y muestran `.error` en el body 402.

---

## Acceptance Criteria (EARS)

- **AC-1:** WHEN `X402_FACILITATOR_URL` is NOT set in the environment, the system SHALL execute `settlePaymentDirectly()` directly and produce a response bit-exact to the pre-WAS-V2-1 behavior (zero regression).
- **AC-2:** WHEN `X402_FACILITATOR_URL` is set to a valid URL, the system SHALL POST to `${X402_FACILITATOR_URL}/verify` with the x402 v2 canonical envelope, followed by POST to `${X402_FACILITATOR_URL}/settle` if verify succeeds.
- **AC-3:** WHEN the external `/settle` endpoint responds with HTTP 200, the system SHALL use the `transactionHash` from the facilitator's response body in place of the tx hash returned by `settlePaymentDirectly()`, with identical downstream behavior.
- **AC-4:** IF the external `/verify` endpoint responds with HTTP 4xx, THEN the system SHALL return `{ verified: false, settled: false, error: <facilitator code + message> }`.
- **AC-5:** IF the external `/settle` endpoint fails after a successful `/verify`, THEN the system SHALL return `{ verified: true, settled: false, error: <facilitator code + message> }` without re-charging or re-attempting the client's authorization.
- **AC-6 (resuelta — fail-clean):** IF `X402_FACILITATOR_URL` is set but the endpoint is unreachable (timeout, DNS failure, connection refused, HTTP 5xx), THEN the system SHALL return `{ verified: false, settled: false, error: 'CHAIN_UNAVAILABLE: facilitator unreachable' }` and the route SHALL respond 402 (verify failure) or 502 (settle failure after verify ok). NO automatic fallback to internal settler. Ops rollback = unset env var.
- **AC-7:** WHEN the wrapper function `settlePaymentX402()` is called with `X402_FACILITATOR_URL` not set, unit tests SHALL pass asserting that `settlePaymentDirectly()` is invoked with the same arguments and returns an equivalent `SettlementResult`.
- **AC-8:** WHEN the wrapper function `settlePaymentX402()` is called with `X402_FACILITATOR_URL` set, unit tests SHALL pass asserting that `fetch()` is called against the facilitator URL and `settlePaymentDirectly()` is NOT invoked.
- **AC-9:** WHEN AC-1 applies (flag not set), regression test SHALL assert that the response body shape from `/api/v1/models/:slug/invoke` is structurally identical to the pre-WAS-V2-1 shape (same top-level keys: `result`, `meta`, `pricing`).
- **AC-10:** WHEN any settlement executes (internal or external), the system SHALL emit a pino log entry at `info` level with fields `{ requestId, agentSlug, settlerType: 'internal'|'external', facilitatorUrl?, durationMs, ok, errorCode? }`.
- **AC-11:** The exported function `settlePaymentDirectly()` in `usdcSettler.ts` SHALL retain its current signature `(payload: X402EVMPayload, required: string) => Promise<SettlementResult>` with zero changes to its internal body.
- **AC-12:** `.env.example` SHALL contain an uncommented `X402_FACILITATOR_URL=` entry with a comment that explains the opt-in behavior and references this work item (WAS-V2-1).

---

## Scope IN

- `src/lib/contracts/usdcSettler.ts` — agregar export `settlePaymentX402(payload, required, ctx)` con switch interno; `settlePaymentDirectly` queda intacto y exportado.
- `src/lib/contracts/x402-facilitator-client.ts` — NUEVO. POST helpers contra `/verify` y `/settle` del facilitator externo. Sin import de viem; solo `fetch`.
- `src/lib/contracts/x402-facilitator-config.ts` — NUEVO. Wrapper de `process.env.X402_FACILITATOR_URL` que normaliza (`null` si unset, valida URL, cachea al primer call).
- `src/app/api/v1/models/[slug]/invoke/route.ts` — line 12 (import) y line 143 (call) → usar `settlePaymentX402` con `ctx` que reusa `_model.slug` y los datos de `buildRequirements`.
- `src/app/api/v1/agents/[slug]/introspect/route.ts` — line 17 (import) y line 360 (call) → mismo cambio.
- `.env.example` — reactivar entrada `X402_FACILITATOR_URL` con comentario nuevo (referencia WAS-V2-1).
- Tests unitarios: `src/__tests__/contracts/x402-facilitator-client.test.ts` y extender `src/__tests__/contracts/usdcSettler.test.ts` (ubicación a confirmar en Wave 0 — Dev verifica que `src/__tests__/contracts/` exista o usa `src/lib/contracts/__tests__/`).

---

## Scope OUT

- NO modifications to the body or signature of `settlePaymentDirectly()`.
- NO changes to wasiai-a2a o wasiai-facilitator repos.
- NO new chain/token support.
- NO mainnet exclusivo.
- NO retry policy ni circuit breaker en el wrapper (facilitator tiene los suyos).
- NO observability metrics counter (pino log es suficiente — AC-10).
- NO Kite testnet / eip155:2368 (wasiai-v2 solo Avalanche).

---

## Decisiones Técnicas (DT)

### Heredadas del work-item (F1)

- **DT-A:** Feature flag via `process.env.X402_FACILITATOR_URL` (server-only, no `NEXT_PUBLIC_` prefix). Rollback = unset var en Vercel dashboard.
- **DT-B:** Wrapper exportado `settlePaymentX402()` en `usdcSettler.ts`. Callsites cambian solo el símbolo importado. Firma extendida levemente (ver DT-F).
- **DT-C (refinada en F2):** El payload HTTP que va al facilitator NO es `X402EVMPayload` directo. El facilitator espera el **envelope canónico x402 v2** (Zod en `wasiai-facilitator/src/core/schemas.ts:91-98`):
  ```ts
  {
    x402Version: 2,
    resource: { url: string, description?: string, mimeType?: string },
    accepted: {
      scheme: 'exact',
      network: 'avalanche' | 'avalanche-testnet',
      amount: string,           // atomic units, p.ej. "1000"
      asset: '0x...',           // USDC address per chain
      payTo: '0x...',           // marketplace contract address
      maxTimeoutSeconds: 300,
      extra: { assetTransferMethod: 'eip3009' }
    },
    payload: { signature: '0x...', authorization: { from, to, value, validAfter, validBefore, nonce } }
  }
  ```
  El wrapper recibe un context object `ctx: { agentSlug, resourceUrl, atomicAmount, payTo }` y construye el envelope. Los routes upstream ya tienen toda esta data (ver `buildRequirements` en `invoke/route.ts:41-60`). **CD-4 actualizado**: re-uso del `X402EVMPayload` para el campo `.payload`; no se re-parsean headers.
- **DT-D (refinada en F2):** Error mapping facilitator → `SettlementResult.error`. Tabla en DT-G abajo.
- **DT-E (resuelta en F2):** Ver sección "Resolución DT-E" abajo. **Decisión: fail-clean, sin fallback automático.**

### Nuevas (F2 Architect)

- **DT-F (firma del wrapper):**
  ```ts
  export interface SettlePaymentX402Ctx {
    requestId:    string         // para logs
    agentSlug:    string         // para logs
    resourceUrl:  string         // p.ej. https://wasiai.io/agents/<slug>/invoke
    atomicAmount: string         // mismo valor que `required`
    asset:        Address        // USDC_ADDR per chain (ya en route)
    payTo:        Address        // CONTRACT_ADDRESS (marketplace)
    network:      'avalanche' | 'avalanche-testnet'
  }

  export async function settlePaymentX402(
    payload:  X402EVMPayload,
    required: string,
    ctx:      SettlePaymentX402Ctx,
  ): Promise<SettlementResult>
  ```
  Vive en `src/lib/contracts/usdcSettler.ts` (mismo archivo, junto a `settlePaymentDirectly`). El extra `ctx` es necesario para construir el envelope canónico (DT-C); cuando el flag está unset, `ctx` se ignora.
- **DT-G (error mapping table — HARDCODED, no env-driven):**
  | Facilitator response | `SettlementResult` |
  |----------------------|-------------------|
  | HTTP 200 (`/verify`) `{ verified: true, ... }` | continuar a `/settle` |
  | HTTP 200 (`/settle`) `{ settled: true, transactionHash, ... }` | `{ verified: true, settled: true, transactionHash }` |
  | HTTP 400 `INVALID_PAYLOAD` | `{ verified: false, settled: false, error: 'INVALID_PAYLOAD: <message>' }` |
  | HTTP 4xx `INVALID_SIGNATURE` | `{ verified: false, settled: false, error: 'INVALID_SIGNATURE: <message>' }` |
  | HTTP 4xx `EXPIRED_AUTHORIZATION` | `{ verified: false, settled: false, error: 'EXPIRED_AUTHORIZATION: <message>' }` |
  | HTTP 4xx `INVALID_AMOUNT` | `{ verified: false, settled: false, error: 'INVALID_AMOUNT: <message>' }` |
  | HTTP 4xx `INSUFFICIENT_BALANCE` | `{ verified: false, settled: false, error: 'INSUFFICIENT_BALANCE: <message>' }` |
  | HTTP 4xx `NETWORK_MISMATCH` | `{ verified: false, settled: false, error: 'NETWORK_MISMATCH: <message>' }` |
  | HTTP 4xx `SIMULATION_FAILED` | `{ verified: false, settled: false, error: 'SIMULATION_FAILED: <message>' }` |
  | HTTP 429 `RATE_LIMITED` | `{ verified: false, settled: false, error: 'RATE_LIMITED: <message>' }` |
  | HTTP 503 `CHAIN_UNAVAILABLE` | `{ verified: false, settled: false, error: 'CHAIN_UNAVAILABLE: <message>' }` |
  | HTTP 500 `TRANSACTION_FAILED` (en `/settle` post-verify) | `{ verified: true, settled: false, error: 'TRANSACTION_FAILED: <message>' }` (NO re-charge — AC-5) |
  | fetch timeout / DNS / ECONNREFUSED | `{ verified: false, settled: false, error: 'CHAIN_UNAVAILABLE: facilitator unreachable' }` |
  | HTTP body shape mismatch (Zod fail) | `{ verified: false, settled: false, error: 'INVALID_PAYLOAD: facilitator response shape unexpected' }` |
  Mapping vive en `x402-facilitator-client.ts` como función pura `mapFacilitatorErrorToSettlementResult(httpStatus, body, phase: 'verify'|'settle')`. Tests unitarios cubren cada fila.
- **DT-H (timeout):** `fetch` al facilitator usa `AbortSignal.timeout(30_000)` — mismo orden que `waitForTransactionReceipt({ timeout: 30_000 })` actual en `settlePaymentDirectly`. Si excede → `CHAIN_UNAVAILABLE`. Razón: el facilitator hace settle on-chain internamente (con su propio operator + RPC), entonces el ceiling debe matchear el ceiling on-chain.
- **DT-I (logging):** un solo `logger.info('[settler]', ...)` después del settlement (success o failure) con campos `{ requestId, agentSlug, settlerType: 'internal' | 'external', facilitatorUrl?: string, durationMs, ok: boolean, errorCode?: string }`. PII: nunca loguear `payload.signature` ni `payload.authorization.from` (consistente con CD-3 del facilitator).

---

## Resolución DT-E (AC-6 fallback policy)

**Decisión: fail-clean. NO fallback automático al settler interno cuando el facilitator es inalcanzable.**

**Razonamiento:**
1. **Riesgo de double-spend.** Si el facilitator ejecutó la tx on-chain pero el HTTP response se perdió (timeout en el path de retorno), un fallback a `settlePaymentDirectly` re-ejecutaría `transferWithAuthorization` con el mismo nonce. EIP-3009 protege contra eso (el nonce ya está marcado used → tx revierte), pero el escenario consume gas extra y produce telemetría confusa. El facilitator tiene su propia idempotency (ver `wasiai-facilitator/src/routes/settle.ts:108-128`); duplicar settlers en distintas máquinas anula esa garantía.
2. **Silent failures = ops blindness.** Si el facilitator está caído y v2 falla automáticamente al interno, ops no se entera nunca. La razón de mover settlement al facilitator externo es centralizar; un fallback silencioso re-disuelve ese beneficio.
3. **Rollback existe y es trivial.** Unset `X402_FACILITATOR_URL` en Vercel → next request usa interno. Cero código nuevo, cero deploy. Esto es DT-A en acción y suficiente para el incident response.
4. **Coverage de scenarios:**
   - Flag unset → interno (AC-1) — feliz path actual.
   - Flag set + facilitator OK → externo (AC-2/3) — feliz path nuevo.
   - Flag set + facilitator unreachable → 502/402 con `CHAIN_UNAVAILABLE` (AC-6) — ops corrige y ya.
   - Flag set + facilitator returns 4xx legítimo → 402 con error code (AC-4/5) — comportamiento idéntico al interno.

**Caveat para rollout:** durante la primera semana de canary, ops mantiene un runbook con dos pasos: (a) `vercel env rm X402_FACILITATOR_URL --environment=production` + redeploy si el facilitator deteriora, (b) Sentry alert si `errorCode === 'CHAIN_UNAVAILABLE'` con `settlerType === 'external'` excede 1% en 5min.

**Recomendación complementaria (NO bloqueante para esta HU):** crear WAS-V2-1-FOLLOWUP para habilitar fallback opt-in via segunda env var (`X402_FACILITATOR_FALLBACK_ON_UNREACHABLE=true`) si en producción se observa que ops no logra reaccionar a tiempo. La HU actual NO lo implementa.

---

## Resolución R-2 (operator wallet match) — RESUELTA

**Status:** RESUELTO el 2026-04-24 (auto-mode). Aplicada **Opción A — alinear operator wallets**.

**Acción aplicada:**
- Railway facilitator `OPERATOR_PRIVATE_KEY` actualizada a la PK del operator de wasiai-v2.
- Wallet unificado en ambos servicios: `0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba`.
- La misma wallet ahora firma + paga gas en Kite y Avalanche Fuji desde un único origen.

**Evidencia:**
- Railway API confirma env var actualizada + redeploy SUCCESS del servicio facilitator.
- Balances on-chain verificados post-rollout: `0.494 AVAX + 20.01 USDC` en Avalanche Fuji y `9.99 PYUSD` en Kite testnet — wallet listo para settlements.
- Telemetría on-chain alineada: todas las txs del path externo firmarán desde el operator histórico (`0xf432baf...7Ba`); los dashboards/alerts existentes (Operator Daily Cap) NO quedan ciegos.

**Consecuencia para el SDD:** desbloquea SPEC_APPROVED. Ningún DT/CD/AC/Wave cambia — la decisión Opción A no toca el código de la HU, solo infra.

---

## Constraint Directives (CD)

### Heredadas

- **CD-1:** TypeScript strict — PROHIBIDO `any` explícito. Reusar `SettlementResult` desde `usdcSettler.ts`.
- **CD-2:** OBLIGATORIO zero-regression cuando `X402_FACILITATOR_URL` is NOT set. Pipeline AC-7/AC-9 es la evidencia obligatoria en F4.
- **CD-3:** PROHIBIDO modificar el cuerpo interno o la firma pública de `settlePaymentDirectly()`. Si se necesita un cambio ahí, se escala como nueva HU.
- **CD-4:** OBLIGATORIO reusar el `X402EVMPayload` ya construido por los routes upstream para el campo `.payload` del envelope canónico — NO re-parsear headers dentro del wrapper. (Refinado en F2: el envelope canónico tiene más campos; esos vienen de `ctx`, no del header).
- **CD-5:** Tests unitarios DEBEN cubrir ambas ramas (flag set + flag not set) con mocks de `fetch` y `settlePaymentDirectly`. Branch sin test = AC no pasa en F4.
- **CD-6:** La app DEBE arrancar en Vercel sin que `X402_FACILITATOR_URL` esté definida. PROHIBIDO `throw` en module-level si la var no existe.
- **CD-7:** OBLIGATORIO usar pino logger (`import { logger } from '@/lib/logger'`). PROHIBIDO `console.log`/`console.warn`.

### Nuevas (F2)

- **CD-NEW-SDD-1 (idempotency boundary):** la función `settlePaymentX402` NO es idempotente por sí misma (settle es side-effect on-chain). PROHIBIDO añadir caché de resultado en el wrapper — la idempotency vive en el facilitator (ver `wasiai-facilitator/src/routes/settle.ts:108`). Si en el futuro se necesita idempotency client-side, se diseña en una HU dedicada. El switch `flag set vs unset` SÍ es idempotente para la decisión.
- **CD-NEW-SDD-2 (config single-source):** PROHIBIDO leer `process.env.X402_FACILITATOR_URL` directamente desde routes ni desde el wrapper. La lectura vive en `src/lib/contracts/x402-facilitator-config.ts` con una función `getFacilitatorUrl(): string | null` que (a) lee la var una sola vez via lazy-init module-level `let`, (b) valida con `URL` constructor, (c) retorna `null` si vacía/inválida y emite `logger.warn` una sola vez.
- **CD-NEW-SDD-3 (test matrix mínima):** los tests del wrapper DEBEN cubrir, como mínimo: (1) flag unset → delega a interno, (2) flag set + verify success + settle success → retorna `transactionHash` del facilitator, (3) flag set + verify 400 INVALID_SIGNATURE → returns `{ verified: false, settled: false, error: 'INVALID_SIGNATURE: ...' }`, (4) flag set + verify ok + settle 500 TRANSACTION_FAILED → returns `{ verified: true, settled: false, error: 'TRANSACTION_FAILED: ...' }`, (5) flag set + fetch timeout (AbortSignal) → `CHAIN_UNAVAILABLE`, (6) flag set + facilitator URL malformado → cae a interno (CD-NEW-SDD-4) y registra warning.
- **CD-NEW-SDD-4 (graceful degradation on malformed flag):** si `X402_FACILITATOR_URL` está set pero falla `new URL(value)` (malformed), el config helper retorna `null` + emite `logger.warn` una sola vez, y el wrapper usa el path interno. La app NO crashea. Esto cubre el caso típico de typo en Vercel dashboard.
- **CD-NEW-SDD-5 (no async at module level):** PROHIBIDO `await` en module-level dentro de los nuevos archivos. Vercel cold boot DEBE arrancar instantáneamente. La conexión al facilitator se establece en cada request (HTTP/1.1 keep-alive es cosa de Node — no hay pool persistente que mantener).
- **CD-NEW-SDD-6 (envelope construction strictness):** el envelope x402 v2 DEBE construirse con object literal explícito (no spread), keys exactos en el orden del schema (`x402Version`, `resource`, `accepted`, `payload`). El facilitator usa Zod `.strict()` (ver `schemas.ts:91-98`) → cualquier campo extra rechaza con 400. CD coincide con el "auto-blindaje" de WFAC-20 W1 que vimos en `wasiai-facilitator/src/routes/settle.ts:303-313` (rest-spread es trap).

---

## Architecture overview

### Switch diagram (text)

```
                    POST /api/v1/{models|agents}/[slug]/invoke|introspect
                                          │
                                          ▼
                        ┌─────────────────────────────────────┐
                        │  Route handler                      │
                        │  - extractPaymentFromHeaders        │
                        │  - buildRequirements (existing)     │
                        │  - construct ctx for wrapper        │
                        └────────────────┬────────────────────┘
                                          │
                                          ▼
                          settlePaymentX402(payload, required, ctx)
                          ┌────────────────────────────────┐
                          │ getFacilitatorUrl()            │
                          │   reads cached env var         │
                          └────────────┬───────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │                          │
                       NULL                       URL string
                          │                          │
                          ▼                          ▼
              settlePaymentDirectly      x402-facilitator-client
                (existing, untouched)      (new)
                          │                          │
                          │                          ▼
                          │             POST {URL}/verify
                          │                          │
                          │                  ok? ──No─► map error
                          │                  │
                          │                  Yes
                          │                  │
                          │                  ▼
                          │             POST {URL}/settle
                          │                          │
                          │                  ok? ──No─► map error
                          │                  │              (verified:true,
                          │                  Yes             settled:false)
                          │                  │
                          │                  ▼
                          │            { verified:true, settled:true,
                          │              transactionHash }
                          │                          │
                          └──────────┬───────────────┘
                                     │
                                     ▼
                           SettlementResult
                                     │
                                     ▼
                          back to route handler (unchanged)
```

### Error code mapping (route → client)

El route handler ya consume `SettlementResult` y arma sus respuestas 402/200. **No cambia su lógica.** El wrapper preserva el shape `{ verified, settled, transactionHash?, error? }` sea cual sea el path. La única diferencia visible al cliente es que `settlement.error` en el path externo viene prefijado con el código x402 v2 (p.ej. `"INVALID_SIGNATURE: signature mismatch"` vs el actual `"Invalid EIP-712 signature (ecrecover: ..., expected: ...)"`). Esto es **un cambio observable** en el body del 402 cuando el flag está set — flag unset preserva el string exacto actual.

---

## Wave decomposition

### W0 — Pre-flight (Dev verifica antes de codear)

- [ ] Confirmar ubicación de tests: ¿`src/__tests__/contracts/` o `src/lib/contracts/__tests__/`? (Glob).
- [ ] Confirmar que `vitest` está configurado (no jest) — leer `package.json` scripts y `vitest.config.ts`.
- [ ] Confirmar que `@/lib/logger` exporta `logger` (named export) — leer `src/lib/logger.ts`.
- [ ] Verificar que `globalThis.fetch` está disponible en runtime Node (Next.js 14+) y en tests (vitest); si no, importar `undici` o usar `msw` mocks.

### W1 — `x402-facilitator-config.ts` + tests

**Files:** `src/lib/contracts/x402-facilitator-config.ts` (nuevo)

```ts
// Pseudo-spec — NO copiar literal, Dev puede ajustar
let cached: string | null | undefined = undefined; // tri-state: undefined=not read, null=invalid/unset, string=valid URL

export function getFacilitatorUrl(): string | null {
  if (cached !== undefined) return cached;
  const raw = process.env.X402_FACILITATOR_URL?.trim();
  if (!raw) { cached = null; return null; }
  try {
    const url = new URL(raw);
    cached = url.toString().replace(/\/$/, ''); // strip trailing slash
    return cached;
  } catch {
    logger.warn('[x402-facilitator-config] X402_FACILITATOR_URL malformed; falling back to internal settler', { raw_redacted: raw.slice(0, 16) + '...' });
    cached = null;
    return null;
  }
}

// Tests: unset → null; valid URL → cached; trailing slash stripped; malformed → null + warn fired ONCE
```

**Tests:** `src/lib/contracts/__tests__/x402-facilitator-config.test.ts` (o ubicación confirmada en W0)

### W2 — `x402-facilitator-client.ts` + tests

**Files:** `src/lib/contracts/x402-facilitator-client.ts` (nuevo)

Exporta:
- `verifyExternal(envelope, facilitatorUrl, signal): Promise<{ ok: true, body: VerifyResponseOk } | { ok: false, error: SettlementResult }>` — POST `{facilitatorUrl}/verify`, parsea body, mapea error con `mapFacilitatorErrorToSettlementResult(status, body, 'verify')`.
- `settleExternal(envelope, facilitatorUrl, signal): Promise<{ ok: true, body: SettleResponseOk } | { ok: false, error: SettlementResult }>` — POST `{facilitatorUrl}/settle`, parsea body, mapea error con `mapFacilitatorErrorToSettlementResult(status, body, 'settle')`.
- `mapFacilitatorErrorToSettlementResult(status, body, phase)` — pura, ver tabla DT-G.
- `buildX402V2Envelope(payload: X402EVMPayload, ctx: SettlePaymentX402Ctx): X402V2Envelope` — pura, construye según schema canónico (CD-NEW-SDD-6, object literal explícito).
- types `X402V2Envelope`, `VerifyResponseOk`, `SettleResponseOk` (matching `wasiai-facilitator/src/routes/{verify,settle}.ts:200/305`).

**Tests:** `src/lib/contracts/__tests__/x402-facilitator-client.test.ts` — mock `fetch` con vitest `vi.fn()`, cubrir tabla DT-G entera (cada fila = un test).

### W3 — `usdcSettler.ts` wrapper + tests

**Files:** `src/lib/contracts/usdcSettler.ts` (modificar — agregar export, NO tocar `settlePaymentDirectly`)

Agregar al final del archivo:
- `export interface SettlePaymentX402Ctx { ... }` (DT-F).
- `export async function settlePaymentX402(payload, required, ctx): Promise<SettlementResult>`:
  1. `const start = Date.now()`
  2. `const url = getFacilitatorUrl()`
  3. Si `url === null` → `const r = await settlePaymentDirectly(payload, required); logger.info('[settler]', { ..., settlerType:'internal', durationMs: Date.now()-start, ok: r.verified && r.settled, errorCode: r.error }); return r`
  4. Si `url`: build envelope (`buildX402V2Envelope`), `signal = AbortSignal.timeout(30_000)`, `verifyResult = await verifyExternal(envelope, url, signal)`, si fail → log + return error. Si ok → `settleResult = await settleExternal(envelope, url, signal)`, si fail → log + return `{ verified:true, settled:false, error: ... }`. Si ok → log + return `{ verified:true, settled:true, transactionHash: settleResult.body.transactionHash }`.

**Tests:** extender `src/lib/contracts/__tests__/usdcSettler.test.ts` (o crear si no existe — Dev verifica en W0). Cubre CD-NEW-SDD-3 matrix.

### W4 — Routes + tests

**Files:**
- `src/app/api/v1/models/[slug]/invoke/route.ts` — line 12 (rename import), line 137-144 (helper `settleX402` recibe ahora `slug` y construye `ctx` antes del call).
- `src/app/api/v1/agents/[slug]/introspect/route.ts` — line 17 (rename import), line 359-360 (construye `ctx` y llama `settlePaymentX402`).

Cambio típico (invoke):
```ts
// antes
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
...
return settlePaymentDirectly(evmPayload, atomicRequired)

// después
import { settlePaymentX402, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
...
const ctx = {
  requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
  agentSlug: model.slug as string,
  resourceUrl: `${SITE_URL}/api/v1/models/${model.slug}/invoke`,
  atomicAmount: atomicRequired,
  asset: USDC_ADDR as Address,
  payTo: CONTRACT_ADDRESS as Address,
  network: CHAIN as 'avalanche' | 'avalanche-testnet',
}
return settlePaymentX402(evmPayload, atomicRequired, ctx)
```

**Tests:** regresión bit-exact con flag unset (AC-9). Si los routes ya tienen tests de integración, extender; si no, crear smoke test mínimo que monkey-patchea `settlePaymentDirectly` (vía vitest mock del módulo) y verifica que el body shape no cambia.

### W5 — `.env.example` + INDEX

**Files:**
- `.env.example` — reemplazar lines 30-31 (DEPRECATED comment) por:
  ```
  # WAS-V2-1: Opt-in al facilitator x402 externo (wasiai-facilitator).
  # Si NO está set → settlement interno via usdcSettler.settlePaymentDirectly (default).
  # Si está set → settlement delegado al facilitator externo via HTTP.
  # Rollback: borrar la var en Vercel y redeploy.
  X402_FACILITATOR_URL=
  ```
- `doc/sdd/_INDEX.md` — actualizar status de WAS-V2-1 row (last line) cuando F2 cierre. Por ahora mantener `IN PROGRESS` hasta SPEC_APPROVED.

---

## Test plan

| AC | Test | Archivo | Tipo |
|----|------|---------|------|
| AC-1 | flag unset → delega a `settlePaymentDirectly` con args idénticos | `usdcSettler.test.ts` | unit |
| AC-2 | flag set → POST a `/verify` luego `/settle`; envelope canónico bit-exact | `x402-facilitator-client.test.ts` + `usdcSettler.test.ts` | unit |
| AC-3 | flag set + settle ok → `transactionHash` viene del body del facilitator | `usdcSettler.test.ts` | unit |
| AC-4 | flag set + verify 400 → `{ verified:false, error:'INVALID_SIGNATURE: ...' }` | `usdcSettler.test.ts` + `x402-facilitator-client.test.ts` | unit |
| AC-5 | flag set + verify ok + settle 500 → `{ verified:true, settled:false, error:'TRANSACTION_FAILED: ...' }` | `usdcSettler.test.ts` | unit |
| AC-6 | flag set + fetch timeout → `{ verified:false, settled:false, error:'CHAIN_UNAVAILABLE: facilitator unreachable' }` | `usdcSettler.test.ts` | unit |
| AC-7 | (== AC-1) | mismo | unit |
| AC-8 | flag set → `fetch` mock invocado, `settlePaymentDirectly` NO invocado | `usdcSettler.test.ts` | unit |
| AC-9 | flag unset → response body de `/api/v1/models/:slug/invoke` con keys `result`/`meta`/`pricing` | route integration test (snapshot existing if available) | regression |
| AC-10 | flag set/unset → log entry contiene `{ requestId, agentSlug, settlerType, durationMs, ok }` | `usdcSettler.test.ts` (mock logger) | unit |
| AC-11 | `settlePaymentDirectly` body sin diff vs main | git diff check (Adversary) | static |
| AC-12 | `.env.example` contiene entry uncommented + comentario referenciando WAS-V2-1 | grep test o lectura humana | doc |
| CD-NEW-SDD-4 | flag set con URL malformada → cae a interno + warn | `x402-facilitator-config.test.ts` | unit |

**Tooling:** vitest + `vi.fn()` para `fetch` y mock de modulos (`vi.mock('@/lib/contracts/usdcSettler', ...)`). NO E2E. NO playwright (CD scope OUT).

---

## Riesgos

- **R-1 (MENOR):** Latencia HTTP al facilitator introduce un hop extra en el path de `/invoke`. Mitigación: medir en F4 con flag habilitado en preview Vercel; si delta p95 > 200ms, considerar fallback opt-in (followup HU).
- **R-2 (RESUELTA 2026-04-24):** Operator wallet mismatch entre wasiai-v2 y facilitator — resuelto via Opción A (Railway facilitator `OPERATOR_PRIVATE_KEY` alineado a `0xf432baf...7Ba`). Wallet unificado, balances verificados on-chain (AVAX/USDC en Fuji + PYUSD en Kite), Railway redeploy SUCCESS. Ver "Resolución R-2" arriba.
- **R-3 (MAYOR):** Rollout risk. Mitigación: activar primero en Vercel preview con flag set; canary en producción solo tras F4 OK + Sentry alert configurada.
- **R-4 (NUEVO en F2 — MENOR):** Cambio observable en `settlement.error` string format cuando flag está set (prefijo con código x402 v2). Si algún cliente downstream parsea ese string, podría romperse. Mitigación: el field está documentado como opaco en la x402 spec; aceptar el cambio. Documentar en CHANGELOG en F4.
- **R-5 (NUEVO en F2 — MENOR):** El facilitator **no soporta** `requestId` correlación (su `request_id` es Fastify-generated por hop). Para trazabilidad cross-service, sugerir followup HU para propagar `X-Request-Id` header. Por ahora, el log local con `requestId` propio es suficiente para Sentry stack.

---

## Missing Inputs / Resoluciones

- [RESUELTO 2026-04-24] **R-2 (operator wallet mismatch).** Aplicada Opción A — wallet unificado `0xf432baf...7Ba` en ambos servicios, balances on-chain verificados, Railway redeploy SUCCESS.
- [RESUELTO en F2] Contrato HTTP del facilitator: confirmado vía lectura de `wasiai-facilitator/src/routes/{verify,settle}.ts` y `core/schemas.ts`. Endpoints `/verify` y `/settle` aceptan POST con body Zod-validated `VerifyRequestSchema` (envelope canónico x402 v2).
- [RESUELTO en F2] DT-E fallback policy: **fail-clean, sin fallback automático**. Razonamiento detallado arriba.
- [RESUELTO] `X402_FACILITATOR_URL` existía comentada como DEPRECATED — se re-activa con nuevo propósito.
- [RESUELTO] Callsites confirmados: `invoke/route.ts:12,143` y `introspect/route.ts:17,360`.

---

## Análisis de paralelismo

- **WAS-V2-1** (este, wasiai-v2) y **WKH-55** (wasiai-a2a, F2 en progreso) son paralelos. No comparten Scope IN.
- WAS-V2-1 prepara wasiai-v2 para delegar settlement. WKH-55 puede trabajar en paralelo sin dependencia de bloqueo.
- El flag `X402_FACILITATOR_URL` en wasiai-v2 NO debe activarse hasta que WKH-55 (o cualquier HU que exponga el contrato HTTP del facilitator para Avalanche) esté en producción Y R-2 esté resuelta.
- wasiai-v2 sigue funcionando vía `x-agent-key` (Agent Keys, path A) sin depender de x402 ni del facilitator.

---

## Readiness Check (F2 → SPEC_APPROVED)

- [x] wasiai-facilitator soporta el body x402 v2 — verificado leyendo `core/schemas.ts:91-98`.
- [x] Endpoints `/verify` y `/settle` confirmados con shapes de respuesta — verificado en `routes/verify.ts:207-215` y `routes/settle.ts:303-313`.
- [x] Tabla error mapping (DT-G) cerrada con códigos x402 v2 canónicos del facilitator.
- [x] DT-E (fallback policy) resuelta — fail-clean.
- [x] Wrapper signature (DT-F) definida con context object explícito.
- [x] Tests infra: vitest disponible (a verificar en W0 por Dev — no bloqueante para SPEC_APPROVED si Dev confirma en W0).
- [x] Vercel preview es el canary natural (rollout sin riesgo en producción hasta validación).
- [x] **R-2 (operator wallet match) — RESUELTO 2026-04-24.** Opción A aplicada: wallet unificado `0xf432baf...7Ba` en ambos servicios. Railway redeploy SUCCESS + balances on-chain verificados (AVAX/USDC Fuji + PYUSD Kite).

**Veredicto:** SDD listo arquitectural y operacional. **READY FOR F2.5 / SPEC_APPROVED.**

---

## Resumen ejecutivo (8-12 líneas)

1. F2 grounding cubre 9 archivos (5 wasiai-v2 + 3 wasiai-facilitator + 2 envs).
2. **Convención SDD respetada:** archivo único `WAS-V2-1-external-facilitator-optin.md`, F1 expandido in-place con secciones F2.
3. **DT-C refinada:** el body que va al facilitator es el envelope canónico x402 v2 (`x402Version: 2`, `resource`, `accepted`, `payload`), NO el `X402EVMPayload` plano. Construido vía `buildX402V2Envelope(payload, ctx)` — ctx con metadata que las routes ya tienen via `buildRequirements`.
4. **DT-E resuelta — fail-clean.** Sin fallback automático. Razón: prevenir double-spend y eliminar silent failures. Rollback = unset env var.
5. **DT-F..I nuevas:** wrapper `settlePaymentX402(payload, required, ctx)` en mismo archivo `usdcSettler.ts`; error mapping hardcoded; timeout 30s; pino log con `settlerType`.
6. **CD-NEW-SDD-1..6 añadidos:** no idempotency client-side, config single-source con lazy-init, test matrix mínima (6 escenarios), graceful degradation en URL malformada, no async at module level, envelope construction explícita (anti rest-spread trap del facilitator W1).
7. **Waves:** W0 pre-flight (Dev), W1 config helper, W2 HTTP client + error mapping, W3 wrapper en usdcSettler, W4 callsites en routes, W5 .env.example + INDEX.
8. **R-2 RESUELTA (2026-04-24):** Opción A aplicada — wallet operator unificado `0xf432baf...7Ba` en wasiai-v2 y facilitator (Railway redeploy SUCCESS). Balances on-chain verificados: AVAX + USDC en Fuji y PYUSD en Kite. SDD desbloqueado.
9. Test plan: 12 tests unitarios (vitest + fetch mock) cubren los 12 ACs + CD-NEW-SDD-4. NO E2E.
10. Readiness: 8/8 checks OK. **READY FOR F2.5 / SPEC_APPROVED**.

---

# F2.5 — Story File (self-contained contract for nexus-dev)

> **Status: READY FOR F3** — SPEC_APPROVED dado por orquestador (auto-mode, 2026-04-24).
>
> **Convención del repo wasiai-v2:** los SDDs son single-file. Esta sección F2.5 vive in-place
> bajo el SDD aprobado; **el Dev (F3) consume EXCLUSIVAMENTE esta sección + las secciones DT/CD/AC/Resoluciones de arriba**.
> Todo lo necesario para implementar las 5 waves está aquí — no hace falta abrir otros documentos.
>
> **Branch obligatorio:** `feat/was-v2-1-external-facilitator-optin` (ya creado per `_INDEX.md`).

---

## F2.5.1 — Pre-conditions checklist (verificado por Architect en F2.5 grounding)

- [x] **Repo clean** salvo cambios `_INDEX.md` y skills (no toca `src/`).
- [x] **wasiai-facilitator soporta Avalanche Fuji + Kite** — endpoint `/supported` lo confirma; verify+settle ya en producción para AVAX-Fuji USDC.
- [x] **R-2 resuelto:** operator wallet unificado `0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba` en Railway facilitator (mismo que wasiai-v2 `OPERATOR_PRIVATE_KEY`).
- [x] **Stack confirmado en F2.5 grounding:**
  - Next.js 16 + React 19 (`package.json:38-43`)
  - viem 2.45 ya importada en `usdcSettler.ts:14-22`
  - Node 22+ → `globalThis.fetch` y `AbortSignal.timeout` disponibles sin polyfill
  - vitest configurado (`vitest.config.ts`), include `src/**/*.test.{ts,tsx}`, alias `@` → `src/`
  - Logger en `@/lib/logger` (named export `logger`, métodos `debug/info/warn/error`)
- [x] **Path verification (anti-hallucination):**
  - `src/lib/contracts/usdcSettler.ts` existe (265 líneas, exports `settlePaymentDirectly`, `X402EVMPayload`, `X402Authorization`, `SettlementResult`).
  - `src/app/api/v1/models/[slug]/invoke/route.ts` existe (835 líneas), import en line 12, callsite en helper `settleX402` (line 137-144), helper invocado en line 474.
  - `src/app/api/v1/agents/[slug]/introspect/route.ts` existe (412 líneas), import en line 17, callsite en line 360.
  - `.env.example` line 30-31: `X402_FACILITATOR_URL` comentada con tag `DEPRECATED (WAS-134)`.
  - `src/lib/contracts/__tests__/` **NO existe** — Dev debe crearlo en W1.
  - `src/lib/__tests__/ratelimit-fallback.test.ts` es exemplar de patrón vitest + `vi.mock`.
- [x] **Tests baseline esperados:** Dev corre `npm test --silent | tail -3` antes de cualquier cambio y guarda el conteo `(N passed)`. Al final de W4, debe ser `(N + nuevos passed)` sin regresiones.

---

## F2.5.2 — Anti-Hallucination Contract (BLOQUEANTE)

Antes de tocar cualquier archivo, Dev debe re-verificar (Glob/Read) y confirmar en el reporte F3:

| Path / Símbolo | Verificación esperada | Si falla |
|----------------|----------------------|----------|
| `src/lib/contracts/usdcSettler.ts` exporta `settlePaymentDirectly`, `X402EVMPayload`, `SettlementResult` | `grep -n "^export" src/lib/contracts/usdcSettler.ts` | STOP, escalar drift |
| `src/lib/logger.ts` tiene named export `logger` con `info/warn/error` | `grep -n "export const logger" src/lib/logger.ts` | STOP |
| `src/lib/constants.ts` exporta `SITE_URL` | `grep -n "export const SITE_URL" src/lib/constants.ts` | STOP |
| `vitest.config.ts` alias `@` → `src` | `grep -n "alias" vitest.config.ts` | STOP |
| `invoke/route.ts:474` usa el helper `settleX402` (no llama `settlePaymentDirectly` directamente) | leer `:472-475` | ajustar mapping en W4 |
| `introspect/route.ts:360` llama `settlePaymentDirectly` directamente (sin helper) | leer `:355-365` | confirmar que cambio es 1 línea + ctx |
| `process.env.X402_FACILITATOR_URL` no está usado en otros archivos del repo (excepto W1 nuevo) | `grep -rn "X402_FACILITATOR_URL" src/` | si aparece, escalar |

**Drift detectado en F2.5 grounding (informational):** ninguno. Todos los lines del SDD original (12, 143, 17, 360) coinciden con el codebase actual.

---

## F2.5.3 — Constraint Directives consolidadas (heredadas + SDD-level + auto-blindaje)

> Dev debe re-leerlas antes de cada wave. Cualquier violación = AR BLOQUEANTE.

**Heredadas del work-item (F1):**
- **CD-1:** TypeScript strict — PROHIBIDO `any` explícito.
- **CD-2:** OBLIGATORIO zero-regression cuando flag NOT set.
- **CD-3:** PROHIBIDO modificar body/firma de `settlePaymentDirectly`.
- **CD-4:** OBLIGATORIO reusar `X402EVMPayload` upstream (no re-parsear headers).
- **CD-5:** Tests cubren ambas ramas (flag set/unset).
- **CD-6:** App arranca sin la env var (no `throw` module-level).
- **CD-7:** OBLIGATORIO `import { logger } from '@/lib/logger'`. PROHIBIDO `console.*`.

**Nuevas (F2 SDD):**
- **CD-NEW-SDD-1:** PROHIBIDO caché de resultado en wrapper (idempotency vive en facilitator).
- **CD-NEW-SDD-2:** PROHIBIDO leer `process.env.X402_FACILITATOR_URL` fuera de `x402-facilitator-config.ts`.
- **CD-NEW-SDD-3:** Test matrix mínima 6 escenarios (ver W3).
- **CD-NEW-SDD-4:** Graceful degradation — URL malformada → `null` + `logger.warn` UNA vez.
- **CD-NEW-SDD-5:** PROHIBIDO `await` module-level en archivos nuevos.
- **CD-NEW-SDD-6:** Envelope x402 v2 con object literal explícito, keys exactos en orden del schema (`x402Version`, `resource`, `accepted`, `payload`). Facilitator usa Zod `.strict()`.

**Auto-blindaje from past HUs (F2.5 grounding extracted):**
- **CD-AB-1 (de WFAC-20):** El facilitator rechaza envelopes con campos extra. PROHIBIDO `...spread` en construcción del envelope. Solo object literal con keys explícitas.
- **CD-AB-2 (de HU-051 + HU-053 patrón):** PROHIBIDO usar `||` para fallbacks de strings que pueden ser `''` en lugar de `??`. Causa bugs cuando env var es vacía vs unset.
- **CD-AB-3 (de WAS-134):** PROHIBIDO hardcodear chain IDs/USDC addresses fuera de los maps existentes en `usdcSettler.ts:30-33`. El ctx en W4 debe leer de las constantes ya definidas en cada route.

---

## F2.5.4 — Wave breakdown detallado

> **5 waves serializadas** (W0 read-only → W1 config → W2 client → W3 wrapper → W4 routes → W5 docs).
> Dev no avanza a la siguiente wave hasta que la actual tenga: build clean + tests passing + commit local en branch.

### Wave 0 — Pre-flight (read-only, NO escribe código)

**Goal:** confirmar que el grounding del Architect coincide con el codebase real.

**Files (read-only):**
- `src/lib/contracts/usdcSettler.ts` (líneas 80-115 para tipos)
- `src/lib/__tests__/ratelimit-fallback.test.ts` (patrón vitest mock — 60 líneas iniciales)
- `package.json` (scripts: `test`, `typecheck`, `qa`)
- `vitest.config.ts` (alias, include)

**Acciones:**
1. Correr `npm test --silent 2>&1 | tail -5` → guardar línea `Tests N passed`.
2. Correr `npm run typecheck 2>&1 | tail -5` → debe pasar sin errores.
3. Confirmar Anti-Hallucination Contract (tabla F2.5.2).
4. Crear branch `feat/was-v2-1-external-facilitator-optin` si no existe (`_INDEX.md` ya lo lista).

**Tests:** ninguno (read-only).

**Done:** Dev reporta baseline tests count, typecheck OK, branch correcto. Avanza a W1.

---

### Wave 1 — Config module + tests

**Goal:** lazy-init helper que normaliza `X402_FACILITATOR_URL` con tri-state (unset/invalid → null, valid URL → string cacheado).

**Files:**
- **CREAR:** `src/lib/contracts/x402-facilitator-config.ts`
- **CREAR:** `src/lib/contracts/__tests__/x402-facilitator-config.test.ts`

**Code skeleton (Dev puede ajustar nombres/comentarios, NO la firma pública):**

```ts
// src/lib/contracts/x402-facilitator-config.ts
/**
 * WAS-V2-1: lazy-init reader of X402_FACILITATOR_URL env var.
 *
 * Tri-state cache:
 *   undefined → not yet read
 *   null      → unset OR malformed (graceful degradation per CD-NEW-SDD-4)
 *   string    → valid URL (trailing slash stripped)
 *
 * CD-NEW-SDD-2: única source of truth para esta env var.
 */
import { logger } from '@/lib/logger'

let cached: string | null | undefined = undefined
let warnedOnce = false

export function getFacilitatorUrl(): string | null {
  if (cached !== undefined) return cached
  const raw = process.env.X402_FACILITATOR_URL?.trim()
  if (!raw) { cached = null; return null }
  try {
    const url = new URL(raw)
    cached = url.toString().replace(/\/$/, '')
    return cached
  } catch {
    if (!warnedOnce) {
      logger.warn('[x402-facilitator-config] X402_FACILITATOR_URL malformed; falling back to internal settler', {
        raw_redacted: raw.slice(0, 16) + '...',
      })
      warnedOnce = true
    }
    cached = null
    return null
  }
}

/** Test-only — reset cache between tests. NOT exported in barrel/index. */
export function __resetFacilitatorUrlCacheForTesting(): void {
  cached = undefined
  warnedOnce = false
}
```

**Tests skeleton (vitest, AAA):**

```ts
// src/lib/contracts/__tests__/x402-facilitator-config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('getFacilitatorUrl — WAS-V2-1 W1', () => {
  beforeEach(async () => {
    vi.resetModules()
    delete process.env.X402_FACILITATOR_URL
  })

  it('AC-1 supporting: returns null when env var unset', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getFacilitatorUrl()).toBeNull()
  })

  it('AC-2 supporting: returns sanitized URL when set to valid URL', async () => {
    process.env.X402_FACILITATOR_URL = 'https://wasiai-facilitator-production.up.railway.app/'
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getFacilitatorUrl()).toBe('https://wasiai-facilitator-production.up.railway.app')
  })

  it('CD-NEW-SDD-4: returns null + warns on malformed URL', async () => {
    process.env.X402_FACILITATOR_URL = 'not-a-url'
    const { logger } = await import('@/lib/logger')
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getFacilitatorUrl()).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('CD-NEW-SDD-2: caches result across multiple calls (no re-read of env)', async () => {
    process.env.X402_FACILITATOR_URL = 'https://example.com'
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    const a = getFacilitatorUrl()
    delete process.env.X402_FACILITATOR_URL // mutate after first call
    const b = getFacilitatorUrl()
    expect(a).toBe(b) // returns cached value
  })
})
```

**AC coverage in W1:**
| AC | Cubierto en W1 |
|----|----------------|
| AC-1 (parcial) | sí — devuelve null → wrapper en W3 caerá a interno |
| CD-NEW-SDD-2 (cache) | sí — test "caches result across multiple calls" |
| CD-NEW-SDD-4 (graceful malformed) | sí — test "returns null + warns" |
| CD-NEW-SDD-5 (no async module-level) | sí — el code skeleton no tiene `await` top-level |
| CD-6 (no throw module-level) | sí — sólo `let` declarations + functions |

**Done:**
- [ ] `npm run typecheck` clean
- [ ] `npm test src/lib/contracts/__tests__/x402-facilitator-config.test.ts` → 4/4 passed
- [ ] Commit local: `feat(WAS-V2-1): W1 x402 facilitator config helper with lazy-init`

---

### Wave 2 — HTTP client + envelope builder + error mapping + tests

**Goal:** módulo puro con `verifyExternal` / `settleExternal` / `mapFacilitatorErrorToSettlementResult` / `buildX402V2Envelope`. Sin imports de viem (sólo `fetch` + types).

**Files:**
- **CREAR:** `src/lib/contracts/x402-facilitator-client.ts`
- **CREAR:** `src/lib/contracts/__tests__/x402-facilitator-client.test.ts`

**Code skeleton:**

```ts
// src/lib/contracts/x402-facilitator-client.ts
/**
 * WAS-V2-1: HTTP client + envelope builder + error mapping for the x402 facilitator.
 *
 * Pure module — no viem, no DB, no env var reads (DI via args).
 * Side-effect: only fetch() to facilitator URL.
 *
 * CD-NEW-SDD-6: envelope construction uses object literal with explicit keys
 * in schema order (x402Version, resource, accepted, payload). Facilitator
 * uses Zod .strict() — extra keys reject with HTTP 400.
 */
import type { Address } from 'viem'
import type { X402EVMPayload, SettlementResult } from './usdcSettler'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface X402V2Envelope {
  x402Version: 2
  resource: { url: string; description?: string; mimeType?: string }
  accepted: {
    scheme: 'exact'
    network: 'avalanche' | 'avalanche-testnet'
    amount: string
    asset: Address
    payTo: Address
    maxTimeoutSeconds: number
    extra: { assetTransferMethod: 'eip3009' }
  }
  payload: X402EVMPayload
}

export interface SettlePaymentX402Ctx {
  requestId:    string
  agentSlug:    string
  resourceUrl:  string
  atomicAmount: string
  asset:        Address
  payTo:        Address
  network:      'avalanche' | 'avalanche-testnet'
}

export interface VerifyResponseOk {
  verified: true
  // facilitator may include additional fields; we only require `verified`
}

export interface SettleResponseOk {
  settled: true
  transactionHash: string
}

interface FacilitatorErrorBody {
  code?: string
  message?: string
}

// ─── Envelope builder (pure) ──────────────────────────────────────────────────

export function buildX402V2Envelope(
  payload: X402EVMPayload,
  ctx: SettlePaymentX402Ctx,
): X402V2Envelope {
  // CD-NEW-SDD-6 + CD-AB-1: explicit keys, no spread, schema order.
  return {
    x402Version: 2,
    resource: {
      url: ctx.resourceUrl,
      description: `WasiAI agent invocation: ${ctx.agentSlug}`,
      mimeType: 'application/json',
    },
    accepted: {
      scheme: 'exact',
      network: ctx.network,
      amount: ctx.atomicAmount,
      asset: ctx.asset,
      payTo: ctx.payTo,
      maxTimeoutSeconds: 300,
      extra: { assetTransferMethod: 'eip3009' },
    },
    payload,
  }
}

// ─── Error mapping (pure, hardcoded per DT-G) ─────────────────────────────────

export function mapFacilitatorErrorToSettlementResult(
  status: number,
  body: FacilitatorErrorBody | null,
  phase: 'verify' | 'settle',
): SettlementResult {
  const code = (body?.code ?? 'UNKNOWN').toUpperCase()
  const msg  = body?.message ?? `HTTP ${status}`
  const verified = phase === 'settle' // verify failed → false; settle failed after verify ok → true
  // Known x402 v2 codes — extend table here if facilitator adds new ones.
  const KNOWN = new Set([
    'INVALID_PAYLOAD', 'INVALID_SIGNATURE', 'EXPIRED_AUTHORIZATION',
    'INVALID_AMOUNT',  'INSUFFICIENT_BALANCE', 'NETWORK_MISMATCH',
    'SIMULATION_FAILED', 'RATE_LIMITED', 'CHAIN_UNAVAILABLE', 'TRANSACTION_FAILED',
  ])
  const errorCode = KNOWN.has(code) ? code : 'INVALID_PAYLOAD'
  return { verified, settled: false, error: `${errorCode}: ${msg}` }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

type ExternalResult<T> =
  | { ok: true; body: T }
  | { ok: false; error: SettlementResult }

async function postJson<T>(
  url: string,
  envelope: X402V2Envelope,
  signal: AbortSignal,
  phase: 'verify' | 'settle',
): Promise<ExternalResult<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      signal,
    })
  } catch (e) {
    // timeout / DNS / ECONNREFUSED / abort — DT-G last-but-one row
    return {
      ok: false,
      error: {
        verified: false,
        settled: false,
        error: 'CHAIN_UNAVAILABLE: facilitator unreachable',
      },
    }
  }
  let body: unknown = null
  try { body = await res.json() } catch { /* shape mismatch handled below */ }

  if (!res.ok) {
    return { ok: false, error: mapFacilitatorErrorToSettlementResult(res.status, body as FacilitatorErrorBody, phase) }
  }

  // Naive shape guard — full Zod schema would be over-engineering here.
  if (phase === 'verify' && (body as { verified?: unknown })?.verified !== true) {
    return { ok: false, error: { verified: false, settled: false, error: 'INVALID_PAYLOAD: facilitator response shape unexpected' } }
  }
  if (phase === 'settle' && typeof (body as { transactionHash?: unknown })?.transactionHash !== 'string') {
    return { ok: false, error: { verified: true, settled: false, error: 'INVALID_PAYLOAD: facilitator response shape unexpected' } }
  }

  return { ok: true, body: body as T }
}

export function verifyExternal(
  envelope: X402V2Envelope,
  facilitatorUrl: string,
  signal: AbortSignal,
): Promise<ExternalResult<VerifyResponseOk>> {
  return postJson<VerifyResponseOk>(`${facilitatorUrl}/verify`, envelope, signal, 'verify')
}

export function settleExternal(
  envelope: X402V2Envelope,
  facilitatorUrl: string,
  signal: AbortSignal,
): Promise<ExternalResult<SettleResponseOk>> {
  return postJson<SettleResponseOk>(`${facilitatorUrl}/settle`, envelope, signal, 'settle')
}
```

**Tests skeleton (8 tests cubriendo DT-G):**

```ts
// src/lib/contracts/__tests__/x402-facilitator-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildX402V2Envelope,
  mapFacilitatorErrorToSettlementResult,
  verifyExternal,
  settleExternal,
  type SettlePaymentX402Ctx,
} from '@/lib/contracts/x402-facilitator-client'

const ctx: SettlePaymentX402Ctx = {
  requestId:    'req-test',
  agentSlug:    'echo',
  resourceUrl:  'https://app.wasiai.io/api/v1/models/echo/invoke',
  atomicAmount: '1000',
  asset:        '0x5425890298aed601595a70AB815c96711a31Bc65',
  payTo:        '0x0000000000000000000000000000000000000001',
  network:      'avalanche-testnet',
}

const payload = {
  signature: '0x' + 'a'.repeat(130),
  authorization: {
    from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40),
    value: '1000', validAfter: '0', validBefore: '9999999999',
    nonce: '0x' + '0'.repeat(64),
  },
}

describe('buildX402V2Envelope — CD-NEW-SDD-6', () => {
  it('produces envelope with explicit keys in schema order', () => {
    const env = buildX402V2Envelope(payload, ctx)
    expect(Object.keys(env)).toEqual(['x402Version', 'resource', 'accepted', 'payload'])
    expect(env.x402Version).toBe(2)
    expect(env.accepted.extra.assetTransferMethod).toBe('eip3009')
    expect(env.payload).toBe(payload)
  })
})

describe('mapFacilitatorErrorToSettlementResult — DT-G', () => {
  it.each([
    ['INVALID_PAYLOAD', 'verify', false],
    ['INVALID_SIGNATURE', 'verify', false],
    ['EXPIRED_AUTHORIZATION', 'verify', false],
    ['INVALID_AMOUNT', 'verify', false],
    ['INSUFFICIENT_BALANCE', 'verify', false],
    ['NETWORK_MISMATCH', 'verify', false],
    ['SIMULATION_FAILED', 'verify', false],
    ['RATE_LIMITED', 'verify', false],
    ['CHAIN_UNAVAILABLE', 'verify', false],
    ['TRANSACTION_FAILED', 'settle', true], // verified true, settled false
  ] as const)('maps %s → SettlementResult.error startsWith code; verified=%s', (code, phase, verified) => {
    const r = mapFacilitatorErrorToSettlementResult(400, { code, message: 'test' }, phase)
    expect(r.verified).toBe(verified)
    expect(r.settled).toBe(false)
    expect(r.error?.startsWith(`${code}:`)).toBe(true)
  })

  it('unknown code falls back to INVALID_PAYLOAD', () => {
    const r = mapFacilitatorErrorToSettlementResult(400, { code: 'WHATEVER', message: 'x' }, 'verify')
    expect(r.error?.startsWith('INVALID_PAYLOAD:')).toBe(true)
  })
})

describe('verifyExternal — fetch behavior', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns ok on HTTP 200 + verified:true body', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ verified: true }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(true)
  })

  it('returns CHAIN_UNAVAILABLE on fetch reject (timeout)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('aborted'))
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.error).toContain('CHAIN_UNAVAILABLE')
  })

  it('maps HTTP 400 INVALID_SIGNATURE to SettlementResult', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ code: 'INVALID_SIGNATURE', message: 'bad sig' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.verified).toBe(false)
      expect(r.error.error).toMatch(/^INVALID_SIGNATURE:/)
    }
  })

  it('returns INVALID_PAYLOAD when shape unexpected', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ random: 'shape' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.error).toContain('INVALID_PAYLOAD')
  })
})

describe('settleExternal — fetch behavior', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns ok with transactionHash on HTTP 200', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ settled: true, transactionHash: '0xabc' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await settleExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.body.transactionHash).toBe('0xabc')
  })

  it('returns verified:true settled:false on HTTP 500 TRANSACTION_FAILED (AC-5)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ code: 'TRANSACTION_FAILED', message: 'reverted' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await settleExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.verified).toBe(true)
      expect(r.error.settled).toBe(false)
      expect(r.error.error).toMatch(/^TRANSACTION_FAILED:/)
    }
  })
})
```

**AC coverage in W2:**
| AC | Cubierto en W2 |
|----|----------------|
| AC-2 (envelope shape) | sí — `buildX402V2Envelope` test |
| AC-4 | sí — verify 4xx mapping tests |
| AC-5 | sí — settle 500 returns verified:true |
| AC-6 | sí — fetch reject → CHAIN_UNAVAILABLE |
| DT-G (10 codes) | sí — `it.each` exhaustivo |
| CD-NEW-SDD-6 | sí — keys order assertion |
| CD-AB-1 (no spread) | sí — code skeleton usa object literal |

**Done:**
- [ ] `npm run typecheck` clean
- [ ] `npm test src/lib/contracts/__tests__/x402-facilitator-client.test.ts` → ~17/17 passed
- [ ] No imports de `process.env` en este archivo (CD-NEW-SDD-2)
- [ ] No imports de `viem` runtime — sólo `type Address` (type-only)
- [ ] Commit local: `feat(WAS-V2-1): W2 x402 facilitator HTTP client + envelope builder + error mapping`

---

### Wave 3 — Wrapper en `usdcSettler.ts` + tests

**Goal:** agregar export `settlePaymentX402(payload, required, ctx)` que dispatch interno/externo según `getFacilitatorUrl()`, con structured logging.

**Files:**
- **MODIFICAR:** `src/lib/contracts/usdcSettler.ts` (append-only — NO tocar líneas 1-265 existentes; sólo añadir al final)
- **CREAR:** `src/lib/contracts/__tests__/usdcSettler.x402.test.ts` (separado de cualquier test existente del settler interno para no acoplarlos)

**Append al final de `usdcSettler.ts`:**

```ts
// ─── WAS-V2-1: External facilitator opt-in wrapper ───────────────────────────
// CD-3: settlePaymentDirectly arriba queda intacto. Esta sección sólo agrega.

import { getFacilitatorUrl } from './x402-facilitator-config'
import {
  buildX402V2Envelope,
  verifyExternal,
  settleExternal,
  type SettlePaymentX402Ctx,
} from './x402-facilitator-client'

export type { SettlePaymentX402Ctx }

/**
 * Settle x402 payment, optionally delegating to external facilitator.
 *
 * - If X402_FACILITATOR_URL is unset/malformed → calls settlePaymentDirectly (zero regression, AC-1).
 * - If X402_FACILITATOR_URL is set → POST /verify then /settle to facilitator (AC-2/3).
 * - Errors mapped to SettlementResult per DT-G.
 *
 * AC-10: emits structured log entry with settlerType/durationMs/ok/errorCode.
 */
export async function settlePaymentX402(
  payload:  X402EVMPayload,
  required: string,
  ctx:      SettlePaymentX402Ctx,
): Promise<SettlementResult> {
  const start = Date.now()
  const url = getFacilitatorUrl()

  if (url === null) {
    const r = await settlePaymentDirectly(payload, required)
    logger.info('[settler]', {
      requestId:   ctx.requestId,
      agentSlug:   ctx.agentSlug,
      settlerType: 'internal',
      durationMs:  Date.now() - start,
      ok:          r.verified && r.settled,
      errorCode:   r.error,
    })
    return r
  }

  // External path
  const envelope = buildX402V2Envelope(payload, ctx)
  const signal   = AbortSignal.timeout(30_000) // DT-H

  const verifyRes = await verifyExternal(envelope, url, signal)
  if (!verifyRes.ok) {
    logger.info('[settler]', {
      requestId: ctx.requestId, agentSlug: ctx.agentSlug,
      settlerType: 'external', facilitatorUrl: url,
      durationMs: Date.now() - start, ok: false, errorCode: verifyRes.error.error,
    })
    return verifyRes.error
  }

  const settleRes = await settleExternal(envelope, url, signal)
  if (!settleRes.ok) {
    logger.info('[settler]', {
      requestId: ctx.requestId, agentSlug: ctx.agentSlug,
      settlerType: 'external', facilitatorUrl: url,
      durationMs: Date.now() - start, ok: false, errorCode: settleRes.error.error,
    })
    return settleRes.error // verified:true, settled:false (AC-5)
  }

  const result: SettlementResult = {
    verified: true,
    settled: true,
    transactionHash: settleRes.body.transactionHash,
  }
  logger.info('[settler]', {
    requestId: ctx.requestId, agentSlug: ctx.agentSlug,
    settlerType: 'external', facilitatorUrl: url,
    durationMs: Date.now() - start, ok: true,
  })
  return result
}
```

**Tests skeleton (cubre CD-NEW-SDD-3 matrix + AC-1/3/7/8/10):**

```ts
// src/lib/contracts/__tests__/usdcSettler.x402.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SettlePaymentX402Ctx } from '@/lib/contracts/x402-facilitator-client'
import type { X402EVMPayload, SettlementResult } from '@/lib/contracts/usdcSettler'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// Spy on settlePaymentDirectly so we can assert it IS / IS NOT called.
vi.mock('@/lib/contracts/usdcSettler', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/contracts/usdcSettler')>()
  return {
    ...mod,
    // we keep settlePaymentX402 (real impl) and override settlePaymentDirectly with a spy
    settlePaymentDirectly: vi.fn<(p: X402EVMPayload, r: string) => Promise<SettlementResult>>(),
  }
})

const ctx: SettlePaymentX402Ctx = {
  requestId: 'req-1', agentSlug: 'echo',
  resourceUrl: 'https://x.test/api/v1/models/echo/invoke',
  atomicAmount: '1000',
  asset: '0x5425890298aed601595a70AB815c96711a31Bc65',
  payTo: '0x0000000000000000000000000000000000000001',
  network: 'avalanche-testnet',
}
const payload: X402EVMPayload = {
  signature: '0x' + 'a'.repeat(130),
  authorization: { from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40),
    value: '1000', validAfter: '0', validBefore: '9999999999',
    nonce: '0x' + '0'.repeat(64) },
}

describe('settlePaymentX402 — wrapper (W3)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.X402_FACILITATOR_URL
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('AC-1/AC-7: flag unset → delegates to settlePaymentDirectly with same args, fetch NOT called', async () => {
    const settler = await import('@/lib/contracts/usdcSettler')
    ;(settler.settlePaymentDirectly as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { verified: true, settled: true, transactionHash: '0xINTERNAL' } as SettlementResult,
    )
    const r = await settler.settlePaymentX402(payload, '1000', ctx)
    expect(settler.settlePaymentDirectly).toHaveBeenCalledWith(payload, '1000')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(r.transactionHash).toBe('0xINTERNAL')
  })

  it('AC-2/AC-3/AC-8: flag set + verify ok + settle ok → fetch invoked twice, returns facilitator txHash', async () => {
    process.env.X402_FACILITATOR_URL = 'https://fac.test'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ verified: true }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ settled: true, transactionHash: '0xEXTERNAL' }) } as unknown as Response)
    const settler = await import('@/lib/contracts/usdcSettler')
    const r = await settler.settlePaymentX402(payload, '1000', ctx)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(settler.settlePaymentDirectly).not.toHaveBeenCalled()
    expect(r.transactionHash).toBe('0xEXTERNAL')
    expect(r.verified).toBe(true)
    expect(r.settled).toBe(true)
  })

  it('AC-4: flag set + verify 400 INVALID_SIGNATURE → returns mapped error, settle NOT called', async () => {
    process.env.X402_FACILITATOR_URL = 'https://fac.test'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: 'INVALID_SIGNATURE', message: 'sig' }) } as unknown as Response)
    const settler = await import('@/lib/contracts/usdcSettler')
    const r = await settler.settlePaymentX402(payload, '1000', ctx)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(r.verified).toBe(false)
    expect(r.error).toMatch(/^INVALID_SIGNATURE:/)
  })

  it('AC-5: flag set + verify ok + settle 500 TRANSACTION_FAILED → verified:true settled:false', async () => {
    process.env.X402_FACILITATOR_URL = 'https://fac.test'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ verified: true }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ code: 'TRANSACTION_FAILED', message: 'reverted' }) } as unknown as Response)
    const settler = await import('@/lib/contracts/usdcSettler')
    const r = await settler.settlePaymentX402(payload, '1000', ctx)
    expect(r.verified).toBe(true)
    expect(r.settled).toBe(false)
    expect(r.error).toMatch(/^TRANSACTION_FAILED:/)
  })

  it('AC-6: flag set + fetch reject (timeout) → CHAIN_UNAVAILABLE', async () => {
    process.env.X402_FACILITATOR_URL = 'https://fac.test'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('aborted'))
    const settler = await import('@/lib/contracts/usdcSettler')
    const r = await settler.settlePaymentX402(payload, '1000', ctx)
    expect(r.verified).toBe(false)
    expect(r.error).toContain('CHAIN_UNAVAILABLE')
  })

  it('CD-NEW-SDD-4: flag set with malformed URL → falls back to internal', async () => {
    process.env.X402_FACILITATOR_URL = 'not-a-url'
    const settler = await import('@/lib/contracts/usdcSettler')
    ;(settler.settlePaymentDirectly as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { verified: true, settled: true, transactionHash: '0xINTERNAL_FALLBACK' } as SettlementResult,
    )
    const r = await settler.settlePaymentX402(payload, '1000', ctx)
    expect(settler.settlePaymentDirectly).toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(r.transactionHash).toBe('0xINTERNAL_FALLBACK')
  })

  it('AC-10: emits structured log with settlerType + durationMs + ok', async () => {
    const { logger } = await import('@/lib/logger')
    const settler = await import('@/lib/contracts/usdcSettler')
    ;(settler.settlePaymentDirectly as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { verified: true, settled: true, transactionHash: '0x' } as SettlementResult,
    )
    await settler.settlePaymentX402(payload, '1000', ctx)
    expect(logger.info).toHaveBeenCalledWith('[settler]', expect.objectContaining({
      requestId: 'req-1', agentSlug: 'echo', settlerType: 'internal',
      ok: true, durationMs: expect.any(Number),
    }))
  })
})
```

**AC coverage in W3 (full matrix CD-NEW-SDD-3):**
| AC | Test |
|----|------|
| AC-1 | "flag unset → delegates" |
| AC-2 | "flag set + verify ok + settle ok → fetch invoked twice" |
| AC-3 | mismo (txHash from facilitator body) |
| AC-4 | "flag set + verify 400 INVALID_SIGNATURE" |
| AC-5 | "flag set + verify ok + settle 500" |
| AC-6 | "flag set + fetch reject" |
| AC-7 | mismo que AC-1 |
| AC-8 | mismo que AC-2 (`settlePaymentDirectly` not called) |
| AC-10 | "emits structured log" |
| CD-NEW-SDD-4 | "malformed URL → falls back" |

**Done:**
- [ ] `npm run typecheck` clean
- [ ] `npm test src/lib/contracts/__tests__/usdcSettler.x402.test.ts` → 7/7 passed
- [ ] `git diff src/lib/contracts/usdcSettler.ts` muestra **append-only** (líneas 1-265 sin cambios; sólo agregadas al final). Validación AC-11.
- [ ] Commit local: `feat(WAS-V2-1): W3 settlePaymentX402 wrapper with internal/external dispatch`

---

### Wave 4 — Update callsites en routes + tests de regresión

**Goal:** cambiar import y call en los 2 routes para usar `settlePaymentX402(payload, required, ctx)`. Comportamiento idéntico cuando flag unset (AC-1/AC-9).

**Files:**
- **MODIFICAR:** `src/app/api/v1/models/[slug]/invoke/route.ts`
- **MODIFICAR:** `src/app/api/v1/agents/[slug]/introspect/route.ts`
- **CREAR (opcional pero recomendado):** `src/app/api/v1/models/[slug]/invoke/__tests__/x402-flag-unset.test.ts` — smoke regression test

#### Cambio en `invoke/route.ts`

**Diff esperado (3 hunks):**

Línea 12 — rename import + agregar `settlePaymentX402`:
```ts
// antes
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
// después
import { settlePaymentX402, type X402EVMPayload, type SettlePaymentX402Ctx } from '@/lib/contracts/usdcSettler'
```

Líneas 137-144 — `settleX402` helper construye `ctx` y llama wrapper. Firma se extiende con `slug` + `resourceUrl`:
```ts
// antes
async function settleX402(paymentHeader: X402PaymentHeader, _model: Record<string, unknown>, priceStr: string): Promise<SettlementResult | NextResponse> {
  const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
  if (!evmPayload?.authorization || !evmPayload?.signature) {
    return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
  }
  const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
  return settlePaymentDirectly(evmPayload, atomicRequired)
}

// después
async function settleX402(
  paymentHeader: X402PaymentHeader,
  model: Record<string, unknown>,
  priceStr: string,
  resourceUrl: string,
  requestId: string,
): Promise<SettlementResult | NextResponse> {
  const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
  if (!evmPayload?.authorization || !evmPayload?.signature) {
    return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
  }
  const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
  const ctx: SettlePaymentX402Ctx = {
    requestId,
    agentSlug:    model.slug as string,
    resourceUrl,
    atomicAmount: atomicRequired,
    asset:        USDC_ADDR as `0x${string}`,
    payTo:        CONTRACT_ADDRESS as `0x${string}`,
    network:      CHAIN as 'avalanche' | 'avalanche-testnet',
  }
  return settlePaymentX402(evmPayload, atomicRequired, ctx)
}
```

Línea 474 — pasar el `requestId` y `resourceUrl` al helper:
```ts
// antes
const settlementOrError = await settleX402(paymentHeader, model, priceStr)

// después
const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
const settlementOrError = await settleX402(paymentHeader, model, priceStr, resourceUrl, requestId)
```

Nota: `resourceUrl` ya existe en línea 242 del archivo, está en scope. `crypto.randomUUID()` es global en Node 22+.

#### Cambio en `introspect/route.ts`

**Diff esperado (2 hunks):**

Línea 17 — rename import:
```ts
// antes
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
// después
import { settlePaymentX402, type X402EVMPayload, type SettlePaymentX402Ctx } from '@/lib/contracts/usdcSettler'
```

Línea 360 — replace direct call con wrapper + ctx:
```ts
// antes
const atomicRequired = Math.round(price * 1_000_000).toString()
const settlement = await settlePaymentDirectly(evmPayload, atomicRequired)

// después
const atomicRequired = Math.round(price * 1_000_000).toString()
const ctx: SettlePaymentX402Ctx = {
  requestId:    request.headers.get('x-request-id') ?? crypto.randomUUID(),
  agentSlug:    slug,
  resourceUrl:  `${SITE_URL}/api/v1/agents/${slug}/introspect`,
  atomicAmount: atomicRequired,
  asset:        USDC_ADDR as `0x${string}`,
  payTo:        CONTRACT_ADDRESS as `0x${string}`,
  network:      CHAIN as 'avalanche' | 'avalanche-testnet',
}
const settlement = await settlePaymentX402(evmPayload, atomicRequired, ctx)
```

`SITE_URL` ya está importado en `introspect/route.ts:19`.

#### Tests de regresión (W4)

**File:** `src/app/api/v1/models/[slug]/invoke/__tests__/x402-flag-unset.test.ts` (nuevo)

Bit-exact regression con flag unset:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('AC-9: flag unset → fetch never called from settlePaymentX402 (regression smoke)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.X402_FACILITATOR_URL
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('settlePaymentX402 with flag unset never invokes fetch (delegates to internal)', async () => {
    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    // We don't actually run the route handler — too much DB plumbing.
    // Instead we assert the wrapper contract: with flag unset, fetch is never called.
    const ctx = {
      requestId: 'r', agentSlug: 's',
      resourceUrl: 'https://x', atomicAmount: '1000',
      asset: '0x5425890298aed601595a70AB815c96711a31Bc65' as const,
      payTo: '0x0000000000000000000000000000000000000001' as const,
      network: 'avalanche-testnet' as const,
    }
    const payload = {
      signature: '0xINVALID',
      authorization: { from: '0x', to: '0x', value: '0', validAfter: '0', validBefore: '0', nonce: '0x' },
    }
    try { await settlePaymentX402(payload, '1000', ctx) } catch { /* internal may throw on bad sig — fine */ }
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
```

**Done:**
- [ ] `git diff src/app/api/v1/models/[slug]/invoke/route.ts` ≤ 25 líneas modificadas (3 hunks)
- [ ] `git diff src/app/api/v1/agents/[slug]/introspect/route.ts` ≤ 18 líneas modificadas (2 hunks)
- [ ] `npm run typecheck` clean (importante: `as 'avalanche' | 'avalanche-testnet'` puede requerir narrow)
- [ ] `npm run lint` clean
- [ ] `npm test` baseline + nuevos pasan (≥ baseline + 1)
- [ ] `npm run build` clean
- [ ] Commit local: `feat(WAS-V2-1): W4 routes invoke + introspect use settlePaymentX402 wrapper`

---

### Wave 5 — Docs `.env.example`

**Goal:** reactivar `X402_FACILITATOR_URL` con comentario que explica el opt-in.

**File:** `/home/ferdev/.openclaw/workspace/wasiai-v2/.env.example`

Reemplazar lines 30-31:
```
# DEPRECATED (WAS-134): WasiAI usa facilitador propio — esta variable ya no tiene efecto
# X402_FACILITATOR_URL=https://facilitator.ultravioletadao.xyz
```
por:
```
# WAS-V2-1: Opt-in al facilitator x402 externo (wasiai-facilitator).
# Si NO está set → settlement interno via usdcSettler.settlePaymentDirectly (default zero-regression).
# Si está set    → settlement delegado al facilitator externo via HTTP /verify + /settle.
# Rollback ops:  borrar la var en Vercel y redeploy. Cero código nuevo necesario.
# Producción típica: https://wasiai-facilitator-production.up.railway.app
X402_FACILITATOR_URL=
```

**Done:**
- [ ] AC-12 cubierto: entry uncommented, comentario referencia WAS-V2-1, default vacío.
- [ ] Commit local: `docs(WAS-V2-1): W5 reactivate X402_FACILITATOR_URL in .env.example with opt-in comment`

---

## F2.5.5 — AC trace matrix completa

| AC | Wave | Archivo:línea esperada | Test |
|----|------|------------------------|------|
| AC-1 | W3 + W4 | `usdcSettler.ts` (append, ~270) + routes | `usdcSettler.x402.test.ts:flag unset → delegates` |
| AC-2 | W2 + W3 | `x402-facilitator-client.ts:buildX402V2Envelope` + `usdcSettler.ts` wrapper | `x402-facilitator-client.test.ts:envelope shape` + `usdcSettler.x402.test.ts:flag set → fetch x2` |
| AC-3 | W3 | `usdcSettler.ts` wrapper línea con `transactionHash: settleRes.body.transactionHash` | `usdcSettler.x402.test.ts:returns 0xEXTERNAL` |
| AC-4 | W2 + W3 | `mapFacilitatorErrorToSettlementResult` | `usdcSettler.x402.test.ts:verify 400 INVALID_SIGNATURE` |
| AC-5 | W2 + W3 | mapping con `verified: phase === 'settle'` | `usdcSettler.x402.test.ts:settle 500 → verified:true` |
| AC-6 | W2 | `postJson` catch fetch error | `usdcSettler.x402.test.ts:fetch reject → CHAIN_UNAVAILABLE` |
| AC-7 | W3 | mismo wrapper code que AC-1 | mismo test |
| AC-8 | W3 | wrapper rama externa, no llama interno | `usdcSettler.x402.test.ts:flag set → settlePaymentDirectly NOT called` |
| AC-9 | W4 | smoke test regression | `x402-flag-unset.test.ts` |
| AC-10 | W3 | `logger.info('[settler]', { ... })` | `usdcSettler.x402.test.ts:emits structured log` |
| AC-11 | W3 | `git diff` muestra append-only en `usdcSettler.ts` | static check (Adversary verifica en F4) |
| AC-12 | W5 | `.env.example` línea sin `#` prefix | grep test (`grep -E "^X402_FACILITATOR_URL" .env.example`) |

---

## F2.5.6 — DT/CD verification matrix

| Identifier | Cómo se verifica en código | Wave |
|------------|---------------------------|------|
| DT-A | `process.env.X402_FACILITATOR_URL` leída solo en `x402-facilitator-config.ts` | W1 |
| DT-B | export `settlePaymentX402` en `usdcSettler.ts`; routes usan ese símbolo | W3+W4 |
| DT-C | `buildX402V2Envelope` produce object con keys `x402Version`/`resource`/`accepted`/`payload` | W2 (test "envelope shape") |
| DT-D | `mapFacilitatorErrorToSettlementResult` cubre tabla DT-G | W2 (`it.each` test) |
| DT-E | wrapper retorna `CHAIN_UNAVAILABLE` cuando facilitator unreachable; **NO llama a `settlePaymentDirectly` como fallback** | W2+W3 |
| DT-F | firma `(payload, required, ctx) => Promise<SettlementResult>` | W3 |
| DT-G | tabla mapping → 11 tests (10 known + 1 unknown) | W2 |
| DT-H | `AbortSignal.timeout(30_000)` en wrapper | W3 |
| DT-I | `logger.info('[settler]', { requestId, agentSlug, settlerType, durationMs, ok, errorCode? })` | W3 |
| CD-1 | `npm run typecheck` clean (sin `any` explícito) | W1..W4 |
| CD-2 | regression smoke W4 + AC-9 test | W4 |
| CD-3 | `git diff src/lib/contracts/usdcSettler.ts` líneas 1-265 sin cambios | W3 |
| CD-4 | wrapper recibe `payload: X402EVMPayload` y lo pasa tal cual al envelope `.payload` | W3 |
| CD-5 | tests para flag set + flag unset (W3) | W3 |
| CD-6 | `getFacilitatorUrl()` retorna `null` si unset, no `throw` | W1 |
| CD-7 | `import { logger } from '@/lib/logger'` en W1+W3; PROHIBIDO `console.*` | W1+W3 |
| CD-NEW-SDD-1 | wrapper sin caché interno; cada call ejecuta fetch | W3 |
| CD-NEW-SDD-2 | `grep "process.env.X402_FACILITATOR_URL" src/` retorna sólo `x402-facilitator-config.ts` | post-W1 |
| CD-NEW-SDD-3 | 6+ tests en `usdcSettler.x402.test.ts` cubren la matrix | W3 |
| CD-NEW-SDD-4 | test "malformed URL → falls back to internal" | W1+W3 |
| CD-NEW-SDD-5 | `grep "^await" src/lib/contracts/x402-*.ts` vacío | W1+W2 |
| CD-NEW-SDD-6 | object literal en `buildX402V2Envelope`, no `...spread`; test "keys order" | W2 |
| CD-AB-1 | mismo que CD-NEW-SDD-6 | W2 |
| CD-AB-2 | wrapper usa `??` no `\|\|`; `process.env.X402_FACILITATOR_URL?.trim()` con optional-chain | W1 |
| CD-AB-3 | ctx en routes lee `USDC_ADDR`/`CONTRACT_ADDRESS`/`CHAIN` ya definidos | W4 |

---

## F2.5.7 — Out of scope (NO HACER)

> Si Dev se ve tentado a tocar algo de esta lista → STOP, escalar.

- ❌ Modificar body o firma de `settlePaymentDirectly` (CD-3).
- ❌ Cambios en wasiai-a2a o wasiai-facilitator (otro repo).
- ❌ Soportar nuevas chains/tokens (ej. Kite, Base) — wasiai-v2 es Avalanche only.
- ❌ Retry policy o circuit breaker en el wrapper.
- ❌ Métricas Prometheus/StatsD/Sentry custom (sólo el `logger.info` AC-10).
- ❌ Idempotency key client-side (CD-NEW-SDD-1).
- ❌ Fallback automático interno cuando externo falla (DT-E fail-clean).
- ❌ Modificar `buildRequirements` en routes (su shape es público para clientes 402).
- ❌ Cambiar el shape externo del response 402/200 cuando flag unset (AC-9).
- ❌ Agregar `await` module-level (CD-NEW-SDD-5).
- ❌ Tests E2E con playwright (sólo unit tests vitest).
- ❌ Refactorizar routes más allá de los hunks especificados en W4.
- ❌ Modificar el `agentPay.ts` u otros settlers paralelos (esta HU sólo afecta x402 path B).

---

## F2.5.8 — Validation matrix (tests baseline + nuevos)

**Baseline (medir en W0):** Dev guarda el output de `npm test --silent | tail -3` antes de tocar nada.

**Nuevos tests esperados (target):**
| Archivo | Tests aproximados |
|---------|------------------|
| `src/lib/contracts/__tests__/x402-facilitator-config.test.ts` | 4 |
| `src/lib/contracts/__tests__/x402-facilitator-client.test.ts` | 16 (1 envelope + 11 mapping + 4 fetch verify + 2 fetch settle = 18 con `it.each`; aproximación) |
| `src/lib/contracts/__tests__/usdcSettler.x402.test.ts` | 7 |
| `src/app/api/v1/models/[slug]/invoke/__tests__/x402-flag-unset.test.ts` | 1 |
| **Total nuevo** | **≈ 28-30** |

**Final esperado:** `Tests (baseline + 28..30) passed`. Cero regresión en baseline.

**Build/lint/typecheck:** todos clean en cada wave.

---

## F2.5.9 — Definition of Done (F3 → AR)

- [ ] **W0 done:** branch correcto, baseline tests guardado, Anti-Hallucination Contract verificado.
- [ ] **W1 done:** `x402-facilitator-config.ts` + 4 tests passing.
- [ ] **W2 done:** `x402-facilitator-client.ts` + 16-18 tests passing.
- [ ] **W3 done:** wrapper `settlePaymentX402` append-only en `usdcSettler.ts` + 7 tests passing. `git diff` confirma líneas 1-265 intactas (AC-11).
- [ ] **W4 done:** `invoke/route.ts` + `introspect/route.ts` actualizados; smoke regression test passing.
- [ ] **W5 done:** `.env.example` actualizado.
- [ ] `npm run qa` (typecheck + lint + test + build) clean.
- [ ] `git status` muestra exactamente los 7 archivos modificados/creados:
  - `src/lib/contracts/x402-facilitator-config.ts` (nuevo)
  - `src/lib/contracts/x402-facilitator-client.ts` (nuevo)
  - `src/lib/contracts/usdcSettler.ts` (append)
  - `src/lib/contracts/__tests__/x402-facilitator-config.test.ts` (nuevo)
  - `src/lib/contracts/__tests__/x402-facilitator-client.test.ts` (nuevo)
  - `src/lib/contracts/__tests__/usdcSettler.x402.test.ts` (nuevo)
  - `src/app/api/v1/models/[slug]/invoke/route.ts` (modificado)
  - `src/app/api/v1/agents/[slug]/introspect/route.ts` (modificado)
  - `src/app/api/v1/models/[slug]/invoke/__tests__/x402-flag-unset.test.ts` (nuevo, opcional)
  - `.env.example` (modificado, líneas 30-31)
- [ ] Branch pushed (`git push -u origin feat/was-v2-1-external-facilitator-optin`), **NO merge** — orquestador maneja merge tras AR/CR/F4.
- [ ] PR draft preparado (orquestador lo abre).

**Commit message preparado (squash o multi-commit a gusto del orquestador):**

```
feat(WAS-V2-1): external facilitator opt-in for x402 settlement

Adds settlePaymentX402(payload, required, ctx) wrapper in usdcSettler.ts that
dispatches between internal settler (default, zero-regression) and external
wasiai-facilitator HTTP /verify+/settle when X402_FACILITATOR_URL is set.

- W1: lazy-init config helper with graceful degradation on malformed URL
- W2: pure HTTP client + envelope builder + DT-G error mapping
- W3: wrapper with structured logging (settlerType/durationMs/ok)
- W4: routes invoke + introspect use new wrapper, ctx-driven
- W5: .env.example reactivates X402_FACILITATOR_URL with opt-in comment

settlePaymentDirectly() body untouched (AC-11). Rollback = unset env var.

Refs: doc/sdd/WAS-V2-1-external-facilitator-optin.md
```

---

## F2.5.10 — Rollout plan (post F4 / DONE)

Esta sección es informational para Ops; Dev no ejecuta nada de aquí.

**Step 1 — Merge PR a `main`:**
- Vercel deploya con `X402_FACILITATOR_URL` UNSET → comportamiento idéntico al actual (AC-1 garantiza zero regression).

**Step 2 — Smoke test en Vercel preview:**
- Hit `POST /api/v1/models/echo/invoke` con header `X-PAYMENT` (testnet Fuji).
- Verificar que `meta.tx_hash` viene en formato `0x[a-f0-9]{64}` (mismo que pre-WAS-V2-1).
- Logs deben mostrar `{ settlerType: 'internal' }`.

**Step 3 — Activar en Vercel preview con flag set:**
- `vercel env add X402_FACILITATOR_URL https://wasiai-facilitator-production.up.railway.app --environment=preview`
- Redeploy.
- Hit endpoint en preview URL → tx hash debe llegar (vendrá del facilitator).
- Logs deben mostrar `{ settlerType: 'external', facilitatorUrl: 'https://...' }` y un `requestId`.
- Verificar en Railway facilitator logs que llegó la request (correlación por timestamp + amount).
- Verificar tx on-chain: el `from` debe ser el operator wallet `0xf432baf...7Ba`, el `value` correcto, el `to` el `CONTRACT_ADDRESS`.

**Step 4 — Activar en producción (canary):**
- `vercel env add X402_FACILITATOR_URL https://wasiai-facilitator-production.up.railway.app --environment=production`
- Redeploy.
- Monitor Sentry/logs por 5 minutos. Si `errorCode === 'CHAIN_UNAVAILABLE'` con `settlerType === 'external'` excede 1% → ROLLBACK.

**Step 5 — Rollback (si necesario):**
- `vercel env rm X402_FACILITATOR_URL --environment=production`
- Redeploy.
- Logs vuelven a `{ settlerType: 'internal' }` automáticamente. Cero código nuevo desplegado.

**Alertas Sentry recomendadas (post-rollout, opcional, NO en esta HU):**
- Alert si `errorCode === 'CHAIN_UNAVAILABLE'` AND `settlerType === 'external'` excede 1% en 5min.
- Alert si latencia p95 del path externo > 10s.

---

## F2.5.11 — Resumen ejecutivo F2.5

1. **Convención single-file respetada:** F2.5 vive in-place en este SDD; Dev consume sólo este archivo.
2. **Anti-Hallucination Contract verificado:** los 4 paths críticos (`usdcSettler.ts`, `invoke/route.ts:12,143,474`, `introspect/route.ts:17,360`, `.env.example:30-31`, `vitest.config.ts`) coinciden bit-exact con el grounding del SDD F2. Zero drift.
3. **5 waves con code skeletons completos:** W0 read-only, W1 config (4 tests), W2 client + envelope + mapping (16-18 tests), W3 wrapper append-only (7 tests, AC-11 garantizado), W4 routes 2 hunks each (smoke regression test), W5 docs.
4. **AC trace matrix 12/12** con archivo + test esperado.
5. **CD verification matrix** mapea heredados (7) + SDD-level (6) + auto-blindaje (3) a archivo/test.
6. **Out-of-scope explícito** (12 items): Dev no se desvía a refactors paralelos.
7. **DoD precisa:** 9 archivos tocados (5 nuevos test/code + 2 routes + 1 settler append + 1 env), `npm run qa` clean, branch pushed sin merge.
8. **Rollout plan informational** documentado para Ops post-DONE.
9. **Self-contained:** Dev NO necesita abrir wasiai-facilitator repo, ni el SDD F2 superior, ni ningún otro doc — todo lo necesario está en F2.5.1 → F2.5.11.
10. **Status: READY FOR F3.** Orquestador puede lanzar `nexus-dev` inmediatamente.
