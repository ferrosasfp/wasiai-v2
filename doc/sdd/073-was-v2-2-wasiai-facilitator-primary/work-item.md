# Work Item — [WAS-V2-2] wasiai-facilitator as primary x402 settler, Ultravioleta DAO as fallback

## Resumen

Elevar `wasiai-facilitator` (`https://wasiai-facilitator-production.up.railway.app`) al rol de
facilitator PRIMARY para settlements x402 en wasiai-v2, usando Ultravioleta DAO
(`facilitator.ultravioletadao.xyz`, vía `uvd-x402-sdk@^2.25.0`) como FALLBACK automático.
La decisión fue tomada el 2026-05-11 tras confirmar que la tx
`0x5fbf570bbc64d477586bb7aeaa71d5e6a1b4f6c540419172ec5b43f2e77733f2` (snowtrace.io)
fue enviada y el gas pagado por el operator de Ultravioleta (`0x46140a86c01d930d2eaa9be7b4833d42b72c5f9b`),
no por el operator propio de WasiAI — evidenciando que el marketplace depende upstream de UVD
en producción. La solución provee soberanía operacional, telemetría propia y resiliencia con fallback.

---

## Sizing

- **SDD_MODE:** full (QUALITY)
- **Categoría de riesgo:** ALTA — toca payment path con USDC real en mainnet y Avalanche Fuji
- **Estimación:** L (60–90 min dev, 3 waves)
- **Branch sugerido:** `feat/was-v2-2-wasiai-facilitator-primary`
- **Pipeline obligado:** QUALITY (SDD + AR + CR + F4 QA con evidencia archivo:línea)

### Justificación QUALITY

- Modifica el payment path de dinero real (x402 mainnet, USDC)
- Introduce lógica de routing con fallback automático entre dos facilitators externos
- Requiere tests matrix (toggle × chain × wasiai-ok/fail × uvd-ok/fail)
- Riesgo de doble-charge si idempotencia mal implementada (CD-5)
- Cambio en telemetría con impacto en Grafana/Sentry histogramas
- Regresión potencial: >15 tests de baseline x402 existentes

---

## Contexto técnico (pre-existente WAS-V2-1)

WAS-V2-1 introdujo un mecanismo opt-in para delegar a un facilitator externo vía env var
`X402_FACILITATOR_URL`. Si está seteada, `settlePaymentX402()` en `usdcSettler.ts` hace
POST `/verify` + POST `/settle` al facilitator; si no está seteada, usa `settlePaymentDirectly()`
(internal, EIP-3009 directo). El cliente HTTP vive en `x402-facilitator-client.ts` y la lectura
de la env var en `x402-facilitator-config.ts`.

**WAS-V2-2 reemplaza** ese mecanismo opt-in (un solo facilitator) por un **router dual**:
wasiai-facilitator como primario + Ultravioleta como fallback, con chain allowlist hardcoded
y toggle de feature flag.

---

## Acceptance Criteria (EARS)

### Toggle OFF (safe default — backward compat)

- **AC-1:** WHILE `WASIAI_FACILITATOR_AS_PRIMARY` is unset or set to any value other than `'true'`,
  the system SHALL route ALL x402 settlements through Ultravioleta DAO exclusively,
  producing behavior identical to the main branch prior to this HU (zero regression).

- **AC-2:** IF `WASIAI_FACILITATOR_AS_PRIMARY` env var is present but malformed (not parseable
  as boolean), THEN the system SHALL default to Ultravioleta-only mode, log a WARN once at
  first-call time (not at module init), and SHALL NOT throw or crash the settlement path.

### Toggle ON — chain routing

- **AC-3:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true` and the payment chain identifier is in the
  hardcoded allowlist `['eip155:2366', 'eip155:2368', 'eip155:43113', 'eip155:43114']`,
  the system SHALL attempt settlement via wasiai-facilitator FIRST before considering Ultravioleta.

- **AC-4:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true` and the payment chain identifier is NOT in
  the allowlist, the system SHALL route the settlement DIRECTLY to Ultravioleta DAO without
  attempting wasiai-facilitator, logging a debug event with `reason: 'chain_not_in_allowlist'`.

### Toggle ON — wasiai success path

- **AC-5:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator
  responds HTTP 2xx on both `/verify` and `/settle`, the system SHALL return a successful
  `SettlementResult` (`verified: true, settled: true`) and SHALL NOT call Ultravioleta DAO at all.

### Toggle ON — wasiai failure paths (fallback triggers)

- **AC-6:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator
  responds HTTP 5xx on `/verify` or `/settle`, the system SHALL immediately fall back to Ultravioleta
  DAO WITHOUT retrying wasiai-facilitator, and SHALL log a structured event including
  `fallback_reason: 'wasiai_5xx'`, `wasiai_status: <status_code>`.

- **AC-7:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator
  times out (AbortSignal fires after 30 s) or is unreachable (DNS/ECONNREFUSED), the system SHALL
  immediately fall back to Ultravioleta DAO and SHALL log
  `fallback_reason: 'wasiai_unreachable'`.

- **AC-8:** WHEN `WASIAI_FACILITATOR_AS_PRIMARY=true`, chain is in allowlist, and wasiai-facilitator
  returns error code `CHAIN_UNAVAILABLE` or `INVALID_PAYLOAD` in a non-2xx response body,
  the system SHALL immediately fall back to Ultravioleta DAO and SHALL log
  `fallback_reason: 'wasiai_<error_code_lowercase>'`.

### Both facilitators fail

- **AC-9:** IF both wasiai-facilitator AND Ultravioleta DAO fail to settle a payment, THEN the
  system SHALL return `{ verified: false, settled: false, error: '<LAST_ERROR>' }` and SHALL emit
  a structured log entry including `wasiai_outcome`, `uvd_outcome`, and `both_failed: true`.

### Idempotency — critical

- **AC-10:** IF wasiai-facilitator fails AFTER the `/verify` phase with an error that indicates
  the on-chain nonce was consumed (code `NONCE_ALREADY_USED` or HTTP 409), THEN the system
  SHALL NOT fall back to Ultravioleta DAO and SHALL return
  `{ verified: true, settled: false, error: 'NONCE_ALREADY_USED: ...' }` immediately.

### Telemetry

- **AC-11:** WHEN any x402 settlement completes (success or failure), the system SHALL emit a
  structured log entry via `logger.info('[settler]', {...})` including the fields:
  `facilitatorUsed: 'wasiai' | 'ultravioleta' | 'internal'`,
  `fallbackTriggered: boolean`,
  `fallbackReason?: string`,
  `durationMs: number`,
  `ok: boolean`,
  `errorCode?: string`.

### Env var documentation

- **AC-12:** WHEN the project's `.env.example` is read, the system SHALL document both
  `WASIAI_FACILITATOR_AS_PRIMARY` (with allowed values and default) and
  `WASIAI_FACILITATOR_URL` (existing) in the `# Pagos x402` section with comments explaining
  the routing logic for operators.

### Tests

- **AC-13:** WHEN the test suite runs (`npm test`), the system SHALL include unit tests covering
  all 8 routing branches of the decision matrix:
  `(toggle off) × (chain in/not in allowlist) × (wasiai ok/fail) × (uvd ok/fail)`,
  with ≥ 15 new unit + integration test cases, none using real HTTP calls (all mocked).

- **AC-14:** WHEN the test suite runs, ALL existing x402 baseline tests from WAS-V2-1 SHALL
  pass without modification (zero regression on pre-existing test coverage).

- **AC-15:** WHEN the test suite runs, each AC from AC-1 through AC-11 SHALL be traceable to
  at least one named test case in the test file(s) covering `facilitator-router`.

---

## Scope IN

| Archivo | Tipo | Cambio |
|---------|------|--------|
| `src/lib/contracts/x402-facilitator-config.ts` | MODIFY | Agregar lectura de `WASIAI_FACILITATOR_AS_PRIMARY` + chain allowlist hardcoded. Mantener `getFacilitatorUrl()` intacta (CD-3). |
| `src/lib/contracts/facilitator-router.ts` | NEW | Módulo router puro: encapsula lógica de qué facilitator usar para qué chain, qué fallback aplica, idempotency guard CD-5. |
| `src/lib/contracts/usdcSettler.ts` | MODIFY | `settlePaymentX402()` llama `facilitator-router` en vez de ir directo al facilitator externo. Telemetría extendida (AC-11). |
| `.env.example` | MODIFY | Documentar `WASIAI_FACILITATOR_AS_PRIMARY` y `WASIAI_FACILITATOR_URL` juntos en sección x402. |
| `src/lib/contracts/__tests__/facilitator-router.test.ts` | NEW | Suite de tests para el router (AC-13/14/15). |

**Nota sobre SDK (`packages/sdk/`):** la HU original menciona
`packages/sdk/src/_future/x402.ts` y handlers. Esa ruta NO EXISTE en el codebase actual
(glob confirmado vacío). [NEEDS CLARIFICATION] — si el SDK es un workspace separado,
el Architect debe confirmar si está in-scope en esta HU o es una HU separada.
Por conservadorismo, el SDK queda **fuera del scope de esta HU** hasta confirmación.

---

## Scope OUT

- NO modificar `wasiai-facilitator` repo (cambios solo client-side en wasiai-v2)
- NO modificar `uvd-x402-sdk` node_modules — Ultravioleta sigue siendo consumida como hoy
- NO cambiar protocol shape ni signatures EIP-3009/EIP-712
- NO migrar a x402 v2 si se sigue en v1 — mantener compat existente
- NO eliminar fallback a `settlePaymentDirectly()` interno — el caso `X402_FACILITATOR_URL` unset sigue funcionando
- NO tocar `x402-facilitator-client.ts` — las funciones `verifyExternal()` y `settleExternal()` se reusan tal cual
- NO hacer cambios a contratos Solidity
- NO modificar `packages/sdk/` (fuera de scope hasta confirmación — ver Missing Inputs)
- NO agregar RLS migrations (no hay tablas nuevas)
- NO cambiar la interfaz pública `settlePaymentX402(payload, required, ctx)` — CD-3

---

## Decisiones técnicas (DT)

- **DT-A (humano):** Chain allowlist HARDCODED en código — lista inmutable:
  `['eip155:2366', 'eip155:2368', 'eip155:43113', 'eip155:43114']` (Kite mainnet, Kite testnet,
  Fuji, Avalanche mainnet). Para chains NO en la lista → Ultravioleta directo. No fetch a
  `/supported` del facilitator.

- **DT-B (humano):** Feature flag `WASIAI_FACILITATOR_AS_PRIMARY=true|false`. Default en código:
  `false` (zero-risk merge — comportamiento idéntico al actual hasta que el operador flipee).
  Leído en `x402-facilitator-config.ts` (módulo único de env vars x402 — CD-NEW-SDD-2 extendido).

- **DT-C (humano):** Fallback a Ultravioleta INMEDIATO si wasiai responde 5xx, timeout,
  `CHAIN_UNAVAILABLE`, `INVALID_PAYLOAD`. Sin retries contra wasiai. Más responsivo para
  user-facing payments.

- **DT-D (analyst):** El router se implementa como módulo puro (`facilitator-router.ts`) sin
  estado de módulo (excepto config cacheada de la env var — reutiliza el patrón tri-state
  de `x402-facilitator-config.ts`). Facilita testing sin mocks complejos de módulo.

- **DT-E (analyst):** La función `settlePaymentX402()` en `usdcSettler.ts` se refactoriza para
  delegar a `facilitator-router.trySettle(payload, required, ctx)` en lugar de contener la
  lógica de routing inlineada. Preserva la firma pública (CD-3).

- **DT-F (analyst):** El idempotency guard (AC-10, CD-5) se implementa en el router
  inspeccionando el código de error del resultado wasiai-facilitator. Si el código es
  `NONCE_ALREADY_USED` (HTTP 409 o body `{ code: 'NONCE_ALREADY_USED' }`), el router
  devuelve ese resultado SIN llamar a Ultravioleta.

---

## Constraint Directives (CD)

- **CD-1:** TypeScript strict — cero `any` explícito en archivos nuevos o modificados.

- **CD-2:** Backward compat total — `WASIAI_FACILITATOR_AS_PRIMARY` unset o `false` produce
  comportamiento idéntico al main antes de esta HU. Tests de regresión AC-14 son la red de seguridad.

- **CD-3:** La interfaz pública `settlePaymentX402(payload, required, ctx)` NO cambia firma.
  El cuerpo de la función puede refactorizarse, pero el contrato export permanece idéntico.

- **CD-4:** Los logs nunca contienen signatures, private keys ni full authorization payloads.
  Usar el patrón de redaction existente en `usdcSettler.ts`. Cualquier log nuevo sigue la
  misma convención.

- **CD-5:** Idempotencia on-chain — si wasiai-facilitator responde con indicación de que el
  nonce ya fue consumido (`NONCE_ALREADY_USED` / HTTP 409), el router NO llama a Ultravioleta.
  El nonce EIP-3009 es global on-chain; reintentar con otro facilitator garantiza doble-gasto.

- **CD-6:** Chains NO en el allowlist → Ultravioleta es PRIMARY+ONLY. No breaking change en
  comportamiento para esas chains.

- **CD-7:** Cada AC de AC-1 a AC-11 tiene ≥ 1 test nombrado explícitamente en el archivo de tests.

- **CD-8:** `WASIAI_FACILITATOR_URL` sigue leyéndose a través de `getFacilitatorUrl()` para el
  path de Ultravioleta (WAS-V2-1). No duplicar esa lectura fuera de `x402-facilitator-config.ts`.

---

## Missing Inputs

| # | Tipo | Descripción | Estado |
|---|------|-------------|--------|
| MI-1 | CLARIFICATION | `packages/sdk/src/_future/x402.ts` y handlers `nextjs`/`express` mencionados en el prompt NO existen en el codebase (glob vacío). ¿El SDK está en un repo separado? ¿Se incluye en esta HU o es HU independiente? | [NEEDS CLARIFICATION — bloqueante para scope SDK] |
| MI-2 | INFO | El Architect debe confirmar si `CHAIN_TO_EIP155` en `x402-facilitator-client.ts` cubre Kite chains (`eip155:2366`, `eip155:2368`) — actualmente solo tiene `avalanche` y `avalanche-testnet`. | [resolver en F2 SDD] |
| MI-3 | INFO | Ultravioleta es consumida hoy como `uvd-x402-sdk@^2.25.0`. ¿El SDK expone un método de settle sincrónico para usar en fallback, o se hace también via HTTP POST? El Architect debe confirmar el contrato de integración en F2. | [resolver en F2 SDD] |

---

## Análisis de paralelismo

Esta HU NO bloquea otras HUs activas (HU-070 es UI/auth, sin overlap). Puede ir en paralelo
con cualquier HU que no toque `usdcSettler.ts` o `x402-facilitator-*.ts`.

### Waves propuestas para F3

| Wave | Archivos | Descripción |
|------|----------|-------------|
| W1 | `src/lib/contracts/x402-facilitator-config.ts` | Extender con `isWasiaiFacilitatorPrimary()` (lee `WASIAI_FACILITATOR_AS_PRIMARY`) + `WASIAI_CHAIN_ALLOWLIST` (const exportada). Test reset helper `__resetForTesting()` extendido. |
| W2 | `src/lib/contracts/facilitator-router.ts` (NEW) | Router puro: `trySettle(payload, required, ctx)` — lógica toggle × allowlist × fallback × idempotency guard. Sin estado de runtime. |
| W3 | `src/lib/contracts/usdcSettler.ts` + `.env.example` + tests | Refactorizar `settlePaymentX402()` para delegar a router. Telemetría AC-11. `.env.example` doc. Suite de tests AC-13/14/15. |

W1 → W2 (dependencia: router importa config). W2 → W3 (dependencia: settler importa router). Secuencial.

---

## Referencias

- Tx evidencia: `0x5fbf570bbc64d477586bb7aeaa71d5e6a1b4f6c540419172ec5b43f2e77733f2` (snowtrace.io)
- Operator Ultravioleta: `0x46140a86c01d930d2eaa9be7b4833d42b72c5f9b`
- Operator WasiAI (wasiai-facilitator): `0xf432baf1...7Ba`
- wasiai-facilitator URL: `https://wasiai-facilitator-production.up.railway.app`
- Pre-requisito WAS-V2-1: `doc/sdd/_INDEX.md` — DONE (external facilitator opt-in baseline)
- Decisión estratégica: 2026-05-11 (humano)
