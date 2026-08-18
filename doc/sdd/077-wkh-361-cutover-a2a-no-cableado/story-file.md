# Story File — #077: [WKH-361] Los headers del camino del dinero no atraviesan el proxy de v2

> SDD: `doc/sdd/077-wkh-361-cutover-a2a-no-cableado/sdd.md` — **SPEC_APPROVED 2026-08-18**
> Work item: `doc/sdd/077-wkh-361-cutover-a2a-no-cableado/work-item.md` rev. 2 — HU_APPROVED 2026-08-18
> Fecha: 2026-08-18
> Branch: `fix/077-wkh-361-contracting-headers-passthrough`
> Repo: `wasiai-v2` (marketplace, consumidor). `wasiai-a2a` es canónico y esa relación NO se invierte.

---

## 0. Base medida por el Architect (usá ESTE número, no uno heredado)

Medido hoy, 2026-08-18, en `/home/ferdev/.openclaw/workspace/wasiai-v2`:

```
git rev-parse HEAD          -> b55871347903ce1b8d99e661b04cdf1f34564657   (= main, = b558713 del SDD)
npm test                    -> Test Files  81 passed | 1 skipped (82)
                               Tests      693 passed | 5 skipped (698)
```

Citas cruzadas a `wasiai-a2a`: repo en `/home/ferdev/.openclaw/workspace/wasiai-a2a`,
`HEAD = 10a6eb1` ("merge(WKH-360): el coordinador es un agente, y no puede contratarse a si
mismo"). **Todas las líneas citadas en este documento se verificaron contra ese commit el
2026-08-18.** Si al implementar una cita no coincide → escalá (§13), no la "arregles" a ojo.

**Contadores de cierre por wave** (si el número no sube, el test no se está ejecutando — ver CD-14):

| Al cerrar | `Test Files` esperado | Archivos de test nuevos acumulados |
|---|---|---|
| W0 | 82 (sin cambio) | 0 |
| W1 | **84** | +2 (`delegation-off`, `delegation-manifest`) |
| W2 | **87** | +3 (`status/delegation`, `cron/delegation-drift`, `smoke-delegation`) |
| W3 | 87 (sin cambio) | 0 |

---

## 1. Goal

El proxy de `wasiai-v2` hacia `wasiai-a2a` **no reenvía** los headers del caller: los reconstruye
desde una lista blanca de 8 nombres (`src/lib/proxy/forward-handler.ts:39-48`, aplicada en `:79-82`).
Tres headers que el gateway **sí lee** no están en esa lista. El tercero, `x-payment-chain`, es un
**defecto en vivo con consecuencia en plata**: quien pide Base Sepolia a través del marketplace
recibe la cotización de Kite Ozone en 18 decimales y **no puede pagar**.

Esta HU (a) agrega los tres headers con un criterio de admisión **escrito en el código y
verificado por test**, y (b) instala el mecanismo que hoy no existe: poder contestar *qué ambiente
delega* sin ir a pegarle a mano, y **enterarse solo** cuando el gateway estrena un header.

---

## 2. El defecto, medido por el Architect (esto es el instrumento de regresión — NO lo resumas)

> Ninguna de estas llamadas mueve dinero. Las tres familias cortan **antes** de cobrar: `402` es
> el challenge x402 (*"esto es lo que tendrías que pagar"*), `400` es rechazo. El propio gateway
> lo dice textual en el body del 400 de contracting: *"La peticion se rechaza sin cobrar."*

### 2.1 `x-payment-chain` — el que cuesta plata (AC-1b)

Body: `{"steps":[{"agent":"wasi-chainlink-price"}]}` · sin key · sin firma.
`GATEWAY = https://wasiai-a2a-production.up.railway.app/compose` ·
`APP = https://app.wasiai.io/api/v1/compose`

```
1 GATEWAY        x-payment-chain ausente               -> 402 network=eip155:2368  maxAmountRequired=1010000000000000  asset=0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9
2 GATEWAY        x-payment-chain: base-sepolia         -> 402 network=eip155:84532 maxAmountRequired=1010              asset=0x036CbD53842c5426634e7929541eC2318f3dCF7e
3 GATEWAY        x-payment-chain: nonexistent-chain-xyz-> 400 {"error_code":"CHAIN_NOT_SUPPORTED","error":"Chain 'nonexistent-chain-xyz' is not a recognized slug or chainId"}
4 app.wasiai.io  x-payment-chain ausente               -> 402 network=eip155:2368  maxAmountRequired=1010000000000000  asset=0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9
5 app.wasiai.io  x-payment-chain: base-sepolia         -> 402 network=eip155:2368  maxAmountRequired=1010000000000000  asset=0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9   <- IDÉNTICO a (4)
6 app.wasiai.io  x-payment-chain: nonexistent-chain-xyz-> 402 network=eip155:2368  maxAmountRequired=1010000000000000  asset=0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9   <- IDÉNTICO a (4)

comparación byte-a-byte del bloque `accepts`:  (4)==(5) -> True     (4)==(6) -> True
```

**(4), (5) y (6) son byte-idénticos.** El header entra a v2 y no sale.
**Consecuencia en plata:** quien pasa por el marketplace y pide Base Sepolia recibe la cotización
de **Kite Ozone** (`eip155:2368`, token de 18 decimales, `1010000000000000`) en lugar de la de
**Base Sepolia** (`eip155:84532`, USDC de 6 decimales, `1010`). Firma para la red equivocada y no
puede pagar.

> **Tres campos discriminan, no dos.** Además de `network` y `maxAmountRequired`, cambia `asset`
> (`0x8E04…` vs `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, el USDC canónico de Base Sepolia).
> El smoke debe comparar `accepts[0]` completo, no un campo suelto.

**Esto sería falso si**: (5) devolviera `eip155:84532`, o si (6) devolviera `CHAIN_NOT_SUPPORTED`.
**Después del fix, (5) tiene que verse como (2) y (6) como (3).** Eso es AC-1b.

Confirmación independiente con una agent key real contra `app.wasiai.io` (medida por el
orquestador, `x-a2a-key` + `x-payment-chain: 43113`):

```
{"error":"chain 2368 (kite-ozone-testnet) balance is 0; no x-payment-chain header sent, used default …"}
```

El texto `"no x-payment-chain header sent"` lo emite el gateway **sólo** cuando
`defaultApplied === true` (`wasiai-a2a/src/middleware/a2a-key.ts:505-508`), que es exactamente la
rama del header **ausente** (`:364-382`). El header se mandó. Lo descartó `PASSTHROUGH_HEADERS`.

### 2.2 Los dos headers de contracting — la terna de AC-1

Body `{"steps":[]}`:

```
1 GATEWAY        x-a2a-contracting-depth: 99  -> 400 {"error":"Techo de profundidad de contratacion alcanzado. … La peticion se rechaza sin cobrar.","error_code":"CONTRACTING_DEPTH_EXCEEDED",…}
2 app.wasiai.io  x-a2a-contracting-depth: 99  -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"9717dd1e-d21d-489d-a7df-204efc04e767"}
3 app.wasiai.io  SIN header                   -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"50f3cf72-c17c-4e31-9d2d-507413d324c2"}
```

**(2) y (3) son la misma respuesta.** El gateway evalúa el guard **antes** de validar el body —
por eso (1) da `DEPTH_EXCEEDED` y (2) llega hasta la validación. Ese orden es lo que hace de la
terna un discriminador limpio: **después del fix, (2) tiene que volverse
`CONTRACTING_DEPTH_EXCEEDED` y dejar de parecerse a (3)**.

Los `requestId` distintos entre (2) y (3) descartan además que sea una respuesta cacheada. Y
`VALIDATION_ERROR` + `requestId` **no existen en ningún handler de este repo** (el 503 propio es
`{error, detail}`, `src/app/api/v1/compose/route.ts:20-27`) ⇒ `app.wasiai.io` **delega**.

### 2.3 Por qué esto pasó meses sin verse (CD-7)

**Un `200 OK` se ve igual con el header llegando y sin llegar.** Un `402` bien formado, también.
Por eso la prueba de AC-1/AC-1b **es la terna** —`gateway directo` / `app.wasiai.io con header` /
`app.wasiai.io sin header`— y no un status code. **CD-7 prohíbe** que el done-report afirme que los
headers llegan sin pegar las dos ternas completas contra un host nombrado y con fecha.

---

## 3. Acceptance Criteria (EARS) — copiados del SDD aprobado

**Grupo A — los headers**

- **AC-1**: WHEN el caller envía `x-a2a-contracting-chain` y/o `x-a2a-contracting-depth` con valor
  no vacío a `/api/v1/compose` o `/api/v1/orchestrate`, the system SHALL incluirlos, **con el valor
  recibido sin modificar**, en el request que emite hacia `wasiai-a2a`.
  *Evidencia exigida:* la respuesta de `app.wasiai.io` con `depth: 99` SHALL dejar de ser idéntica a
  la respuesta sin header, y SHALL contener `CONTRACTING_DEPTH_EXCEEDED`.
- **AC-1b**: WHEN el caller envía `x-payment-chain` con valor no vacío a `/api/v1/compose` o
  `/api/v1/orchestrate`, the system SHALL incluirlo, con el valor recibido sin modificar, en el
  request que emite hacia `wasiai-a2a`.
  *Evidencia exigida (money-path, costo cero):* con body
  `{"steps":[{"agent":"wasi-chainlink-price"}]}`, `app.wasiai.io` + `x-payment-chain: base-sepolia`
  SHALL devolver `402` con `accepts[0].network === "eip155:84532"` (hoy devuelve `eip155:2368`), y
  `app.wasiai.io` + `x-payment-chain: nonexistent-chain-xyz` SHALL devolver `400
  CHAIN_NOT_SUPPORTED` (hoy devuelve `402` con `eip155:2368`).
- **AC-2**: IF el caller NO envía uno de esos headers, THEN the system SHALL NO emitirlo upstream,
  **ni siquiera con valor vacío**.
- **AC-3**: the system SHALL reenviar hacia `wasiai-a2a` únicamente los headers de una lista blanca
  explícita, y SHALL NO reenviar `cookie` ni ningún header no listado.
- **AC-4**: WHEN corre `npm test`, the system SHALL fallar si la lista blanca cambia sin que se
  actualice el test que la fija.
- **AC-4b**: WHEN corre `npm test`, the system SHALL fallar si una entrada de la lista blanca no
  declara su consumidor con una cita `archivo:línea` de `wasiai-a2a`, salvo la única excepción
  declarada (`x-api-key`).

**Grupo B — que el ambiente se pueda contestar sin pegarle a mano**

- **AC-5**: WHEN se hace `GET /api/v1/status/delegation`, the system SHALL devolver `200` con
  **(a)** un identificador del ambiente que responde, **(b)** la lista de endpoints efectivamente
  delegados leída **del mismo módulo que deciden las rutas**, y **(c)** un booleano por cada una de
  `WASIAI_A2A_BASE_URL` y `WASIAI_V2_FORWARD_KEY`. the system SHALL NO incluir el **valor** de
  ninguna de las dos.
- **AC-6**: WHILE dos ambientes distintos respondan ese endpoint, the system SHALL devolver
  identificadores de ambiente **distintos entre sí**.
- **AC-7**: IF el conjunto de endpoints delegados observado en runtime difiere del declarado en el
  manifiesto versionado en git para ese ambiente, THEN the system SHALL emitir una señal observable
  sin intervención humana, nombrando **el ambiente** y **cada endpoint** que difiere.
- **AC-8**: IF el smoke post-deploy detecta que un endpoint declarado como delegado responde `503`
  con `*_DISABLED`, THEN el smoke SHALL terminar con código distinto de `0` y SHALL imprimir **el
  ambiente probado**, el endpoint, el status y el `error` recibido.
- **AC-11**: IF el Agent Card de `wasiai-a2a` declara un nombre de header que **no** está en la
  lista blanca del proxy, THEN el cron SHALL emitir la misma señal observable de AC-7, nombrando
  cada header faltante. IF el Agent Card **no se puede obtener**, THEN el cron SHALL reportarlo
  como advertencia y **NO** como divergencia.

**Grupo C — reversa**

- ~~**AC-9**~~ — **ELIMINADO** por DT-2(B+) (§10): declaraba *"cuando staging tenga las tres
  variables configuradas"*, premisa que con (B+) nunca se cumple. Un AC con premisa falsa se
  aprueba solo. **No lo implementes.**
- **AC-10**: WHILE `V2_DELEGATE_TO_A2A` esté vacío o ausente en un ambiente, the system SHALL
  responder `503` en `/compose` y `/orchestrate` en **ese** ambiente — o sea, la reversa devuelve
  exactamente el comportamiento previo.

---

## 4. Files to Modify/Create

| # | Wave | Archivo | Acción | Qué hacer | Exemplar |
|---|---|---|---|---|---|
| 1 | W0 | `src/lib/proxy/passthrough-headers.ts` | **Crear** | La lista blanca como **datos con criterio**: `{header, consumer, citation, why}`. Módulo **puro** | `src/lib/contracts/marketplaceAddressCoherence.ts` |
| 2 | W0 | `src/lib/proxy/delegation-manifest.ts` | **Crear** | Declaración por ambiente + `resolveDeclaration(host)`. Módulo **puro** | `src/lib/contracts/marketplaceAddressCoherence.ts` |
| 3 | W1 | `src/lib/proxy/forward-handler.ts` | Modificar | Consume la lista de W0; agrega `DELEGATED_ENDPOINT_ORDER`, `listDelegatedEndpoints()`, `isForwardKeyConfigured()`, `isA2aBaseUrlConfigured()` | él mismo `:79-82` · `wasiai-a2a/src/adapters/chain-resolver.ts:118-127` |
| 4 | W1 | `src/lib/proxy/__tests__/forward-handler.test.ts` | Modificar | T-01, T-01b, T-02, T-02b, T-02c, T-03, T-04, T-04b, T-11 | él mismo `:97`, `:112`, `:142` |
| 5 | W1 | `src/lib/proxy/__tests__/delegation-off.test.ts` | **Crear** | T-10 (AC-10) — **archivo propio con su propio `vi.mock('@/lib/env')`** | `src/lib/proxy/__tests__/forward-handler.test.ts:8-15` |
| 6 | W1 | `src/lib/proxy/__tests__/delegation-manifest.test.ts` | **Crear** | T-12 | ídem |
| 7 | W2 | `src/app/api/v1/status/delegation/route.ts` | **Crear** | AC-5, AC-6 | `src/app/api/cron/reconcile-onchain/route.ts:9` (runtime) |
| 8 | W2 | `src/app/api/v1/status/delegation/__tests__/route.test.ts` | **Crear** | T-05, T-06 | `src/app/api/cron/__tests__/process-refunds.test.ts:7-28` |
| 9 | W2 | `src/app/api/cron/delegation-drift/route.ts` | **Crear** | AC-7, AC-11 | `src/app/api/cron/reconcile-onchain/route.ts:12-16` |
| 10 | W2 | `src/app/api/cron/delegation-drift/__tests__/route.test.ts` | **Crear** | T-07, T-07b, T-09, T-09b | `src/app/api/cron/__tests__/process-refunds.test.ts:7-52` |
| 11 | W2 | `scripts/smoke-delegation.mjs` | **Crear** | AC-8 + las dos ternas. Host obligatorio. ESM puro de Node, **sin dependencias** | `scripts/i18n-sync.mjs` (¡**no** `i18n-audit.mjs`, ver §6.6) |
| 12 | W2 | `src/lib/proxy/__tests__/smoke-delegation.test.ts` | **Crear** | T-08, T-08b — **ubicación corregida, ver CD-14** | `src/lib/proxy/__tests__/forward-handler.test.ts` |
| 13 | W2 | `vercel.json` | Modificar | Registrar el 5.º cron `{"path":"/api/cron/delegation-drift","schedule":"0 6 * * *"}` | él mismo `:2-19` |
| 14 | W2 | `package.json` | Modificar | `"smoke:delegation": "node scripts/smoke-delegation.mjs"` — **sin host** | él mismo `:33` (`validate:env`) |
| 15 | W3 | `scripts/validate-env.js` | Modificar | Regla **condicional** para las 3 vars | él mismo `:62-81`, `:119-134` |
| 16 | W3 | `.env.example` | Modificar | Orden de encendido/apagado (CD-1) junto a `:105`/`:109`/`:118` | él mismo |
| 17 | W3 | `CLAUDE.md` | Modificar | La fila de `wasiai-prod` (`:10`) nombra `app.wasiai.io`; el estado del cutover pasa a ser **un puntero al endpoint** | él mismo `:7-10` |
| 18 | W0–W3 | `doc/sdd/077-wkh-361-cutover-a2a-no-cableado/auto-blindaje.md` | **Crear** | Un bloque por error real cometido (formato: `doc/sdd/076-…/auto-blindaje.md`) | `doc/sdd/076-wkh-162-marketplace-address-config-drift/auto-blindaje.md` |

**Nada fuera de esta tabla se toca.** Ver §12 (Out of Scope).

### 4.b Fix-pack del AR (2026-08-18) — qué archivos suma, y por qué cada uno

El AR (`ar-report.md`) devolvió **RECHAZADO** con 1 `BLQ-MED` + 1 `BLQ-BAJO` + 5 `MNR`. El fix-pack
**no agrega ninguna capacidad**: cierra hallazgos. Los 2 archivos nuevos son de **test**.

| # | Archivo | Acción | Hallazgo que cierra |
|---|---|---|---|
| 19 | `src/lib/proxy/passthrough-headers.ts` | Modificar | `BLQ-MED-1` — `REJECTION_FAMILIES` / `REVERSAL_WATCHLIST` / `WKH_361_NEW_HEADERS`: el radio de impacto pasa de prosa a datos versionados |
| 20 | `src/lib/proxy/__tests__/forward-handler.test.ts` | Modificar | `BLQ-MED-1` — `T-FP-1`…`T-FP-6` |
| 21 | `scripts/smoke-delegation.mjs` | Modificar | `BLQ-BAJO-1` (INCONCLUSO en los pasos 3/4/4b + OMITIDO del paso 2) y `MNR-3` (paso 4b) |
| 22 | `src/lib/proxy/__tests__/smoke-delegation.test.ts` | Modificar | `BLQ-BAJO-1` + `MNR-3` |
| 23 | `scripts/validate-env.js` | Modificar | `MNR-1` (cita re-medida) + `MNR-2` (main-guard + exports) |
| 24 | `.env.example` | Modificar | `MNR-1` (la misma cita, duplicada) |
| 25 | `src/lib/proxy/__tests__/validate-env-delegation.test.ts` | **Crear** | `MNR-2` — el único control automático de `checkDelegationTrio` |
| 26 | `src/app/api/v1/status/delegation/route.ts` | Modificar | `MNR-4` — sale `commitSha`, queda `deploymentId` con el motivo escrito |
| 27 | `src/app/api/v1/status/delegation/__tests__/route.test.ts` | Modificar | `MNR-4` |
| 28 | `src/app/api/v1/compose/__tests__/proxy-headers.test.ts` | **Crear** | `MNR-5` — el eslabón `route → new NextRequest → forwardRequest → fetch`, sin mockear `forwardRequest` |
| 29 | `doc/sdd/077-…/story-file.md` | Modificar | `BLQ-MED-1` (§13), `MNR-4` (§5.2), el cómo-se-mide de `[TBD-3]` (§11) |

---

## 5. Contrato de Integración ⚠️ BLOQUEANTE

### 5.1 `wasiai-v2` (proxy) → `wasiai-a2a` (gateway) — los 11 headers

`src/lib/proxy/passthrough-headers.ts` (nuevo, **puro**):

```ts
export type PassthroughConsumer = 'read' | 'framework' | 'transport' | 'none'

export interface PassthroughHeaderEntry {
  /** siempre en minúsculas */
  header: string
  consumer: PassthroughConsumer
  /** 'wasiai-a2a/src/…:NNN' — null SÓLO para consumer === 'none' */
  citation: string | null
  /** una línea, en castellano */
  why: string
}

export const PASSTHROUGH_HEADER_ENTRIES: readonly PassthroughHeaderEntry[] = [ /* 11, abajo */ ]
export const PASSTHROUGH_HEADERS: readonly string[] = PASSTHROUGH_HEADER_ENTRIES.map(e => e.header)
```

**Contenido exacto — 11 entradas: las 8 de hoy EN EL MISMO ORDEN, + las 3 nuevas al final.**
Todas las citas verificadas contra `wasiai-a2a` @ `10a6eb1` el 2026-08-18.

| # | `header` | `consumer` | `citation` | `why` (una línea) |
|---|---|---|---|---|
| 1 | `x-payment` | `read` | `wasiai-a2a/src/middleware/x402.ts:517` | el challenge x402 canónico; sin él no hay pago |
| 2 | `payment-signature` | `read` | `wasiai-a2a/src/middleware/x402.ts:518` | forma legacy del mismo pago (`x-payment` gana) |
| 3 | `x-a2a-key` | `read` | `wasiai-a2a/src/middleware/a2a-key.ts:546` | credencial de agent key prepaga |
| 4 | `x-api-key` | **`none`** | **`null`** | **alias muerto**: en todo `wasiai-a2a/src/` aparece UNA vez y es un fixture (`src/services/registry.redaction.test.ts:319`). Medido 2026-08-18. Se conserva por regresión cero — ver §10 DT-8 / A-5 |
| 5 | `authorization` | `read` | `wasiai-a2a/src/middleware/a2a-key.ts:551` | `Bearer` con prefijo `wasi_a2a_` (`:554`) |
| 6 | `content-type` | `transport` | `wasiai-a2a/src/routes/compose.ts:326` | el parser de Fastify puebla `request.body` sólo si el content-type matchea |
| 7 | `user-agent` | `framework` | `wasiai-a2a/src/lib/logger.test.ts:43` | sobrevive `REDACT_PATHS` (`src/index.ts:156`): es el log de request |
| 8 | `x-forwarded-for` | `framework` | `wasiai-a2a/src/index.ts:163` | `trustProxy` resuelve `request.ip` desde acá (`:158`) |
| 9 | **`x-a2a-contracting-chain`** | `read` | `wasiai-a2a/src/lib/contracting-chain.ts:769` | capa 2 del guard anti-bucle de WKH-360 (paso 3 en `:806-818`) |
| 10 | **`x-a2a-contracting-depth`** | `read` | `wasiai-a2a/src/lib/contracting-chain.ts:820` | techo de profundidad (paso 4, `:820-827`) |
| 11 | **`x-payment-chain`** | `read` | `wasiai-a2a/src/middleware/a2a-key.ts:358` | **en qué red se cotiza y se cobra**; también `x402.ts:425`, `routes/compose.ts:107`, `routes/gasless.ts:77` |

**Invariante que verifica T-04b** (esto es lo que evita que la lista vuelva a quedarse atrás):
> toda entrada con `consumer !== 'none'` tiene `citation` **no vacía**, **y** `x-api-key` es la
> **única** entrada con `consumer === 'none'` / `citation === null`.

**Docblock obligatorio del archivo** — el criterio de admisión completo (DT-1). Un header entra si
cumple **las tres**:
1. **Tiene un consumidor citable en `wasiai-a2a`**, en una de tres categorías, y la cita va **al
   lado** del header: `read` (un `headers['…']` explícito), `framework` (lo consume el framework de
   forma documentada), `transport` (semántica de transporte obligatoria).
2. **No es credencial de v2 ni identidad del navegador.** Quedan afuera **por definición**:
   `cookie`, `set-cookie`, `referer`, `origin`, `host`, `x-vercel-*`, `x-middleware-*`.
3. **Su ausencia es semánticamente distinta de un valor vacío, y el reenvío preserva esa
   distinción.** Por eso la guarda `if (v)` de `forward-handler.ts:81` **se conserva tal cual**.

### 5.2 `GET /api/v1/status/delegation` — respuesta `200`

`export const runtime = 'nodejs'` · `export const dynamic = 'force-dynamic'` ·
header `Cache-Control: no-store`.

> El `no-store` **no es cosmético**: una respuesta de estado cacheada en el borde podría contestar
> por un despliegue que no es el que atendió — que es literalmente la familia de error de esta HU.

```json
{
  "environment": {
    "host":         "app.wasiai.io",
    "vercelEnv":    "production",
    "deploymentId": "dpl_xxx",
    "declaredAs":   "wasiai-prod"
  },
  "delegation": {
    "runtime":  ["capabilities", "compose", "orchestrate"],
    "declared": ["capabilities", "compose", "orchestrate"],
    "match":    "MATCH"
  },
  "config": { "WASIAI_A2A_BASE_URL": true, "WASIAI_V2_FORWARD_KEY": true },
  "passthroughHeaders": ["x-payment", "…", "x-payment-chain"],
  "checkedAt": "2026-08-18T00:00:00.000Z"
}
```

| Campo | Tipo | Origen exacto |
|---|---|---|
| `environment.host` | `string \| null` | `req.headers.get('host')`, normalizado (minúsculas, sin puerto) |
| `environment.vercelEnv` | `'production' \| 'preview' \| 'development' \| null` | `process.env.VERCEL_ENV ?? null` |
| `environment.deploymentId` | `string \| null` | `process.env.VERCEL_DEPLOYMENT_ID ?? null` |
| ~~`environment.commitSha`~~ | **ELIMINADO** | fix-pack AR `MNR-4` — ver abajo |
| `environment.declaredAs` | `'wasiai-prod' \| 'wasiai-v2' \| null` | `resolveDeclaration(host)?.key ?? null` |
| `delegation.runtime` | `string[]` **ordenado alfabéticamente** | `listDelegatedEndpoints()` — **nunca** `process.env` |
| `delegation.declared` | `string[] \| null` **ordenado alfabéticamente** | `resolveDeclaration(host)?.delegated ?? null` |
| `delegation.match` | `'MATCH' \| 'DRIFT' \| 'UNDECLARED_HOST'` | comparación **como conjunto** (§6.4) |
| `config.WASIAI_A2A_BASE_URL` | `boolean` | `isA2aBaseUrlConfigured()` |
| `config.WASIAI_V2_FORWARD_KEY` | `boolean` | `isForwardKeyConfigured()` |
| `passthroughHeaders` | `string[]` | `PASSTHROUGH_HEADERS` — **NOMBRES, jamás valores** |
| `checkedAt` | ISO 8601 | `new Date().toISOString()` |

**Qué se expone y por qué no es un secreto** (va también en el docblock): dos booleanos de
**presencia** (nunca los valores — AC-5), los **nombres** de header reenviados, el conjunto de
endpoints delegados, y `deploymentId`. **No** aparecen `WASIAI_A2A_BASE_URL`,
`WASIAI_V2_FORWARD_KEY`, ni su longitud.

⚠️ **`commitSha` SE SACÓ en el fix-pack del AR (`MNR-4`).** `wasiai-v2` es un repo **PÚBLICO** con
`doc/sdd/**` versionado (riesgos residuales y TD abiertos incluidos): publicar sin auth el commit
exacto que corre `app.wasiai.io` permite cruzar *qué está desplegado* con *qué se sabe que todavía
no está arreglado*. Ningún AC lo pedía — AC-5 pide **un** identificador y AC-6 pide que dos
ambientes den identificadores **distintos**, y eso lo cubren `host` + `declaredAs` + `vercelEnv` +
`deploymentId`. `deploymentId` **se queda** porque es lo único que distingue **dos despliegues del
mismo commit** (la pregunta exacta del cutover: *¿ya corrió el redeploy manual de `wasiai-prod`?*),
es la evidencia declarada de AC-6 (`sdd.md:730`) y es opaco: no se resuelve a código sin credencial
de Vercel. Lo fija `route.test.ts` con la env **presente** (con la env ausente el campo daría `null`
igual y el test pasaría sin medir nada).

⚠️ **Y una afirmación que había que corregir**: el docblock decía que éstos eran *"datos de
despliegue que Vercel ya publica por su cuenta"*. **Medido el 2026-08-18: falso para `dpl_…`.** Lo
que Vercel manda sin auth en cada respuesta es `x-vercel-id: iad1::iad1::<traza>`, que es un id de
**petición**, no el de despliegue. Este endpoint es el que lo estrena, y se decide con eso a la
vista. Quien quiera saber si el fix de esta HU está desplegado tiene una respuesta mejor que un sha
en `passthroughHeaders`: ahí se lee si `x-payment-chain` está en la lista blanca **de ese
despliegue**. Es el hecho, no un puntero a él.

**`host` lo escribe el caller.** Es identidad **informativa**, no un borde de autenticación. Por eso
la respuesta devuelve **el host crudo junto a `declaredAs`**: si alguien falsea el `Host`, se ve en
la misma respuesta. Como el endpoint no expone secretos, falsear el `Host` no habilita nada.
**No** agregues auth a este endpoint.

### 5.3 `GET /api/cron/delegation-drift`

Primera línea del handler: `verifyCronAuth(req.headers.get('authorization'))`.
`export const runtime = 'nodejs'`.

Dos comparaciones **independientes**:

| # | Comparación | Veredicto duro | AC |
|---|---|---|---|
| 1 | `listDelegatedEndpoints()` vs `resolveDeclaration(host)?.delegated` | `DELEGATION_DRIFT` (con `missing[]` y `unexpected[]`) o `UNDECLARED_HOST` | AC-7 |
| 2 | nombres de header del Agent Card vs `PASSTHROUGH_HEADERS` | `HEADER_WHITELIST_DRIFT` (con `missing[]`) | AC-11 |

Para (2): `GET ${env.WASIAI_A2A_BASE_URL}/.well-known/agent.json` con `AbortController` (10 s).
Extracción: `contracting.chainHeader` y `contracting.depthHeader` **si son strings**; se ignora
todo lo demás.

⛔ **Card inalcanzable, o sin bloque `contracting`, o con los campos no-string ⇒
`agentCard.reachable: false` y veredicto `WARN`, NUNCA `DRIFT`.** Apagar el gateway no puede
fabricar una alarma de lista blanca. *Sería falso si* con el gateway caído el cron reportara
`HEADER_WHITELIST_DRIFT`.

Status: `200` si los dos veredictos son `MATCH` (o `MATCH` + `WARN`); **`500`** con el detalle en el
body si cualquiera es drift. Tres canales de señal (§10 DT-6):
1. **el `500`** (no depende de ninguna env — es el canal primario);
2. `logger.error` estructurado de `@/lib/logger`;
3. `Sentry.captureMessage` **best-effort**, con un comentario en el código que diga textualmente que
   es **no-op sin `SENTRY_DSN`** y cite `sentry.server.config.ts:3`.

---

## 6. Exemplars verificados (todos abiertos con `Read`/`grep` el 2026-08-18)

### 6.1 El bucle de copia — `src/lib/proxy/forward-handler.ts:75-82` (NO se toca la guarda)

```ts
  const forwardHeaders: Record<string, string> = {
    'x-wasiai-forward-key': forwardKey,
    'x-wasiai-source': 'v2-proxy',
  }
  for (const h of PASSTHROUGH_HEADERS) {
    const v = req.headers.get(h)
    if (v) forwardHeaders[h] = v          // <- línea 81. NO TOCAR (CD-3)
  }
```

Lo único que cambia acá es de dónde viene `PASSTHROUGH_HEADERS`: se borra el arreglo local
`:39-48` y se importa de `./passthrough-headers`.

### 6.2 Unión exhaustiva — `wasiai-a2a/src/adapters/chain-resolver.ts:118-127`

```ts
const CHAIN_VM_FAMILY: Record<ChainKey, ChainVmFamily> = {
  'kite-ozone-testnet': 'evm',
  … las 8 …
};
```

Patrón a copiar en `forward-handler.ts`, reemplazando la unión suelta de `:50`:

```ts
export type DelegatedEndpoint = 'compose' | 'orchestrate' | 'capabilities' | 'mcp'

const DELEGATED_ENDPOINT_ORDER: Record<DelegatedEndpoint, true> = {
  compose: true, orchestrate: true, capabilities: true, mcp: true,
}
export const DELEGATED_ENDPOINT_VALUES = Object.keys(DELEGATED_ENDPOINT_ORDER) as DelegatedEndpoint[]
```

**Agregar un miembro a la unión sin clasificarlo acá NO compila.** Ese es el punto.

### 6.3 Módulo puro — `src/lib/contracts/marketplaceAddressCoherence.ts:20-22`

> *"Kept as a standalone pure module (no `server-only`, no viem) so it can be imported … without
> dragging the server-only marker into the route's module graph, and unit-tested in isolation."*

Los dos módulos de W0 siguen exactamente eso: **sin `import 'server-only'`, sin `@/lib/env`, sin
I/O** (CD-8).

### 6.4 Mock de `@/lib/env` a nivel de archivo — `src/lib/proxy/__tests__/forward-handler.test.ts:8-15`

```ts
vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: 'compose,orchestrate,capabilities',
    NODE_ENV: 'test',
  },
}))
```

⚠️ **OBLIGATORIO en TODO test que importe (directa o transitivamente) `@/lib/env`** — o sea:
`forward-handler.test.ts`, `delegation-off.test.ts`, el test del status endpoint y el del cron.
`src/lib/env.ts:13` tiene `import 'server-only'`, que **lanza al colectar** bajo vitest
(`doc/sdd/076-…/auto-blindaje.md`). Medido: **ningún** test del repo mockea `server-only`
directamente; el patrón que funciona es mockear `@/lib/env`.

Aserción sobre headers reenviados (`:97`, `:112`, `:142`):

```ts
const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
expect(headers['x-payment']).toBe('sig-abc')
```

### 6.5 Ruta de cron + su test — `src/app/api/cron/reconcile-onchain/route.ts:9-16` y `src/app/api/cron/__tests__/process-refunds.test.ts:7-52`

```ts
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = verifyCronAuth(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  …
}
```

El test: `vi.hoisted` para los spies, `vi.mock('@/lib/logger', …)`, `process.env.CRON_SECRET` en
`beforeEach`, y los 4 casos ya escritos (401 mismatch, 401 sin header, 500 sin `CRON_SECRET`, 200 ok).
Copiá esa estructura.

### 6.6 Script `.mjs` — el exemplar correcto es `scripts/i18n-sync.mjs`, **NO** `i18n-audit.mjs`

⚠️ **Corrección al SDD §4.3.** `scripts/i18n-audit.mjs:5` hace `import { chromium } from 'playwright'`
— **tiene dependencia**. El exemplar que sí es "Node puro" es `scripts/i18n-sync.mjs`: sólo
builtins (`:11-12` `fs`/`path`), `process.argv.slice(2)` (`:28`), `process.exit(0)` (`:36`) /
`process.exit(1)` (`:51`).

Y **`tsx` NO es dependencia de este repo** (medido: no está en `dependencies` ni en
`devDependencies`; `test:e2e:fuji` lo baja con `npx` en el momento). ⇒ **el smoke se escribe en
`.mjs` con `fetch` de Node 20+** (`package.json:5-7` declara `"node": ">=20.0.0"`), sin build y
sin dependencias. No lo conviertas en `.ts`.

---

## 7. Constraint Directives

### PROHIBIDO

- **CD-1** — setear `V2_DELEGATE_TO_A2A` en **cualquier** ambiente donde `WASIAI_A2A_BASE_URL` o
  `WASIAI_V2_FORWARD_KEY` no estén ya presentes y desplegadas. Medido: `src/lib/env.ts:75-86` +
  `:94` ⇒ throw en carga de módulo ⇒ **500 en toda ruta que importe `@/lib/env`**, no un 503
  acotado. *(Esta HU no toca ninguna env var — la directiva vive para el texto de `.env.example` y
  `validate-env.js` de W3.)*
- **CD-2** — reemplazar la lista blanca por un reenvío de `req.headers` completo, o agregar un
  header sin **las tres** condiciones de §5.1 escritas al lado, con el consumidor citado en
  `archivo:línea` de `wasiai-a2a`.
- **CD-3** — emitir `x-a2a-contracting-chain`, `x-a2a-contracting-depth` **o `x-payment-chain`** con
  valor vacío. **La guarda `if (v)` de `forward-handler.ts:81` no se toca.**
  **Ausente ≠ vacío. Medido, header por header — y NO son el mismo caso, no escribas un test que
  afirme lo contrario:**

  | Header emitido con `''` | Qué hace el gateway | Cita |
  |---|---|---|
  | `x-a2a-contracting-depth: ''` | **400 `CONTRACTING_DEPTH_MALFORMED`** — `''` no pasa `DECIMAL_1_TO_3_DIGITS` | `wasiai-a2a/src/lib/contracting-chain.ts:822-825` |
  | `x-payment-chain: ''` | **400 `CHAIN_NOT_SUPPORTED`** — `normalizeChainSlug('')` da `undefined` por `key.length === 0`, y `resolveTargetChain` contesta 400 porque `headerOverride !== undefined` | `wasiai-a2a/src/adapters/chain-resolver.ts:422` + `src/middleware/a2a-key.ts:365-370` |
  | `x-a2a-contracting-chain: ''` | **se absorbe como ausente** (`rawChain.trim().length === 0` ⇒ `rawElements = []`), NO da malformed | `wasiai-a2a/src/lib/contracting-chain.ts:792-795` |

  ⇒ Dos de los tres convierten peticiones que hoy funcionan en **400**. La regla (nunca emitir
  vacío) es igual para los tres; la **razón** no, y el test tiene que reflejar lo medido.
- **CD-5** — escribir o desplegar cualquier cambio en el repo `wasiai-a2a` (ni `src/`, ni su
  `CLAUDE.md`, ni su Agent Card). Leerlo está bien; escribirlo no. Sale como A-1 / A-3.
- **CD-6** — decir **"producción" a secas** en cualquier artefacto de esta HU (código, comentarios,
  tests, commits, auto-blindaje). Siempre **proyecto Vercel + dominio**: `wasiai-prod` /
  `app.wasiai.io`, `wasiai-v2` / `wasiai-v2.vercel.app`. Es la regla que sale del error que abrió
  esta HU.
- **CD-7** — afirmar que los headers llegan sin pegar **las dos ternas completas** (§2.1 y §2.2)
  contra un host nombrado y con fecha. Un `200 OK` **no** distingue "llegó" de "no llegó".
- **CD-8** — que `passthrough-headers.ts` o `delegation-manifest.ts` importen `server-only`,
  `@/lib/env`, o hagan I/O. Motivo medido: `doc/sdd/076-…/auto-blindaje.md` — `import 'server-only'`
  en el grafo de un test lo hace **fallar al colectar**.
- **CD-9** — modificar el campo `delegated` del manifiesto para que coincida con lo observado en
  runtime y así callar al cron. `hosts` es **descriptivo** (se corrige con medición, con la
  evidencia en el PR); `delegated` es **la intención** y sólo cambia por decisión explícita.
- **CD-10** — que el cron trate un Agent Card inalcanzable como divergencia de la lista blanca.
  Gateway caído ⇒ `WARN`, jamás `HEADER_WHITELIST_DRIFT`.
- **CD-11** — que el endpoint de AC-5 devuelva el **valor** (o la longitud) de
  `WASIAI_A2A_BASE_URL` o `WASIAI_V2_FORWARD_KEY`, o que se sirva sin `Cache-Control: no-store`.
- **CD-12** — tocar `x-api-key` en esta HU: ni sacarlo de la lista, ni cambiar las dos pantallas
  (`DemoPageClient.tsx:93`, `PipelinePageClient.tsx:84`). Su estado de alias muerto se **documenta**
  (§10 DT-8) y se resuelve en A-5.

### OBLIGATORIO

- **CD-4** — el endpoint de estado y el cron consumen el **mismo símbolo** que consumen las rutas
  (`isDelegated` vía `listDelegatedEndpoints`), **sin releer `process.env`** para el conjunto
  delegado. Dos razones: (a) recalcular la fórmula que vigilás es un guard que se aplaude a sí
  mismo; (b) `DELEGATED` se **congela en carga de módulo** (`forward-handler.ts:59`), así que leer
  la env en vivo puede reportar un valor que **las rutas no están usando**.
  **No** exportes el `Set` `DELEGATED` (sería mutable desde afuera).
- **CD-13** — correr `npm test` **completo** antes de cerrar **cada** wave, no sólo los tests
  nombrados acá (lección de `075/auto-blindaje.md`: la lista de "tests a ajustar" de un story file
  **nunca es exhaustiva**). Y **antes** de agregar un parámetro a cualquier función ya mockeada:
  `git grep "toHaveBeenCalledWith\|toHaveBeenNthCalledWith"` y **contar argumentos** — vitest compara
  el array de args por longitud **y** valor, `[a,b,c] ≠ [a,b,c,undefined]` (lección de
  `074/auto-blindaje.md`).
- **CD-14 (NUEVA — medida por el Architect hoy)** — **todo archivo de test tiene que vivir bajo
  `src/` y llamarse `*.test.ts` / `*.test.tsx`.**
  Medido: `vitest.config.ts:10` fija `include: ['src/**/*.test.{ts,tsx}']`. Sonda ejecutada el
  2026-08-18: con `scripts/__tests__/zz-probe.test.ts` presente, `npm test` sigue reportando
  **exactamente 82 test files / 698 tests** — el mismo número que sin él; y `npx vitest run
  scripts/__tests__/zz-probe.test.ts` responde `No test files found` imprimiendo
  `include: src/**/*.test.{ts,tsx}`.
  ⇒ **El `scripts/__tests__/smoke-delegation.test.ts` que propone el SDD §10 (T-08) NUNCA correría,
  `npm test` quedaría verde y AC-8 tendría cobertura CERO.** Es exactamente la enfermedad que esta
  HU cura, un piso más abajo. Por eso T-08/T-08b se mudan a
  `src/lib/proxy/__tests__/smoke-delegation.test.ts`, importando el script por ruta relativa
  (`../../../../scripts/smoke-delegation.mjs`).
  **Verificación al cerrar cada wave**: el contador `Test Files` de §0 tiene que **subir** por el
  número exacto de archivos nuevos. Si no sube, el test no existe para el runner.
- **CD-15 (NUEVA)** — `scripts/smoke-delegation.mjs` **no ejecuta nada al importarse**. Toda su
  lógica pura va en funciones exportadas; el CLI corre detrás de un main-guard
  (`import.meta.url === pathToFileURL(process.argv[1]).href`). Si no, importarlo desde el test
  dispara el smoke contra la red durante `npm test`.
  Contexto que lo hace importante: `scripts/**` está **fuera del typecheck** (`tsconfig.json:35-44`
  no lo incluye) **y fuera del lint** (`eslint.config.mjs:17` lo ignora). El test de §4 #12 es su
  **único** control automático.
- **CD-16 (NUEVA)** — comparar conjuntos de endpoints **como conjuntos**, nunca por igualdad de
  array. `delegation.runtime` y `delegation.declared` se emiten **ordenados alfabéticamente**, y la
  comparación del cron usa diferencia de conjuntos (`missing` / `unexpected`). Un `DRIFT` disparado
  por orden de inserción es una alarma falsa diaria.
- **CD-17 (NUEVA)** — TypeScript strict del repo: `noUncheckedIndexedAccess: true` y
  `exactOptionalPropertyTypes: true` (`tsconfig.json:14-15`). `PASSTHROUGH_HEADER_ENTRIES[0]` es
  `PassthroughHeaderEntry | undefined`; un campo opcional no acepta `undefined` explícito. Sin `any`
  explícito, en ningún archivo.
- **Sin dependencias nuevas.** Ninguna. El smoke usa `fetch` de Node 20+.

---

## 8. Test Expectations

| ID | AC / DT | Archivo | Qué verifica | Qué lo hace fallar HOY |
|---|---|---|---|---|
| **T-01** | AC-1 | `src/lib/proxy/__tests__/forward-handler.test.ts` | los 2 headers de contracting llegan a `fetch` **con el valor exacto** | falla hoy: no están en la lista |
| **T-01b** | **AC-1b** | ídem | `x-payment-chain: base-sepolia` llega a `fetch` con el valor exacto | falla hoy |
| **T-02** | AC-2 | ídem | sin los 3 headers ⇒ `headers['x-…']` es `undefined`, **no `''`** | pasaría a fallar si alguien cambia `if (v)` por `if (v !== null)` |
| **T-02b** | AC-2 / CD-3 | ídem | con los 3 en `''` ⇒ **no se emiten** | ídem |
| **T-02c** | AC-2 | ídem | `x-a2a-contracting-depth: '0'` ⇒ **sí se emite** (`'0'` es truthy en JS) | atrapa a quien "arregle" la guarda con `Number(v)` |
| **T-03** | AC-3 | ídem (extiende `:132-146`) | `cookie`, `host`, `origin`, `set-cookie`, `referer`, `x-vercel-id`, `x-middleware-…` **no** se reenvían | |
| **T-04** | AC-4 | ídem | `PASSTHROUGH_HEADERS` **igual al arreglo literal de 11, en orden** | cualquier alta/baja rompe la suite |
| **T-04b** | **AC-4b** | ídem | toda entrada con `consumer !== 'none'` tiene `citation` no vacía **y** `x-api-key` es la **única** con `consumer === 'none'` | agregar un header sin cita rompe |
| **T-11** | CD-4 | ídem | `listDelegatedEndpoints()` devuelve el subconjunto correcto y `DELEGATED_ENDPOINT_VALUES` tiene los **4** miembros de la unión | |
| **T-10** | AC-10 | `src/lib/proxy/__tests__/delegation-off.test.ts` *(archivo propio)* | `vi.mock('@/lib/env')` con `V2_DELEGATE_TO_A2A: ''` ⇒ `POST /api/v1/compose` responde **503 `COMPOSE_DISABLED`** y `/orchestrate` **503 `ORCHESTRATE_DISABLED`** | hoy **no existe ningún test** del mundo no-delegado |
| **T-12** | §6 manifiesto | `src/lib/proxy/__tests__/delegation-manifest.test.ts` | `resolveDeclaration` normaliza mayúsculas y puerto; host desconocido ⇒ `null`; **ningún `hosts` se repite entre dos ambientes** | dos ambientes con el mismo host romperían AC-6 |
| **T-05** | AC-5 | `src/app/api/v1/status/delegation/__tests__/route.test.ts` | 200 con `environment` + `delegation.runtime` + los 2 booleanos; **el JSON serializado NO contiene el valor de `WASIAI_A2A_BASE_URL` ni de `WASIAI_V2_FORWARD_KEY`** (buscar el substring del valor mockeado en `JSON.stringify(body)`) | |
| **T-06** | AC-6 | ídem | dos requests con `Host` distinto ⇒ `environment` **distinto** y `declaredAs` distinto | atrapa un endpoint que ignore el host |
| **T-07** | AC-7 | `src/app/api/cron/delegation-drift/__tests__/route.test.ts` | manifiesto `[capabilities,compose,orchestrate]` vs runtime `[compose]` ⇒ **500** con `missing: ['capabilities','orchestrate']` y el `key` del ambiente | |
| **T-07b** | AC-7 | ídem | host desconocido ⇒ **500** `UNDECLARED_HOST` con el host crudo | |
| **T-09** | **AC-11** | ídem | card con `chainHeader` que **no** está en la lista ⇒ **500** `HEADER_WHITELIST_DRIFT` nombrando ese header | |
| **T-09b** | **AC-11** / CD-10 | ídem | el `fetch` del card **rechaza** ⇒ `reachable:false` + `WARN` + **200** | atrapa la alarma falsa por gateway caído |
| **T-08** | AC-8 | `src/lib/proxy/__tests__/smoke-delegation.test.ts` **(ver CD-14)** | un `503 COMPOSE_DISABLED` produce exit ≠ 0 y el mensaje trae **host, endpoint, status y `error`** | |
| **T-08b** | AC-8 | ídem | sin argumento de host ⇒ exit **2** + uso impreso | |

**Test-first**: sí para T-01, T-01b, T-02, T-02b, T-02c (lógica del money-path). El resto puede ir
después de la implementación de su wave, pero **antes** de cerrarla.

**Verificación externa, no automatizable** (va en F4, con host y fecha — CD-7): las dos ternas de
§2.1 y §2.2 contra `app.wasiai.io`, más la pata de control contra el gateway directo.

---

## 9. Waves

> **Regla de oro**: al cerrar cada wave, `npm test` **completo** (CD-13) **y** el contador de
> `Test Files` de §0 tiene que dar el número esperado (CD-14).

### Wave 0 — contratos y datos (SERIAL, gate: nada empieza antes)

Orden interno:

- [ ] **W0.1** — crear `src/lib/proxy/passthrough-headers.ts` con el contrato y las **11 entradas
      exactas** de §5.1, en ese orden, y el docblock con el criterio de admisión completo
      (las 3 condiciones + la lista de exclusiones por definición).
- [ ] **W0.2** — crear `src/lib/proxy/delegation-manifest.ts`:

```ts
export type DelegationEnvironmentKey = 'wasiai-prod' | 'wasiai-v2'

export interface DelegationEnvironmentDeclaration {
  key:           DelegationEnvironmentKey
  vercelProject: string
  hosts:         readonly string[]              // DESCRIPTIVO — medido
  delegated:     readonly DelegatedEndpoint[]   // PRESCRIPTIVO — la intención (CD-9)
  measuredAt:    string                         // 'YYYY-MM-DD'
  evidence:      string                         // el instrumento con el que se midió
}

export const DELEGATION_MANIFEST: readonly DelegationEnvironmentDeclaration[]
export function resolveDeclaration(host: string | null): DelegationEnvironmentDeclaration | null
```

  Contenido (medido 2026-08-18):

  | `key` | `vercelProject` | `hosts` | `delegated` | `evidence` |
  |---|---|---|---|---|
  | `wasiai-prod` | `wasiai-prod` | `app.wasiai.io`, `wasiai-prod.vercel.app` | `capabilities`, `compose`, `orchestrate` | `POST /api/v1/compose {"steps":[]}` ⇒ `VALIDATION_ERROR` + `requestId` (cuerpo del gateway); `GET /api/v1/capabilities?limit=1` ⇒ claves `registries/sources/catalogStatus/totalAtLeast` |
  | `wasiai-v2` | `wasiai-v2` | `wasiai-v2.vercel.app` | *(vacío)* | `POST /api/v1/compose` ⇒ `503 COMPOSE_DISABLED`; `capabilities` ⇒ `{agents,total,next_cursor}` (rama legacy, `capabilities/route.ts:369-372`) |

  - `mcp` **no** está delegado en ningún ambiente (`CLAUDE.md:101`).
  - `wasiai-prod.vercel.app` va en `hosts` porque `CLAUDE.md:10` lo declara.
  - `resolveDeclaration`: normaliza el host (minúsculas, sin puerto), match **exacto**, sin
    comodines. Host desconocido ⇒ `null` ⇒ `UNDECLARED_HOST`. **Fail-loud, nunca silencio.**
  - Comentario obligatorio (CD-9): `hosts` es **descriptivo**, `delegated` es **prescriptivo** y
    **jamás se ajusta a lo observado en runtime para callar al cron**.

**Cierra**: ningún AC por sí sola. **Verificación**: `npm run typecheck` verde ·
`npm test` = **82** test files (sin cambio).

---

### Wave 1 — el fix del camino del dinero (depende de W0) · **MERGEABLE SOLA**

Orden interno:

- [ ] **W1.1** — `src/lib/proxy/forward-handler.ts`:
  1. `import { PASSTHROUGH_HEADERS } from './passthrough-headers'` y **borrar** el arreglo local
     `:39-48`. El bucle `:79-82` **no cambia**; **la guarda `if (v)` de `:81` queda intacta** (CD-3).
  2. Reemplazar la unión suelta `:50` por el patrón exhaustivo de §6.2
     (`DELEGATED_ENDPOINT_ORDER` + `DELEGATED_ENDPOINT_VALUES`).
  3. `export function listDelegatedEndpoints(): DelegatedEndpoint[]` →
     `DELEGATED_ENDPOINT_VALUES.filter(isDelegated)`. **No** exportar `DELEGATED` (CD-4).
  4. `export function isForwardKeyConfigured(): boolean` con **la misma expresión** que hoy vive
     dentro de `assertForwardKeyConfigured` (`:30`: `!key || key.length === 0`), y
     `assertForwardKeyConfigured` pasa a **usarla**. Un solo predicado, dos consumidores: el
     endpoint de estado no puede decir `true` donde el proxy tiraría.
  5. `export function isA2aBaseUrlConfigured(): boolean` — mismo criterio de presencia sobre
     `env.WASIAI_A2A_BASE_URL`. *(Refinamiento del story file sobre el SDD: evita que la ruta de
     AC-5 lea `env` por su cuenta para uno de los dos booleanos — es CD-4 aplicado a los dos.)*

  ⛔ **Nada más cambia en este archivo.** No se toca el timeout (`:13`, `:91`), ni el mapeo de
  errores (`:107-129`), ni el `clearTimeout` de `:147`, ni `x-wasiai-source` (`:77`).

- [ ] **W1.2** — `src/lib/proxy/__tests__/forward-handler.test.ts`: agregar T-01, T-01b, T-02,
      T-02b, T-02c, T-04, T-04b, T-11 y **extender** el test existente de `:132-146` para T-03.
      ⚠️ Los tests existentes (`AC-2`…`AR MNR-4`) **quedan como están** — si alguno se rompe,
      leé CD-13 antes de tocarlo.
- [ ] **W1.3** — crear `src/lib/proxy/__tests__/delegation-off.test.ts` (T-10). **Archivo propio**
      porque `DELEGATED` se congela en carga de módulo (`forward-handler.ts:59`) y
      `vi.mock('@/lib/env')` es **por archivo**: no puede convivir con el mock de delegación
      encendida. Mockeá `@/lib/env` con `V2_DELEGATE_TO_A2A: ''` e importá los `POST` de
      `@/app/api/v1/compose/route` y `@/app/api/v1/orchestrate/route`.
- [ ] **W1.4** — crear `src/lib/proxy/__tests__/delegation-manifest.test.ts` (T-12).

**Cierra**: **AC-1, AC-1b, AC-2, AC-3, AC-4, AC-4b, AC-10**.
**Verificación**: `npm run typecheck` + `npm test` completo = **84** test files (83 passed + 1
skipped). T-01/T-01b tienen que **fallar antes** de W1.1 y pasar después.

---

### Wave 2 — anti-silencio (depende de W1) · **MERGEABLE POR SEPARADO, después de W1**

> W2 **no compila sin W1**: importa `listDelegatedEndpoints`, `isForwardKeyConfigured`,
> `isA2aBaseUrlConfigured` y `PASSTHROUGH_HEADERS`.

Orden interno:

- [ ] **W2.1** — `src/app/api/v1/status/delegation/route.ts` (contrato exacto en §5.2).
- [ ] **W2.2** — su test (T-05, T-06). Recordá `vi.mock('@/lib/env')` (§6.4).
- [ ] **W2.3** — `src/app/api/cron/delegation-drift/route.ts` (contrato exacto en §5.3).
- [ ] **W2.4** — su test (T-07, T-07b, T-09, T-09b).
- [ ] **W2.5** — `scripts/smoke-delegation.mjs`. Uso:
      `node scripts/smoke-delegation.mjs <host> [--gateway <url>]`.
      - **Sin `<host>` ⇒ exit 2 + uso.** No hay host por defecto: un smoke con host por defecto es
        el mismo footgun que abrió esta HU.
      - **Cada línea de salida empieza por el host probado.**
      - Main-guard obligatorio (CD-15).

      | Paso | Qué hace | Falla si |
      |---|---|---|
      | 1 | `GET /api/v1/status/delegation` | status ≠ 200. Imprime `environment` completo |
      | 2 | para cada endpoint de `delegation.runtime` ∩ `{compose, orchestrate}`: `POST` con body mínimo | responde `503` con `*_DISABLED` → **AC-8**: exit ≠ 0 + host + endpoint + status + `error` |
      | 3 | **terna de contracting** (§2.2): `POST /api/v1/compose {"steps":[]}` con y sin `x-a2a-contracting-depth: 99` | las dos respuestas son iguales, o la del header no contiene `CONTRACTING_DEPTH_EXCEEDED` |
      | 4 | **terna de `x-payment-chain`** (§2.1): body `{"steps":[{"agent":"wasi-chainlink-price"}]}` con `x-payment-chain: base-sepolia` y sin él | `accepts[0]` es igual en las dos, o con el header `network` no es `eip155:84532` |
      | 5 | con `--gateway`: los mismos pasos 3-4 contra el gateway directo | la **pata de control** no da el resultado esperado ⇒ el instrumento está roto, no el sistema |
      | 6 | `delegation.match !== 'MATCH'` | exit ≠ 0, **salvo** `vercelEnv === 'preview'`, donde imprime `PREVIEW_NOT_DECLARED` y **no** falla |

      **Ninguno de los 6 pasos mueve fondos.** Los pasos 3-5 cortan en 400/402.
- [ ] **W2.6** — `src/lib/proxy/__tests__/smoke-delegation.test.ts` (T-08, T-08b) sobre las
      funciones **puras** del script, importándolo por ruta relativa (CD-14).
- [ ] **W2.7** — `vercel.json`: agregar la 5.ª entrada
      `{"path": "/api/cron/delegation-drift", "schedule": "0 6 * * *"}` (las 4 existentes ocupan
      02:00–05:00 UTC, `:2-19`).
- [ ] **W2.8** — `package.json`: `"smoke:delegation": "node scripts/smoke-delegation.mjs"` —
      **sin host**, para que no se pueda correr por accidente contra nada.

**Cierra**: **AC-5, AC-6, AC-7, AC-8, AC-11**.
**Verificación**: `npm test` completo = **87** test files (86 passed + 1 skipped)
**+ la verificación manual obligatoria de `[TBD-2]`** (§11).

---

### Wave 3 — documentación y testigo (depende de W2)

- [ ] **W3.1** — `scripts/validate-env.js`: después de `checkEnv` (`:126`), una regla **condicional**
      (aditiva, no tocar `REQUIRED_VARS` de `:18-29`):
      - si `V2_DELEGATE_TO_A2A` está **no vacío** y falta `WASIAI_A2A_BASE_URL` **o**
        `WASIAI_V2_FORWARD_KEY` ⇒ **error + `process.exit(1)`**, con un mensaje que nombre CD-1 y
        diga **textualmente** que el efecto es **500 en toda ruta que importe `@/lib/env`**, no un
        503 acotado (`src/lib/env.ts:75-86` + `:94`).
      - si `V2_DELEGATE_TO_A2A` está vacío ⇒ nota informativa *"este ambiente NO delega"* (no es
        error).
      - **No** agregar las 3 vars a `REQUIRED_VARS`: haría fallar a todo ambiente que legítimamente
        no delega (hoy caen en `warnings`, `:76`, y el script sale `0`, `:133`).
      - Docblock: dejar escrito que este script **sigue sin saber en qué ambiente corre** — eso lo
        contesta el endpoint de AC-5. Decir lo contrario sería el over-claim que abrió esta HU.
- [ ] **W3.2** — `.env.example`: junto a `:105` / `:109` / `:118`, el **orden de encendido**
      (primero las 2 vars + deploy, después el flag + deploy) y el **orden de apagado**, que es el
      **inverso exacto**: primero el flag, después las vars. Borrar las vars dejando el flag es CD-1
      al revés y tira el ambiente entero con 500.
- [ ] **W3.3** — `CLAUDE.md`: la fila de `wasiai-prod` (`:10`) nombra **`app.wasiai.io`** (hoy dice
      `wasiai-prod.vercel.app`, que no es por donde entra el tráfico real), y el estado del cutover
      pasa a ser **un puntero a `GET /api/v1/status/delegation`** con el dominio y la fecha de la
      última verificación al lado. Una frase cierta sin instrumento envejece igual que una falsa —
      sólo que nadie la discute.
- [ ] **W3.4** — `doc/sdd/077-…/auto-blindaje.md`: un bloque por **error real cometido** durante
      F3 (formato de `076/auto-blindaje.md`: Error / Causa raíz / Fix / Aplicar en). Si no cometiste
      ninguno, el archivo **no se crea** — no lo llenes de relleno.

**Cierra**: ningún AC (documentación + instrumento). **Verificación**: `npm run qa`
(= `typecheck && lint && test && build`, `package.json:22`).

---

## 10. Decisiones ya tomadas — NO re-abrir

**DT-2 = (B+): `wasiai-v2` / `wasiai-v2.vercel.app` NO se alinea.** El motivo principal hay que
conservarlo porque **es la misma enfermedad que esta HU cura, sembrada del otro lado**:
`forward-handler.ts:77` emite `x-wasiai-source: 'v2-proxy'` — un **literal sin componente de
ambiente** — y `wasiai-a2a/src/middleware/forward-key.ts:87-99` loguea exactamente ese valor. Dos
proyectos Vercel ⇒ **una sola etiqueta en el log del gateway**. Además, alinear haría que
`wasiai-v2` consuma el mismo gateway que sirve a `wasiai-prod`, escribiendo recibos y telemetría en
la misma base. *Falsable*: si `x-wasiai-source` llevara el ambiente, el primer motivo cae.
⇒ **El primer testigo es el Preview de `wasiai-prod`. Si el Preview no delega, el primer testigo es
`app.wasiai.io`, y queda escrito** (`[TBD-1]`, §11). Agregarle el ambiente a `x-wasiai-source` es
**A-3b**, fuera de scope: cambia lo que ve el gateway y no tiene AC en esta HU.

**DT-8: las dos pantallas NO migran a `x-a2a-key` en esta HU.** Razón principal, **medida**: con
`x-a2a-key` el gateway responde `chain 2368 (kite-ozone-testnet) balance is 0; no x-payment-chain
header sent, used default` ⇒ cambiar sólo el nombre del header deja las dos pantallas en **403 en
Kite**, salvo que además elijan red — **lo cual depende de esta misma HU** (el passthrough de
`x-payment-chain`) y de una decisión de UI. *Sería falso si* una pantalla con `x-a2a-key` y sin
selector de red devolviera 200. Sale como **A-5**, ya desbloqueada por ésta.
`x-api-key` **se conserva** en la lista blanca marcado como alias muerto (CD-12), con T-04b
exigiendo que sea la **única** entrada sin lector citado.

**DT-7 y su residual — decilo sin adornar.** El card-diff del cron **habría cazado los dos headers
de contracting el día que WKH-360 se desplegó**. Medido hoy contra
`GET https://wasiai-a2a-production.up.railway.app/.well-known/agent.json`:

```
contracting = {"depthMax": 2, "chainHeader": "x-a2a-contracting-chain", "depthHeader": "x-a2a-contracting-depth", "bestEffortNote": "…"}
únicos strings con forma  x-…  en TODO el card:  ['x-a2a-contracting-chain', 'x-a2a-contracting-depth']
'x-payment-chain' presente en el card crudo:     False
```

⇒ **`x-payment-chain` NO está declarado en el agent card, así que el mecanismo NO lo habría
cazado.** Cobertura exacta, sin adornar:

| Estado | Qué cubre |
|---|---|
| **cubierto por el card-diff** | los headers que `wasiai-a2a` declara (hoy **2**) |
| **cubierto por el criterio escrito + T-04b** | cualquier header que alguien intente agregar sin cita de lector |
| **DESCUBIERTO** | un header que `wasiai-a2a` estrene **y no declare** |

El cierre del tercer caso es **A-3** (pedirle a `wasiai-a2a` que publique su set completo de headers
inbound en el Agent Card) y está **fuera de scope** (CD-5). **Este párrafo va tal cual al
done-report.** Que el mecanismo cubra un subconjunto es aceptable; venderlo entero, no.

**DT-6: la señal de AC-7 no puede depender de Sentry.** `sentry.server.config.ts:3` inicializa
Sentry **sólo si `process.env.SENTRY_DSN`** existe. Sin DSN, `captureMessage` es un **no-op
silencioso** — o sea, reintroduce el silencio que la HU cierra. Por eso el canal primario es el
**500 del cron**, que no depende de ninguna env.

---

## 11. `[TBD]` NO BLOQUEANTES — las dos ramas de cada uno están escritas

Ninguno bloquea W0/W1/W2. **No los resuelvas inventando**: seguí la rama que dé la medición.

### `[TBD-1]` ¿Delega el Preview de `wasiai-prod`?

Instrumento (se corre en W3, después del push de la branch):

```
POST https://<preview-url-de-wasiai-prod>/api/v1/compose  -H 'content-type: application/json'  -d '{"steps":[]}'
```

| Resultado | Rama |
|---|---|
| `{"code":"VALIDATION_ERROR","requestId":…}` | **El Preview DELEGA.** Es el primer testigo de AC-1/AC-1b, **fuera** del camino de dinero. Corré las dos ternas contra el Preview. |
| `503 {"error":"COMPOSE_DISABLED"}` | **El Preview NO delega** (las 3 vars están scopeadas a Production). ⇒ **el primer ambiente donde se verifica AC-1/AC-1b es `wasiai-prod` / `app.wasiai.io`**, o sea el camino de dinero. Se acepta y **se escribe en el done-report**, porque (a) la promoción es manual y deliberada (`CLAUDE.md:22-23`), (b) la reversa es Instant Rollback sobre un cambio de **código**, y (c) las pruebas de la terna cortan antes de cobrar. |

### `[TBD-2]` ¿Acepta Vercel el 5.º cron en `wasiai-prod`?

⚠️ **Si no, AC-7 falla en silencio: el cron no corre y nadie se entera.**
**Verificación obligatoria al cerrar W2** (no es opcional): dashboard de Vercel → proyecto
`wasiai-prod` → **Cron Jobs** → confirmar que `/api/cron/delegation-drift` **aparece listado con su
schedule `0 6 * * *`**.

| Resultado | Rama |
|---|---|
| Aparece listado | AC-7 y AC-11 tienen disparador real. Nada más que hacer. |
| No aparece (límite de plan) | El backstop declarado es **el smoke (AC-8)**, que hay que correr a mano post-deploy — **y hay que decirlo en el done-report**. El código del cron se mergea igual: sigue siendo invocable a mano con el `CRON_SECRET`. |

### `[TBD-3]` ¿Está declarado el `Host` con que Vercel invoca el cron?

| Resultado | Rama |
|---|---|
| El host está en `hosts` de `wasiai-prod` | El cron compara contra la declaración correcta. |
| El host **no** está | El cron responde **500 `UNDECLARED_HOST` con el host crudo** (fail-loud, por diseño). Entonces se **agrega ese host a `hosts` con la evidencia en el PR** — `hosts` es descriptivo. ⛔ **Jamás** se toca `delegated` para callarlo (CD-9). |

#### Cómo se mide, exactamente, en la primera corrida post-deploy

*(El AR declaró este punto como límite suyo —no tuvo consola de Vercel— y pidió dejar escrito el
procedimiento. Si el `Host` no es uno de `delegation-manifest.ts:62` / `:73`, el resultado no es un
detalle: es un **500 diario** con `logger.error` + Sentry, o sea una alarma falsa recurrente, que es
una alarma que se aprende a ignorar.)*

⛔ **Lo que NO mide esto — el error que hay que evitar:**

```bash
curl -H "authorization: Bearer $CRON_SECRET" https://app.wasiai.io/api/cron/delegation-drift
```

Esto devuelve `environment.host = "app.wasiai.io"` **porque ese `Host` lo mandaste vos**. Es el
mismo footgun que abrió esta HU: confirmar con un instrumento que no puede desmentirte. **Sirve
para probar la auth y el card-diff; NO contesta TBD-3.**

✅ **Lo que sí lo mide** — hay que hacer que **Vercel** dispare la invocación:

1. Dashboard de Vercel → proyecto **`wasiai-prod`** → **Cron Jobs** → `/api/cron/delegation-drift`
   → **Run** (o esperar la corrida de las `0 6 * * *`).
2. Leer **la respuesta de esa corrida** (o el log de la función). El handler devuelve el host
   normalizado en `environment.host` (`route.ts:163-168`) y, si hay drift, el mismo objeto sale por
   `logger.error('[delegation-drift] divergencia detectada', body)` (`route.ts:190`) — o sea que el
   dato está en los logs de Vercel **aunque nadie mire el body de la respuesta**.
3. Leer `environment.declaredAs` en esa misma respuesta:

| Lo que se lee | Qué significa | Qué se hace |
|---|---|---|
| `declaredAs: "wasiai-prod"` y `delegation.verdict` ≠ `UNDECLARED_HOST` | el `Host` de Vercel **está** declarado | nada |
| `declaredAs: null` + `verdict: "UNDECLARED_HOST"` + `500` | el `Host` de Vercel **no** está declarado | copiar el `environment.host` **crudo de esa corrida** y agregarlo a `hosts` de `wasiai-prod` en `delegation-manifest.ts:62`, con esa salida pegada en el PR como evidencia. ⛔ **`delegated` no se toca** (CD-9) |

⚠️ **`environment.host` viene normalizado** (minúsculas, sin puerto — `delegation-manifest.ts:89-103`),
que es la misma forma que compara `resolveDeclaration`. O sea: lo que se lee es directamente lo que
hay que pegar en `hosts`, sin retocarlo a ojo.

⚠️ **Un `500 UNDECLARED_HOST` en la primera corrida NO es motivo de reversa** y no está en la lista
de la ventana de 60 minutos (§13): no toca el camino del dinero, es el fail-loud haciendo su
trabajo. Confundirlo con un incidente del cutover haría revertir un cambio que funciona.

---

## 12. Out of Scope — no tocar bajo ninguna circunstancia

- **Encender la delegación en `wasiai-prod` / `app.wasiai.io`**: ya está encendida. Esta HU **no
  toca ninguna env var de ningún proyecto Vercel**.
- **Alinear `wasiai-v2` / `wasiai-v2.vercel.app`** (DT-2 B+). Ni sus env vars.
- **`V2_DELEGATE_TO_A2A=mcp`** — `CLAUDE.md:101`.
- **Editar el repo `wasiai-a2a`** — ni `src/`, ni su `CLAUDE.md`, ni su Agent Card (CD-5).
- **Migrar `DemoPageClient.tsx:93` / `PipelinePageClient.tsx:84` a `x-a2a-key`** — A-5.
- **Arreglar el copy de error de esas dos pantallas** (`DemoPageClient.tsx:97`,
  `PipelinePageClient.tsx:112` pintan el código crudo).
- **Reenviar headers de *respuesta*** del gateway hacia el caller — hallazgo **H-1**:
  `forwardRequest` devuelve **sólo** `content-type` (`:126-129`, y el branch 402 en `:107-112`),
  así que un caller que pasa por el marketplace **no puede leer en qué red se le cobró
  (`x-a2a-payment-chain`) ni cuánto saldo le queda (`x-a2a-remaining-budget`). Es el espejo exacto
  de este bug, del lado de la respuesta. **HU aparte**: necesita su propia lista blanca de salida.
- **Agregar el ambiente a `x-wasiai-source`** — A-3b.
- **El camino paginado de `capabilities`** (`route.ts:152`) y el loop-break TD-002 (`:143-145`).
- **Cualquier lógica de pricing/x402/settlement en v2** — `CLAUDE.md:97`.
- **`.nexus/project-context.md`** (fechado 2026-03-20; `:206` describe un `/compose` que WKH-66
  borró y `:265` contradice `CLAUDE.md:20-23`). Gana `CLAUDE.md`. Se **declara** como A-2, no se
  edita acá.
- **NO "mejorar" código adyacente. NO refactors no pedidos. NO agregar funcionalidad no listada.**

---

## 13. Despliegue, reversa y su disparador

**Es un cambio de código, no de env.** `wasiai-prod` **no auto-despliega en push**
(`CLAUDE.md:20-23`, confirmado con `vercel ls wasiai-prod`: los commits recientes figuran como
**Preview** y el último **Production** es anterior). ⇒ **mergear esta HU no publica nada sobre
`app.wasiai.io`.**

| # | Acción | Efecto | Verificación |
|---|---|---|---|
| **0** | **ANTES de promover**: probar que el gateway monta `forward-key` | si no lo monta, **ninguna** de las 6 familias se puede atribuir al proxy y el disparador de reversa se queda sin su método #1 | `POST <gateway>/compose` con `x-wasiai-forward-key` **inválida** ⇒ `401 INVALID_FORWARD_KEY`. **Medido el 2026-08-18: `401`**, control sin el header ⇒ `400 VALIDATION_ERROR` (la ausencia es passthrough por AC-4, así que **la sonda tiene que mandar una clave MALA**, no ninguna) |
| 1 | push de la branch | crea **Preview** en `wasiai-prod`; `wasiai-v2` / `wasiai-v2.vercel.app` se actualiza | — |
| 2 | sondear el Preview (`[TBD-1]`) | decide quién es el primer testigo | `POST <preview>/api/v1/compose {"steps":[]}` |
| 3 | si el Preview delega: las dos ternas contra el Preview | AC-1 / AC-1b verificados **fuera** del camino de dinero | §2.1 + §2.2 |
| 4 | merge a `main` | `wasiai-v2.vercel.app` sigue en 503 — **esperado, no es incidente** | AC-10 |
| 5 | **Redeploy manual de `wasiai-prod`** (`CLAUDE.md:22`) | los 3 headers empiezan a atravesar | **las dos ternas** contra `app.wasiai.io` + `npm run smoke:delegation app.wasiai.io` |
| 6 | ventana de 60 min | detectar R-1 / R-2 | logs de Railway del gateway (**A-4**, fuera de este repo) |

### Lo que cambia de status en el camino de dinero vivo (declarado, no descubierto después)

⚠️ **Corregido en el fix-pack del AR (`BLQ-MED-1`): eran SEIS familias, no dos.** La tabla original
declaraba 3 filas —las 3 de `x-payment-chain`— y dejaba afuera las 4 que abren los dos headers de
contracting. Admitir un header no es sólo "ahora pasa": es **habilitar todos los rechazos que ese
header puede provocar en el gateway**.

Medido el **2026-08-18** contra `https://wasiai-a2a-production.up.railway.app/compose`, body
`{"steps":[{"agent":"wasi-chainlink-price"}]}`. **`app.wasiai.io` devolvió `402` (el default) en las
seis.** Ninguna petición movió fondos: todas cortan en `400`/`403`/challenge `402`.

| # | Caso | Header | `app.wasiai.io` HOY | Después del fix | ¿Se ve en Railway? |
|---|---|---|---|---|---|
| 0 | pide Base, le cobran Kite | `x-payment-chain` | `402` con `eip155:2368` | **`402` con `eip155:84532`** — *es el arreglo* | n/a |
| 1 | slug de red inválido (o vacío) | `x-payment-chain` | `402`, le aplican el default y **funciona** | **`400 CHAIN_NOT_SUPPORTED`** | ⚠️ **NO** — ver abajo |
| 2 | red sin saldo en la key | `x-payment-chain` | le cobran del default | **`403 INSUFFICIENT_BUDGET`** en la red pedida | sí — `a2a-key.insufficient-budget` |
| 3 | `depth: 2` (¡valor normal!) | `x-a2a-contracting-depth` | `402` | **`400 CONTRACTING_DEPTH_EXCEEDED`** | sí — `contracting-guard.rejected` |
| 4 | `depth: abc` | `x-a2a-contracting-depth` | `402` | **`400 CONTRACTING_DEPTH_MALFORMED`** | sí — `contracting-guard.rejected` |
| 5 | `chain: no es un host!!` | `x-a2a-contracting-chain` | `402` | **`400 CONTRACTING_CHAIN_MALFORMED`** | sí — `contracting-guard.rejected` |
| 6 | `chain:` = el host del gateway | `x-a2a-contracting-chain` | `402` | **`400 CONTRACTING_LOOP_DETECTED`** | sí — `contracting-guard.rejected` |

**La fila 3 es la que hace a esto BLQ y no MNR.** El card vivo declara `depthMax: 2` y el techo es
`depth >= depthMax` (`wasiai-a2a/src/lib/contracting-chain.ts:837`), así que `depth: 2` —un valor
perfectamente normal para un intermediario de segundo nivel— **pasa de funcionar a `400`**. Medido:
`depth: 1` ⇒ `402`, `depth: 2` ⇒ `400`.

**Las 6 filas son peticiones que hoy funcionan y pasarán a 400/403.** Es el comportamiento correcto
(convierte un silencio-incorrecto en un error-correcto), pero **es un cambio de status en el camino
de dinero** y no puede aparecer como sorpresa en el done-report. La población afectada —callers que
hoy mandan estos headers a `app.wasiai.io`— **no se puede contar desde este repo** (v2 sólo proxea y
no loguea headers).

> 🔒 **La tabla ya no vive sólo acá.** El fix-pack la bajó a datos versionados:
> `src/lib/proxy/passthrough-headers.ts` → `REJECTION_FAMILIES` / `REVERSAL_WATCHLIST`, con
> `forward-handler.test.ts` (`T-FP-1`…`T-FP-6`) exigiendo que **cada header nuevo declare qué
> rechazos habilita** y que cada familia declare **cómo se la vigila o por qué no se puede**. Una
> prosa se puede quedar corta sin que nada se ponga rojo; eso fue lo que pasó la primera vez.

### Disparador de reversa

> En la ventana de **60 minutos** posteriores a la promoción de `wasiai-prod`: si aparecen en los
> logs de Railway del gateway, con `x-wasiai-source: v2-proxy`, respuestas con **cualquiera de estos
> SEIS `error_code`** que **no existían antes**, se ejecuta la reversa:
> `CHAIN_NOT_SUPPORTED` · `INSUFFICIENT_BUDGET` · `CONTRACTING_DEPTH_EXCEEDED` ·
> `CONTRACTING_DEPTH_MALFORMED` · `CONTRACTING_CHAIN_MALFORMED` · `CONTRACTING_LOOP_DETECTED`.
> La lista canónica es `REVERSAL_WATCHLIST` (`src/lib/proxy/passthrough-headers.ts`), no este párrafo.

**Cómo se buscan (A-4, logs de Railway del gateway):**

| Qué buscar | Cubre | ¿Se puede atribuir al proxy? |
|---|---|---|
| `contracting-guard.rejected` — trae el campo `code` | las 4 familias de contracting (filas 3-6) | ⛔ **NO** — ver abajo. Lo que hay es un **delta contra línea base** |
| `a2a-key.insufficient-budget` | fila 2 | ✅ sí, cruzando por `reqId` |
| `forward-key source` con `{"forwardSource":"v2-proxy"}` | marca **qué `reqId` viene del proxy**, para no contar tráfico directo al gateway | — (es el instrumento de atribución, no una familia) |

⛔ **Las 4 familias `CONTRACTING_*` NO se pueden ATRIBUIR al proxy, aunque su `error_code` sí se
vea.** Son dos preguntas distintas y confundirlas es lo que dejaba este disparador sin ejecutar:
`contractingGuardHandler` es el **primer** preHandler de `/compose`
(`wasiai-a2a/src/routes/compose.ts:909`) y aborta con `return reply.status(400).send(...)`
(`wasiai-a2a/src/middleware/contracting-guard.ts:116`), lo que en Fastify **corta el resto de la
cadena** ⇒ `requireForwardKey()` (`compose.ts:912`) **nunca corre** y no se emite la línea
`forward-key source`. Y el log que sí sale lleva `{code, layer, chainHeaderChars, depthMax,
selfHostCount}`: **ningún campo de origen**. Cruzar por `reqId` devuelve **cero coincidencias**, y
leer ese cero como *"ninguno vino por el proxy"* es la conclusión equivocada — pueden haber venido
todos. Lo que se usa en su lugar: **delta** entre las líneas `contracting-guard.rejected` de los 60
min **previos** a la promoción y las de los 60 **posteriores**. La lista canónica de estas familias
es `UNATTRIBUTABLE_FAMILIES` (`src/lib/proxy/passthrough-headers.ts`), derivada del campo
`proxyAttribution` y verificada por `T-FP-7`/`T-FP-8`; este párrafo no es la fuente.

⚠️ **Y toda la atribución —también la de las 2 familias que sí la tienen— depende de una var que
vive en Railway**: `requireForwardKey()` devuelve `[]` (middleware **no montado**) si
`WASIAI_V2_FORWARD_KEY` falta o mide <16 chars (`wasiai-a2a/src/middleware/forward-key.ts:72-81`).
Sin ella no hay línea `forward-key source` para **ninguna** familia, y la suplencia #1 de
`CHAIN_NOT_SUPPORTED` tampoco existe. Por eso es el **paso 0** de la tabla de despliegue, con sonda
propia; no se asume.

⛔ **`CHAIN_NOT_SUPPORTED` (fila 1) NO se puede vigilar directo, y esto se declara en vez de dejarlo
afuera en silencio.** Su emisor (`wasiai-a2a/src/middleware/a2a-key.ts:366-370`) hace
`reply.status(400).send(...)` **sin ninguna llamada a `request.log`**. Los dos ganchos globales del
gateway **existen y aun así no lo suplen** — se midieron los dos, no se asumió que no hubiera:

| Gancho | Por qué no alcanza |
|---|---|
| `setErrorHandler` (`wasiai-a2a/src/middleware/error-boundary.ts:72`) | sólo atrapa excepciones **lanzadas**; esto es un `reply.send` normal y no pasa por ahí |
| `onResponse` (`wasiai-a2a/src/middleware/event-tracking.ts:111-141`) | **sí** cubre `/compose` (`TRACKED_PREFIXES`, `:19-25`) y persiste en `a2a_events`, pero graba `statusCode` + `requestId`, **nunca el `error_code`**: un `400` de slug inválido y un `400` de validación de body son la misma fila |

En Railway se ve como un `400` sin código.

Cómo se suple, en orden de costo:
1. **Por diferencia**: los `reqId` con `forwardSource: v2-proxy` que terminan en `400` y **no**
   tienen una línea `contracting-guard.rejected` son candidatos a `CHAIN_NOT_SUPPORTED` (junto con
   los errores de validación de body, que ya existían antes del cambio). ⚠️ **Este método depende
   del paso 0**: si el gateway no monta `forward-key`, no hay `forwardSource` con el que empezar.
2. **Activamente**: `npm run smoke:delegation app.wasiai.io` incluye el **paso 4b**, que manda
   `x-payment-chain: nonexistent-chain-xyz` y exige `400` **con `error_code: CHAIN_NOT_SUPPORTED`
   en el body** (`MNR-it2-1`: cualquier 400 no alcanza — el gateway tiene otros, p. ej.
   `VALIDATION_ERROR`, medido el 2026-08-18). Contesta "¿el efecto está activo?", no
   "¿cuántos callers reales lo están sufriendo?".
3. **Cerrarlo de verdad** = agregar un `request.log.warn` en `wasiai-a2a` al lado del
   `reply.status(400)`. **CD-5 prohíbe tocar ese repo en esta HU** ⇒ queda como **acción declarada
   nueva** —candidata a `A-6`; la lista del SDD (`sdd.md:972-993`) hoy llega hasta `A-5`—, **no
   ejecutada acá**. Sin ella, la vigilancia de la fila 1 es por diferencia, no directa.

**Reversa**: revertir el commit + redeploy, o **Instant Rollback** de Vercel sobre `wasiai-prod`.
Vuelve exactamente al comportamiento de hoy: los 3 headers se descartan.
El punto de observación está **fuera de este repo** ⇒ acción **A-4**, declarada y no ejecutada acá.

⚠️ **`DELEGATED` se congela en carga de módulo** (`forward-handler.ts:59`): **ninguna reversa es
instantánea sobre lambdas tibias.** El rollback de esta HU es de **código**, así que no depende de
ese congelamiento — pero cualquier reversa que pase por **env** sí, y hay que esperar el reciclado.

**Orden de apagado de una delegación** (si alguna vez hace falta): **primero el flag, después las
vars.** Es el inverso exacto del encendido. Borrar las vars dejando el flag es CD-1 al revés y tira
el ambiente entero con 500.

---

## 14. Anti-Hallucination Checklist (marcá cada una ANTES de cerrar F3)

- [ ] No inventé ningún path: los 18 archivos de §4 son exactamente los que toqué.
- [ ] Las 11 `citation` de §5.1 son las de la tabla, textuales. **No inventé ninguna cita nueva.**
      Si alguna no coincidía con `wasiai-a2a` @ `10a6eb1`, escalé (§15) en vez de ajustarla.
- [ ] `x-api-key` es la **única** entrada con `consumer: 'none'` / `citation: null`, y T-04b lo verifica.
- [ ] La guarda `if (v)` de `forward-handler.ts:81` está **intacta**.
- [ ] `passthrough-headers.ts` y `delegation-manifest.ts` **no** importan `server-only`,
      **no** importan `@/lib/env`, **no** hacen I/O (CD-8).
- [ ] Todo test que toca `@/lib/env` (directa o transitivamente) lo **mockea a nivel de archivo**.
- [ ] `delegation-off.test.ts` está en su **propio archivo** con su propio mock (DT-9).
- [ ] Ningún test vive fuera de `src/**/*.test.{ts,tsx}` (CD-14), y el contador `Test Files` subió
      de **82 → 84 → 87** en W1 y W2, y de **87 → 89** en el fix-pack del AR (los 2 archivos nuevos
      de §4.b). `Tests`: **763 → 797** (+34), 5 skipped en las dos puntas.
- [ ] `scripts/smoke-delegation.mjs` **no ejecuta nada al importarse** (main-guard, CD-15) y **no
      importa ninguna dependencia** (sólo builtins de Node + `fetch`).
- [ ] No agregué **ninguna** dependencia a `package.json`.
- [ ] El endpoint de AC-5 **no** devuelve el valor ni la longitud de las dos vars, y sirve
      `Cache-Control: no-store` (CD-11), verificado por T-05 buscando el substring del valor
      mockeado en el JSON serializado.
- [ ] El cron con el card inalcanzable devuelve **200 + WARN**, no `HEADER_WHITELIST_DRIFT` (CD-10),
      verificado por T-09b.
- [ ] Las comparaciones de endpoints son **por conjunto**, no por igualdad de array (CD-16).
- [ ] No exporté el `Set` `DELEGATED`; el endpoint y el cron usan `listDelegatedEndpoints()` (CD-4).
- [ ] Corrí `git grep "toHaveBeenCalledWith\|toHaveBeenNthCalledWith"` **antes** de cambiar
      cualquier firma, y conté argumentos (CD-13).
- [ ] Corrí `npm test` **completo** al cerrar cada wave, no sólo los tests nombrados (CD-13).
- [ ] En **ningún** artefacto que escribí dice "producción" a secas: siempre proyecto Vercel +
      dominio (CD-6). *(Incluye comentarios, mensajes de commit y el auto-blindaje.)*
- [ ] No escribí ni desplegué **nada** en el repo `wasiai-a2a` (CD-5).
- [ ] No toqué ninguna env var de ningún proyecto Vercel.
- [ ] `npm run qa` verde al cerrar W3.

---

## 15. Escalation Rule

> **Si algo no está en este Story File, PARÁ y preguntá al Architect.**
> No inventes. No asumas. No improvises.

Escalá **sin excepción** si:

- Una cita de §5.1 no coincide con `wasiai-a2a` @ `10a6eb1` (⇒ el upstream se movió: hay que
  re-medir, no re-numerar a ojo).
- El agent card ya no trae el bloque `contracting`, o trae **más** de dos nombres de header.
- Un exemplar de §6 no existe o cambió de forma.
- Un test existente de `forward-handler.test.ts` se rompe y el arreglo no es obvio con CD-13.
- El contador de `Test Files` **no sube** al agregar un archivo de test (CD-14 otra vez, en otro
  lado).
- Aparece la necesidad de tocar un archivo fuera de la tabla de §4.
- Cualquier `[TBD]` de §11 da un resultado que **no es** ninguna de sus dos ramas.

---

*Story File generado por NexusAgil — F2.5 · Architect · 2026-08-18*
