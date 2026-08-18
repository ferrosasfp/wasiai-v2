# SDD #077: [WKH-361] Los headers del camino del dinero no atraviesan el proxy de v2 — y ningún instrumento del repo dice qué ambiente delega

> SPEC_APPROVED: no
> Fecha: 2026-08-18
> Tipo: bugfix (money-path) + improvement (observabilidad de ambiente)
> SDD_MODE: full
> Modo del pipeline: QUALITY
> Branch: `feat/077-headers-proxy`
> Repo: `wasiai-v2` (marketplace, consumidor). `wasiai-a2a` es canónico y esa relación NO se invierte.
> `main` = `b558713`
> Artefactos: `doc/sdd/077-wkh-361-cutover-a2a-no-cableado/`
> Work item: [`work-item.md`](work-item.md) rev. 2 — **HU_APPROVED 2026-08-18**

---

## 0. Qué cambió respecto del work-item aprobado (leer primero)

El work-item rev. 2 se aprobó con **2 headers faltantes** y **6 incógnitas abiertas**. Al hacer el
grounding de F2 se midió lo siguiente, y **el alcance del defecto creció**:

| # | Cambio | Impacto |
|---|---|---|
| 1 | Falta un **tercer** header, `x-payment-chain`, y está **en el camino del dinero** | AC nuevo **AC-1b**; el defecto pasa de "un guard sin cobertura" a "el marketplace cotiza el pago en la red equivocada" |
| 2 | `NC-1` resuelto (medido hoy): `app.wasiai.io` sirve `capabilities` **delegado** | el manifiesto de AC-7 puede declararse sin adivinar |
| 3 | `NC-2` resuelto: el gateway **no tiene ningún lector** de `x-api-key` | decide que las dos pantallas **NO** migran en esta HU (DT-8) |
| 4 | `NC-3` resuelto: `wasiai-prod` **no** auto-despliega en push | mergear NO publica sobre el camino de dinero vivo |
| 5 | `NC-4` resuelto: Sentry es **condicional a `SENTRY_DSN`** | la señal de AC-7 **no puede** apoyarse sólo en Sentry (DT-6) |
| 6 | `NC-5` decidido: **DT-2 = (B+)**, `wasiai-v2` / `wasiai-v2.vercel.app` NO se alinea | **AC-9 se elimina**; AC-10 se conserva |
| 7 | Hallazgo: el gateway **ya publica** los headers que lee, en su Agent Card | AC nuevo **AC-11**: el mecanismo que evita que la lista blanca vuelva a quedarse atrás |

**AC-1b y AC-11 son ACs nuevos** que este SDD agrega sobre el work-item aprobado. AC-11 lo exige
explícitamente el brief del orquestador ("el SDD tiene que dejar escrito cómo se entera la lista
blanca de que el gateway estrenó un header, no sólo agregar estos tres"). Quedan marcados como
adiciones para que el gate SPEC_APPROVED los vea, no para que pasen de contrabando.

---

## 1. Resumen

El proxy de `wasiai-v2` hacia `wasiai-a2a` **no reenvía los headers del caller**: los reconstruye
desde una lista blanca de 8 nombres (`src/lib/proxy/forward-handler.ts:39-48`, aplicada en
`:79-82`). Tres headers que el gateway **sí lee** no están en esa lista, así que el gateway nunca
los ve:

| Header | Qué pierde el sistema |
|---|---|
| `x-a2a-contracting-chain` | la capa 2 del guard anti-bucle de WKH-360 tiene **cobertura cero** en el camino real |
| `x-a2a-contracting-depth` | ídem, más el techo de profundidad |
| **`x-payment-chain`** | **el pago se cotiza y se cobra en la red por defecto, no en la que el caller pidió** |

El tercero es un **defecto en vivo en `wasiai-prod` / `app.wasiai.io`, con consecuencia en plata,
medido hoy** (§3.2): contra
`app.wasiai.io`, un caller que pide `base-sepolia` recibe un challenge x402 de **Kite Ozone** por
`1010000000000000` unidades de un token de 18 decimales, en vez del challenge de **Base Sepolia**
por `1010` unidades de 6 decimales que el gateway le da directo. Firma para la red equivocada y no
puede pagar.

Esta HU (a) agrega los tres headers con un **criterio escrito y verificado en test** de qué entra y
qué no, y (b) construye el mecanismo que hoy no existe: **poder contestar qué ambiente delega, y
enterarse solo cuando el gateway estrena un header**, que es exactamente el vacío que produjo el
diagnóstico equivocado de la rev. 1 del work-item.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 077 |
| **HU** | WKH-361 |
| **Tipo** | bugfix (money-path) + improvement |
| **SDD_MODE** | full |
| **Objetivo** | Que los 3 headers que `wasiai-a2a` lee atraviesen el proxy de `wasiai-v2` sin modificarse, con un criterio escrito de admisión, y dejar instalado el mecanismo que detecta solo tanto el drift de delegación por ambiente como la aparición de un header nuevo del lado del gateway |
| **Reglas de negocio** | La lista sigue siendo **lista blanca**. `wasiai-a2a` es canónico. Ningún artefacto dice "producción" a secas. Todo cambio reversible con la reversa escrita |
| **Scope IN** | §8.1 |
| **Scope OUT** | §8.2 |
| **Missing Inputs** | Ninguno bloqueante — §14 |

---

## 3. Reproducción y evidencia medida

> **Toda la evidencia de esta sección la produjo el Architect el 2026-08-18** con `curl` contra
> hosts nombrados. Ninguna llamada mueve dinero: las tres familias cortan **antes** de cobrar
> (402 = challenge sin pagar; 400 = rechazo; el propio gateway lo dice textual en §3.1:
> *"La peticion se rechaza sin cobrar"*).

### 3.0 Qué ambiente es qué (CD-6: proyecto Vercel + dominio, siempre)

| Proyecto Vercel | Dominio medido | `compose` | `orchestrate` | `capabilities` |
|---|---|---|---|---|
| `wasiai-prod` | **`app.wasiai.io`** | **delegado** | **delegado** | **delegado** |
| `wasiai-v2` | **`wasiai-v2.vercel.app`** | 503 `COMPOSE_DISABLED` | 503 `ORCHESTRATE_DISABLED` | **legacy** |
| — (upstream) | `wasiai-a2a-production.up.railway.app` | canónico | canónico | canónico (`/discover`) |

Instrumentos y salidas exactas:

```
POST https://app.wasiai.io/api/v1/compose        {"steps":[]}  -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"495bfe17-…"}
POST https://app.wasiai.io/api/v1/orchestrate    {}            -> 400 {"error":"Validation failed","code":"VALIDATION_ERROR","details":[…missingProperty:"goal"…]}
POST https://wasiai-v2.vercel.app/api/v1/compose {"steps":[]}  -> 503 {"error":"COMPOSE_DISABLED","detail":"Legacy compose handler removed in WKH-66…"}
POST https://wasiai-v2.vercel.app/api/v1/orchestrate {}        -> 503 {"error":"ORCHESTRATE_DISABLED",…}

GET  https://app.wasiai.io/api/v1/capabilities?limit=1        -> keys = [agents, catalogStatus, excluded, registries, sources, total, totalAtLeast]   (DELEGADO)
GET  https://wasiai-v2.vercel.app/api/v1/capabilities?limit=1 -> keys = [agents, next_cursor, total]                                                  (LEGACY)
```

Por qué eso prueba delegación y no coincidencia: `VALIDATION_ERROR` y `requestId` **no existen en
ningún handler de este repo** (el 503 propio es `{error, detail}`, `compose/route.ts:20-27`), y las
7 claves del `capabilities` de `app.wasiai.io` sólo las puede producir el body de a2a reenviado
(`capabilities/route.ts:146,154`); la rama legacy devuelve **exactamente** `{agents, total,
next_cursor}` (`capabilities/route.ts:369-372`). **Esto sería falso si** `app.wasiai.io` devolviera
`next_cursor` o si `wasiai-v2.vercel.app` devolviera `registries`.

⚠️ **`NC-1` queda RESUELTO**: `wasiai-prod` sirve `capabilities` por la rama **delegada**, no por la
legacy. El manifiesto (§9.2) lo declara así porque se midió, no porque se dedujo.

### 3.1 El defecto de los dos headers de contracting — la terna de AC-1

```
1) GATEWAY DIRECTO      + x-a2a-contracting-depth: 99  -> 400 {"error_code":"CONTRACTING_DEPTH_EXCEEDED","depth":99,"depthMax":2,
                                                              "note":"La deteccion de bucles TRANSITIVOS es BEST-EFFORT…"}
2) app.wasiai.io        + x-a2a-contracting-depth: 99  -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"495bfe17-…"}
3) app.wasiai.io        SIN header                     -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"04365033-…"}
```

**(2) y (3) son la misma respuesta.** El header entra a v2 y no sale. El gateway evalúa el guard
**antes** de validar el body — por eso (1) da `DEPTH_EXCEEDED` y (2) llega hasta la validación.
Ese orden es lo que convierte la terna en un discriminador limpio: después del fix, (2) tiene que
volverse `CONTRACTING_DEPTH_EXCEEDED` y dejar de parecerse a (3).

Los dos `requestId` distintos entre (2) y (3) descartan además que sea una respuesta cacheada.

### 3.2 El defecto de `x-payment-chain` — el que cuesta plata

Body: `{"steps":[{"agent":"wasi-chainlink-price"}]}`. Sin key, sin firma: la respuesta es el
**challenge x402**, o sea *"esto es lo que tendrías que pagar"*. Cero movimiento de fondos.

| # | Host | `x-payment-chain` | Resultado |
|---|---|---|---|
| 1 | gateway directo | *(ausente)* | 402 · `network: eip155:2368` · `maxAmountRequired: 1010000000000000` |
| 2 | gateway directo | `base-sepolia` | 402 · `network: eip155:84532` · `maxAmountRequired: 1010` |
| 3 | gateway directo | `nonexistent-chain-xyz` | **400** `{"error_code":"CHAIN_NOT_SUPPORTED","error":"Chain 'nonexistent-chain-xyz' is not a recognized slug or chainId"}` |
| 4 | **app.wasiai.io** | *(ausente)* | 402 · `eip155:2368` · `1010000000000000` |
| 5 | **app.wasiai.io** | `base-sepolia` | 402 · `eip155:2368` · `1010000000000000` ← **idéntico a (4)** |
| 6 | **app.wasiai.io** | `nonexistent-chain-xyz` | 402 · `eip155:2368` · `1010000000000000` ← **idéntico a (4)** |

**(4), (5) y (6) son byte-idénticos.** El header no atraviesa el proxy. La consecuencia en plata,
en números: quien pasa por el marketplace y pide Base Sepolia recibe la cotización de **Kite Ozone**
(`eip155:2368`, 18 decimales) en lugar de la de **Base Sepolia** (`eip155:84532`, 6 decimales).
Firma para la red equivocada y **no puede pagar**.

Confirmación independiente, medida por el orquestador con una agent key real contra
`app.wasiai.io` + `x-a2a-key` + `x-payment-chain: 43113`:

```
{"error":"chain 2368 (kite-ozone-testnet) balance is 0; no x-payment-chain header sent, used default …"}
```

El texto **"no x-payment-chain header sent"** lo emite el gateway sólo cuando `defaultApplied ===
true` (`wasiai-a2a/src/middleware/a2a-key.ts:505-508`), que es exactamente la rama del `header
ausente` (`:364-382`). El header se mandó. Lo descartó `PASSTHROUGH_HEADERS`.

**Esto sería falso si** (5) devolviera `eip155:84532`, o si (6) devolviera `CHAIN_NOT_SUPPORTED`.

### 3.3 El instrumento gratis y permanente

La tabla de §3.2 filas 1/2/4/5 es **la prueba de regresión de AC-1b**, y es mejor que la de §3.1:
no requiere key, no mueve fondos, y es **money-path directo**. Es lo que entra en
`scripts/smoke-delegation.mjs` (§9.5).

---

## 4. Context Map (Codebase Grounding)

### 4.1 Archivos leídos en `wasiai-v2` (este repo)

| Archivo | Por qué | Hallazgo / patrón extraído |
|---|---|---|
| `src/lib/proxy/forward-handler.ts` | es el defecto | lista blanca `:39-48`; bucle de copia `:79-82` con guarda `if (v)` `:81`; `DELEGATED` congelado en carga de módulo `:59`; sólo `content-type` vuelve en la respuesta `:126-129` |
| `src/lib/proxy/__tests__/forward-handler.test.ts` | ver qué cubre y qué no | `vi.mock('@/lib/env')` a nivel de archivo `:8-15` con delegación **encendida**; patrón de aserción sobre `fetchSpy.mock.calls[0][1].headers` `:97`, `:112`, `:142` |
| `src/app/api/v1/compose/route.ts` | consumidor 1 | `isDelegated('compose')` `:19` → 503 `:20-27`; reconstruye `NextRequest` `:52-61`; `headers: req.headers` `:54` **no llega** upstream |
| `src/app/api/v1/orchestrate/route.ts` | consumidor 2 | `isDelegated('orchestrate')` `:15` → 503 `:16-23`; pasa el `req` original `:25` |
| `src/app/api/v1/capabilities/route.ts` | consumidor 3 | `isDelegated('capabilities')` `:146`; camino paginado `:152`; rama legacy `:156` con body `{agents,total,next_cursor}` `:369-372` |
| `src/lib/env.ts` | boot y validación | `import 'server-only'` `:13`; las 3 vars `:55`,`:58`,`:65`; `.refine` condicional `:75-86` → `createEnv()` **throw** `:94` ⇒ 500 en toda ruta que importe `@/lib/env`; escape de build `:100-109` |
| `scripts/validate-env.js` | por qué no caza esto | `REQUIRED_VARS` `:18-29` no incluye las 3 → caen en `warnings` `:76` → `process.exit(0)` `:133` |
| `src/lib/cron/verifyCronSecret.ts` | exemplar de auth de cron | `verifyCronAuth` `:43-52`, fail-closed si falta `CRON_SECRET` `:45-47`, comparación constante `:22-31` |
| `src/app/api/cron/reconcile-onchain/route.ts` | exemplar de ruta cron | `verifyCronAuth(req.headers.get('authorization'))` `:13-16`; `export const runtime='nodejs'` `:9`; `logger` de `@/lib/logger` `:6` |
| `src/app/api/admin/status/route.ts` | exemplar de endpoint de estado | forma `GET` + `NextResponse.json` + guard temprano `:32-34` |
| `vercel.json` | dónde se registran los crons | 4 entradas, horarios 02:00–05:00 UTC `:2-19` |
| `middleware.ts` | ¿el endpoint nuevo necesita excepción? | **no**: todo `/api/` sale por la rama corta `:24-32`, sin auth ni intl |
| `sentry.server.config.ts` | `NC-4` | `Sentry.init` **sólo si** `process.env.SENTRY_DSN` `:3` ⇒ sin DSN, `captureMessage` es un no-op silencioso |
| `.env.example` | contrato de env | las 3 vars ya documentadas `:105`, `:109`, `:118`; falta el hazard de orden (CD-1) |
| `CLAUDE.md` | ambientes y despliegue | tabla `:7-10`; **"NO hacer auto-deploy a prod desde push"** `:23`; "probar en staging primero" `:21`; prohibición de `mcp` `:101` |
| `.nexus/project-context.md` | drift declarado | `:206` describe un `/compose` que WKH-66 borró de este repo; `:265` dice "Auto-deploy on push to `main`" y **contradice** `CLAUDE.md:20-23` |
| `src/app/[locale]/demo/_components/DemoPageClient.tsx` | `NC-2` | manda `'x-api-key': apiKey` `:93`; pinta el código crudo del error `:97` |
| `src/app/[locale]/pipelines/_components/PipelinePageClient.tsx` | `NC-2` | manda `'x-api-key': apiKey` `:84`; `errData.reason ?? errData.error` `:112` |
| `doc/sdd/076-…/auto-blindaje.md` | aprender del pasado | `import 'server-only'` en el grafo de un test lo **revienta al colectar** |
| `doc/sdd/075-…/auto-blindaje.md` | ídem | correr la suite **completa**, no sólo los tests nombrados |
| `doc/sdd/074-…/auto-blindaje.md` | ídem | agregar un arg a una función mockeada rompe `toHaveBeenCalledWith` existentes |

### 4.2 Archivos leídos en `wasiai-a2a` (upstream — SÓLO LECTURA, CD-5)

| Archivo | Hallazgo (esto es lo que hace citable el criterio de DT-1) |
|---|---|
| `src/lib/contracting-chain.ts` | nombres `:168` / `:171`; lector `readInboundContracting` `:769`; **paso 4** `:820-827` — `''` no pasa `DECIMAL_1_TO_3_DIGITS` ⇒ `CONTRACTING_DEPTH_MALFORMED`; nota best-effort `:187-192`; "los 25 agentes descubribles en prod no emiten estos headers" `:82-84` |
| `src/middleware/a2a-key.ts` | `x-a2a-key` `:546`; `authorization: Bearer wasi_a2a_*` `:551-557`; **`x-payment-chain` `:358`**; `400 CHAIN_NOT_SUPPORTED` con header presente-e-ilegible `:365-370`; default aplicado + warn `:372-382`; eco `x-a2a-payment-chain` `:404`; mensaje `"no x-payment-chain header sent"` `:505-508` |
| `src/middleware/x402.ts` | `x-payment` `:47` leído en `:517`; `payment-signature` `:48` leído en `:518`; `x-payment-chain` `:425`; `X_A2A_PAYMENT_CHAIN_HEADER` `:55` |
| `src/adapters/chain-resolver.ts` | `normalizeChainSlug` `:419-424` — **`''` ⇒ `undefined`** (`key.length === 0`, `:422`); `resolveChainKey` `:435-446`; **exemplar del `Record<Union, …>` exhaustivo** `:118-127` ("agregar una chain nueva a `ChainKey` sin clasificarla acá NO compila") |
| `src/middleware/forward-key.ts` | no monta el middleware si falta la key `:69-81`; **401** si no coincide `:112-123`; loguea `x-wasiai-source` como informativo **sin efecto de auth** `:87-99` |
| `src/index.ts` | `trustProxy: parseTrustProxy(process.env.TRUST_PROXY)` `:163`; resolución de `request.ip` desde `X-Forwarded-For` `:158` |
| `src/routes/compose.ts` · `src/routes/gasless.ts` | `x-payment-chain` también en `:107` y `:77` |
| **`GET /.well-known/agent.json`** (vivo) | **el gateway publica los headers que lee**: `contracting.chainHeader`, `contracting.depthHeader`, `contracting.depthMax: 2`. Es la base de AC-11 |

### 4.3 Exemplars verificados (todos existen — confirmado con `ls`/`git grep` hoy)

| Para crear/modificar | Seguir patrón de | Qué copiar |
|---|---|---|
| `src/lib/proxy/forward-handler.ts` (modif.) | él mismo `:79-82` | el bucle con guarda `if (v)`; **no** tocar la guarda |
| lista exhaustiva de endpoints delegados | `wasiai-a2a/src/adapters/chain-resolver.ts:118-127` | `Record<Union, true>` exhaustivo ⇒ agregar un miembro a la unión **sin** clasificarlo **no compila** |
| `src/lib/proxy/delegation-manifest.ts` (nuevo) | `src/lib/contracts/marketplaceAddressCoherence.ts` | módulo **puro**: sin `server-only`, sin `@/lib/env`, sin I/O (lección de `076/auto-blindaje.md`) |
| `src/app/api/v1/status/delegation/route.ts` (nuevo) | `src/app/api/admin/status/route.ts:32-34` + `cron/reconcile-onchain/route.ts:9` | `GET` + `NextResponse.json` + `export const runtime = 'nodejs'` |
| `src/app/api/cron/delegation-drift/route.ts` (nuevo) | `src/app/api/cron/reconcile-onchain/route.ts:12-16` | `verifyCronAuth(req.headers.get('authorization'))` como primera línea |
| `scripts/smoke-delegation.mjs` (nuevo) | `scripts/i18n-audit.mjs` | `.mjs` de Node sin dependencias + `process.exit(n)` |
| tests nuevos del proxy | `src/lib/proxy/__tests__/forward-handler.test.ts:97,112,142` | leer `fetchSpy.mock.calls[0][1].headers` |
| test de AC-10 (delegación apagada) | `src/lib/proxy/__tests__/forward-handler.test.ts:8-15` | `vi.mock('@/lib/env')` **a nivel de archivo** — obligatorio en archivo aparte (DT-9) |

---

## 5. Análisis de causa raíz

### 5.1 Dónde está el bug

| Archivo | Zona | Qué está mal |
|---|---|---|
| `src/lib/proxy/forward-handler.ts` | `:39-48` | la lista blanca no tiene los 3 headers que el gateway lee |
| `src/lib/proxy/forward-handler.ts` | `:39-48` | **y no tiene criterio escrito**: es un arreglo de 8 strings sin decir por qué está cada uno ni qué haría entrar a uno nuevo |
| `src/lib/proxy/__tests__/forward-handler.test.ts` | `:102-116` | el test de passthrough verifica **3 headers elegidos a mano**, no el conjunto; agregar o sacar uno no lo rompe |

### 5.2 Causa raíz

**Una lista de datos sin criterio y sin dueño.** Se agregó una capacidad del lado del gateway
(WKH-360 los headers de contracting; WKH-138/175 el `x-payment-chain`) y **nada del lado del
cliente se entera**. Tres headers, tres momentos distintos, el mismo modo de falla. El modo de falla
es especialmente difícil de ver porque **la respuesta con el header y sin el header son idénticas**
(§3.1 y §3.2): un `200 OK`, o incluso un `402` bien formado, se ven igual en los dos mundos.

### 5.3 El agujero de segundo orden (por qué la rev. 1 del work-item se equivocó de ambiente)

Ningún instrumento de este repo puede contestar *"¿qué ambiente delega?"*:

- La suite **mockea `@/lib/env`** con la delegación encendida (`forward-handler.test.ts:8-15`): un
  test verde afirma cosas sobre un mundo hipotético, no sobre Vercel.
- `scripts/validate-env.js` es presencia **incondicional** y estas vars son **condicionalmente**
  obligatorias: caen en `warnings` (`:76`) y el script sale **0** (`:133`) igual en los dos
  proyectos.
- `CLAUDE.md:7-10` describe los ambientes en prosa, y su fila de `wasiai-prod` dice
  `wasiai-prod.vercel.app`, no `app.wasiai.io`, que es el dominio por donde entra el tráfico real.

---

## 6. Decisiones técnicas

### DT-1 — La lista blanca sigue siendo lista blanca, y el criterio se escribe **en el código**, no en el SDD

Reenviar `req.headers` entero mandaría la **cookie de sesión Supabase** del usuario logueado a un
servicio de Railway que no la pidió (`middleware.ts:42-57` la escribe en toda navegación).

Un header entra a la lista si cumple **las tres** condiciones:

1. **Tiene un consumidor citable en `wasiai-a2a`**, en una de tres categorías, y la cita va al lado
   del header:
   - `read` — un `headers['…']` explícito en `wasiai-a2a/src/`;
   - `framework` — lo consume el framework de forma documentada (p. ej. `x-forwarded-for` →
     `trustProxy` en `wasiai-a2a/src/index.ts:163` + `:158`);
   - `transport` — semántica de transporte obligatoria (`content-type` para poder parsear el body).
2. **No es credencial de v2 ni identidad del navegador.** `cookie`, `set-cookie`, `referer`,
   `origin`, `host`, `x-vercel-*`, `x-middleware-*` quedan afuera **por definición**.
3. **Su ausencia es semánticamente distinta de un valor vacío, y el reenvío preserva esa
   distinción.** Por eso la guarda `if (v)` de `forward-handler.ts:81` **se conserva tal cual**
   (CD-3).

**El criterio deja de ser prosa**: la lista pasa a ser un arreglo de objetos
`{ header, consumer, citation, why }` y **un test falla si una entrada nueva no trae `citation`**
(§10, T-04b). *Esto sería falso si* alguien pudiera agregar un string a la lista y la suite quedara
verde.

Los tres headers nuevos cumplen las tres condiciones:

| Header | Consumidor citado | Cond. 2 | Cond. 3 |
|---|---|---|---|
| `x-a2a-contracting-chain` | `read` — `contracting-chain.ts:769` (paso 3, `:806-818`) | no es credencial | ausente ⇒ cadena vacía; `''` ⇒ misma rama, pero un eslabón ilegible ⇒ `CONTRACTING_CHAIN_MALFORMED` (`:810-816`) |
| `x-a2a-contracting-depth` | `read` — `contracting-chain.ts:820-827` | no es credencial | **ausente ⇒ 0; `''` ⇒ `CONTRACTING_DEPTH_MALFORMED`** (`:822-825`) |
| `x-payment-chain` | `read` — `a2a-key.ts:358` (agent-key), `x402.ts:425` (x402), `routes/compose.ts:107`, `routes/gasless.ts:77` | no es credencial | **ausente ⇒ default del registry; `''` ⇒ `400 CHAIN_NOT_SUPPORTED`** — medido: `normalizeChainSlug('')` devuelve `undefined` por `key.length === 0` (`chain-resolver.ts:422`) y `resolveTargetChain` responde 400 porque `headerOverride !== undefined` (`a2a-key.ts:365-370`) |

### DT-2 — **(B+)**: `wasiai-v2` / `wasiai-v2.vercel.app` **no** se alinea; el primer testigo es el **Preview de `wasiai-prod`**, y si el Preview no delega, es `app.wasiai.io` y se dice

El work-item recomendaba **(A) alinear staging** (el proyecto `wasiai-v2`, dominio
`wasiai-v2.vercel.app`). Se **rechaza**, con tres motivos medibles:

1. **Alinear `wasiai-v2` haría al gateway incapaz de distinguir los dos ambientes.** `forward-handler.ts:77`
   emite `x-wasiai-source: 'v2-proxy'` — un **literal sin componente de ambiente** — y
   `wasiai-a2a/src/middleware/forward-key.ts:87-99` loguea exactamente ese valor. Dos proyectos
   Vercel ⇒ una sola etiqueta en el log del gateway. Es **la misma enfermedad que esta HU cura**,
   sembrada del otro lado. *Falsable*: si `x-wasiai-source` llevara el ambiente, este motivo cae.
2. **`wasiai-v2` / `wasiai-v2.vercel.app` pasaría a consumir el mismo gateway que sirve a
   `wasiai-prod` / `app.wasiai.io`.** El único `WASIAI_A2A_BASE_URL` con
   evidencia en el árbol es `wasiai-a2a-production.up.railway.app` (126 ocurrencias en git; el
   `resource` del challenge x402 de §3.2 lo confirma en vivo). `wasiai-v2` escribiría recibos y
   telemetría en la base de `wasiai-a2a` que hoy atiende a `app.wasiai.io`.
3. **Es una acción de ops con un hazard que tira el ambiente entero** (CD-1: `env.ts:75-86` +
   `:94` ⇒ throw en carga de módulo ⇒ **500 en toda ruta que importe `@/lib/env`**, no un 503
   acotado).

**Qué se hace en lugar de eso.** `NC-3` está resuelto: `wasiai-prod` **no** auto-despliega en push
(`CLAUDE.md:20-23`, confirmado por `vercel ls wasiai-prod` — los commits de hace 2 días figuran como
**Preview** y el último **Production** es de hace 4 días). Entonces un push de la branch crea un
**Preview del proyecto `wasiai-prod`** sin tocar `app.wasiai.io`.

**W3.1 — medición que decide el testigo** (no bloquea W0/W1/W2):

```
POST https://<preview-url-de-wasiai-prod>/api/v1/compose  -H 'content-type: application/json'  -d '{"steps":[]}'
  -> {"code":"VALIDATION_ERROR", "requestId": …}   ⇒ el Preview DELEGA. Es el primer testigo de AC-1/AC-1b.
  -> 503 {"error":"COMPOSE_DISABLED"}              ⇒ el Preview NO delega (las 3 vars están scopeadas a Production).
                                                     ⇒ el primer testigo ES app.wasiai.io, después de la promoción manual.
```

**Consecuencia que se declara sin adornos:** si la medición da 503, **el primer ambiente donde se
verifica AC-1/AC-1b es `wasiai-prod` / `app.wasiai.io`**, o sea el camino de dinero, y se acepta
porque (a) la promoción es manual y deliberada, (b) la reversa es Instant Rollback de Vercel sobre
un cambio de **código** (no de env), y (c) las tres pruebas de la terna cortan antes de cobrar.

**Efecto sobre los ACs**: **AC-9 se elimina** (declaraba "cuando staging tenga las tres variables
configuradas"; con (B+) esa premisa nunca se cumple, y un AC con premisa falsa es un AC que aprueba
solo). **AC-10 se conserva**: es la reversa, no depende de `wasiai-v2`, y se verifica en test unitario.

### DT-3 — El cambio es fail-closed en dos frentes, y el segundo es más grande que el que declaraba el work-item

| Frente | Antes del fix | Después del fix | ¿Es lo buscado? |
|---|---|---|---|
| contracting | un caller con traza en bucle o sobre el techo **es servido** | `CONTRACTING_LOOP_DETECTED` / `DEPTH_EXCEEDED` / `*_MALFORMED` | **sí**. Radio hoy ≈ nulo: `contracting-chain.ts:82-84` dice que los 25 agentes descubribles en prod no emiten estos headers |
| `x-payment-chain` (a) | pide Base, **le cobran Kite** en silencio | le cotizan y le cobran **Base** | **sí — es el arreglo** |
| `x-payment-chain` (b) | manda un slug inválido, **le aplican el default y funciona** | **400 `CHAIN_NOT_SUPPORTED`** | sí: convierte un silencio-incorrecto en un error-correcto, **pero es una petición que hoy responde 402/200 y pasará a responder 400** |
| `x-payment-chain` (c) | pide una red sin saldo, **le cobran del default** | **403 `INSUFFICIENT_BUDGET`** en la red pedida | ídem (b) |

**(b) y (c) son cambios de status en el camino de dinero vivo.** La población afectada es "callers
que hoy mandan `x-payment-chain` a `app.wasiai.io`", que **hoy no puede contarse desde este repo**
(v2 sólo proxea y no loguea headers). Por eso:

- **Disparador de reversa (DT-3-R)**: en la ventana de **60 minutos** posteriores a la promoción de
  `wasiai-prod`, si aparecen en los logs de Railway del gateway respuestas
  `CHAIN_NOT_SUPPORTED` o `INSUFFICIENT_BUDGET` con `x-wasiai-source: v2-proxy` que **no existían
  antes**, se ejecuta la reversa de §12.2. El punto de observación está **fuera de este repo** ⇒
  acción **A-4**, declarada y no ejecutada acá.
- Este párrafo **tiene que aparecer en el done-report**. Que "no duele hoy" cambia la prioridad, no
  la decisión.

### DT-4 — Cuatro piezas para el anti-silencio; ninguna sola alcanza

| Pieza | Qué ve | Qué NO ve | AC |
|---|---|---|---|
| **Manifiesto** en git, por ambiente | la **intención**, revisable en PR | nada del runtime | insumo de AC-7 |
| **Endpoint de estado** | el runtime real **y qué ambiente responde** | si a2a contesta | AC-5, AC-6 |
| **Cron diario** | la divergencia manifiesto↔runtime, y **card↔lista blanca**, sin que nadie pregunte | sólo el ambiente donde corre | AC-7, AC-11 |
| **Smoke** con host obligatorio | el circuito completo, incluida **la terna** | corre cuando alguien lo corre | AC-8 |

Por qué un test de vitest **no puede ser** el mecanismo principal: corre en CI con el `process.env`
de CI y este repo **mockea `@/lib/env`** en los tests del proxy (`forward-handler.test.ts:8-15`).
Por qué `validate-env.js` tampoco: es presencia incondicional (`:18-29` → `:76` → `exit 0` en
`:133`) y, sobre todo, **no sabe en qué ambiente corre**, que es el dato que faltó.

### DT-5 — El endpoint y el cron leen `isDelegated()`, nunca `process.env`

Si recalcularan el conjunto desde la env estarían verificando **su propia copia de la fórmula** y
aplaudirían cualquier cosa. Y hay una razón más dura: `DELEGATED` se **congela en carga de módulo**
(`forward-handler.ts:59`), así que leer la env en vivo puede reportar un valor que **las rutas no
están usando** (por ejemplo, después de cambiar la env sin redeploy, sobre una lambda tibia).

Implementación: `forward-handler.ts` exporta `listDelegatedEndpoints()`, que filtra la lista
exhaustiva de endpoints por `isDelegated`. **No** se exporta el `Set` `DELEGATED` (sería mutable
desde afuera).

### DT-6 — La señal de AC-7 no puede depender de Sentry (`NC-4` resuelto)

`sentry.server.config.ts:3` inicializa Sentry **sólo si `process.env.SENTRY_DSN`** existe. Sin DSN,
`captureMessage` es un no-op **silencioso** — o sea, reintroduce exactamente el silencio que la HU
cierra. Por eso la señal es **de tres canales, y el primero no depende de ninguna env**:

1. **El cron responde `500`** con el detalle en el body. El status de cada ejecución queda en el log
   de Cron Jobs del proyecto Vercel. *Sería falso si* Vercel no registrara el status de las
   ejecuciones de cron.
2. `logger.error` estructurado (`@/lib/logger`, el mismo de `reconcile-onchain/route.ts:6`).
3. `Sentry.captureMessage` **best-effort**, con un comentario en el código que dice textualmente que
   es no-op sin `SENTRY_DSN` y cita `sentry.server.config.ts:3`.

### DT-7 — La lista blanca se entera sola: **diff contra el Agent Card del gateway** (AC-11)

Medido hoy en `GET https://wasiai-a2a-production.up.railway.app/.well-known/agent.json`:

```json
"contracting": { "depthMax": 2,
                 "chainHeader": "x-a2a-contracting-chain",
                 "depthHeader": "x-a2a-contracting-depth", "bestEffortNote": "…" }
```

**El gateway ya publica los nombres de los headers que lee.** El cron los extrae y verifica que cada
uno esté en la lista blanca. **Ese chequeo habría cazado esta HU el día que WKH-360 se desplegó**,
sin coordinar nada y sin editar `wasiai-a2a`.

**Cobertura exacta, medida, sin adornar**: el card declara **2** nombres de header (barrido de todo
el JSON: los únicos strings con forma `x-…` son `x-a2a-contracting-chain` y
`x-a2a-contracting-depth`). **`x-payment-chain` NO está en el card** ⇒ el mecanismo **no lo habría
cazado**, y por lo tanto **no basta solo**. Queda:

- **cubierto por el card-diff**: los headers que a2a declara (hoy 2);
- **cubierto por el criterio escrito + el test T-04b**: cualquier header que alguien intente agregar
  sin cita de lector;
- **descubierto**: un header que a2a estrene **y no declare**. Cierre propuesto → **A-3**: pedirle a
  `wasiai-a2a` que publique su set completo de headers inbound en el Agent Card. **Este SDD no lo
  edita** (CD-5).

Esa tabla de tres filas es la respuesta a *"cómo se entera la lista blanca"*, incluido lo que sigue
sin cubrir.

### DT-8 — Las dos pantallas **NO** migran a `x-a2a-key` en esta HU (`NC-2` resuelto)

**Lo medido.** En todo `wasiai-a2a/src/`, `x-api-key` aparece **una sola vez**, en
`src/services/registry.redaction.test.ts:319`, y es un fixture de configuración de registry: **el
gateway no tiene ningún lector de `x-api-key` como credencial**. Su extractor de credencial es
`extractRawKeyFromHeaders` (`a2a-key.ts:543-559`): `x-a2a-key` (`:546`) o `Authorization: Bearer` con
prefijo **`wasi_a2a_`** (`:554`). Coincide con la medición del orquestador contra `app.wasiai.io`:
`x-api-key` ⇒ *"payment-signature header is required"* (402), `x-a2a-key` ⇒ autentica.

⇒ **`DemoPageClient.tsx:93` y `PipelinePageClient.tsx:84` están recibiendo 402 hoy en
`wasiai-prod` / `app.wasiai.io`.** Es un defecto real y está anotado.

**No entra acá, por tres razones falsables:**

1. **Scope.** El Scope IN del work-item aprobado (líneas 205-219) no las incluye. HU_APPROVED se dio
   sobre ese alcance.
2. **Dependencia técnica, medida.** Con `x-a2a-key`, el gateway responde
   `chain 2368 (kite-ozone-testnet) balance is 0; no x-payment-chain header sent, used default`.
   O sea: cambiar sólo el nombre del header deja las dos pantallas en **403 en Kite**, salvo que
   además elijan red — lo cual **depende de esta HU** (el passthrough de `x-payment-chain`) **y**
   de una decisión de UI (qué red, qué presupuesto, qué copy). *Sería falso si* una pantalla con
   `x-a2a-key` y sin selector de red devolviera 200.
3. **Ambigüedad de reversa.** Migrarlas convierte dos pantallas que hoy **nunca cobran** en dos
   pantallas que **cobran**. Meter eso en el mismo despliegue que el fix del money-path hace que un
   incidente no se pueda atribuir a un cambio u otro.

⇒ **HU aparte, A-5**, ya desbloqueada por ésta.

**Qué sí se hace acá con `x-api-key`**: **se conserva en la lista** (regresión cero) y se lo marca
en el código como **alias sin lector**, con `consumer: 'none'` y la medición fechada. El test T-04b
exige que **`x-api-key` sea la única entrada sin cita**: cualquier header nuevo sin lector rompe la
suite. *Sería falso si* alguien pudiera agregar un segundo header sin cita y `npm test` siguiera
verde.

### DT-9 — `V2_DELEGATE_TO_A2A` congelado ⇒ AC-10 va en un archivo de test **propio**

`DELEGATED` se evalúa una vez, en carga de módulo (`forward-handler.ts:59`). `vi.mock('@/lib/env')`
es **por archivo**. Por lo tanto AC-10 (delegación apagada ⇒ 503) **no puede** convivir con los
tests que mockean la delegación encendida: necesita su propio archivo con su propio mock.

Además — lección directa de `doc/sdd/076-…/auto-blindaje.md` — `@/lib/env` tiene `import
'server-only'` (`env.ts:13`), que bajo vitest **lanza al colectar**. Mockearlo (como ya hace
`forward-handler.test.ts:8-15`) es también lo que evita ese hazard. **`delegation-manifest.ts` debe
ser un módulo puro** (sin `server-only`, sin `@/lib/env`, sin I/O) por el mismo motivo.

---

## 7. Acceptance Criteria (EARS)

> Heredados del work-item aprobado, con los cambios de §0 marcados.

**Grupo A — los headers**

- **AC-1** *(heredado)*: WHEN el caller envía `x-a2a-contracting-chain` y/o
  `x-a2a-contracting-depth` con valor no vacío a `/api/v1/compose` o `/api/v1/orchestrate`, the
  system SHALL incluirlos, **con el valor recibido sin modificar**, en el request que emite hacia
  `wasiai-a2a`.
  *Evidencia exigida:* la respuesta de `app.wasiai.io` con `depth: 99` SHALL dejar de ser idéntica a
  la respuesta sin header, y SHALL contener `CONTRACTING_DEPTH_EXCEEDED`.
- **AC-1b** *(NUEVO — §0.1)*: WHEN el caller envía `x-payment-chain` con valor no vacío a
  `/api/v1/compose` o `/api/v1/orchestrate`, the system SHALL incluirlo, con el valor recibido sin
  modificar, en el request que emite hacia `wasiai-a2a`.
  *Evidencia exigida (money-path, costo cero):* con body `{"steps":[{"agent":"wasi-chainlink-price"}]}`,
  `app.wasiai.io` + `x-payment-chain: base-sepolia` SHALL devolver `402` con
  `accepts[0].network === "eip155:84532"` (hoy devuelve `eip155:2368`), y
  `app.wasiai.io` + `x-payment-chain: nonexistent-chain-xyz` SHALL devolver `400 CHAIN_NOT_SUPPORTED`
  (hoy devuelve `402` con `eip155:2368`).
- **AC-2** *(heredado)*: IF el caller NO envía uno de esos headers, THEN the system SHALL NO
  emitirlo upstream, **ni siquiera con valor vacío**.
- **AC-3** *(heredado)*: the system SHALL reenviar hacia `wasiai-a2a` únicamente los headers de una
  lista blanca explícita, y SHALL NO reenviar `cookie` ni ningún header no listado.
- **AC-4** *(heredado)*: WHEN corre `npm test`, the system SHALL fallar si la lista blanca cambia
  sin que se actualice el test que la fija.
- **AC-4b** *(refuerzo de AC-4, de DT-1)*: WHEN corre `npm test`, the system SHALL fallar si una
  entrada de la lista blanca no declara su consumidor con una cita `archivo:línea` de `wasiai-a2a`,
  salvo la única excepción declarada (`x-api-key`, DT-8).

**Grupo B — que el ambiente se pueda contestar sin pegarle a mano**

- **AC-5** *(heredado)*: WHEN se hace `GET /api/v1/status/delegation`, the system SHALL devolver
  `200` con **(a)** un identificador del ambiente que responde, **(b)** la lista de endpoints
  efectivamente delegados leída **del mismo módulo que deciden las rutas**, y **(c)** un booleano
  por cada una de `WASIAI_A2A_BASE_URL` y `WASIAI_V2_FORWARD_KEY`. the system SHALL NO incluir el
  **valor** de ninguna de las dos.
- **AC-6** *(heredado)*: WHILE dos ambientes distintos respondan ese endpoint, the system SHALL
  devolver identificadores de ambiente **distintos entre sí**.
- **AC-7** *(heredado)*: IF el conjunto de endpoints delegados observado en runtime difiere del
  declarado en el manifiesto versionado en git para ese ambiente, THEN the system SHALL emitir una
  señal observable sin intervención humana, nombrando **el ambiente** y **cada endpoint** que
  difiere.
- **AC-8** *(heredado)*: IF el smoke post-deploy detecta que un endpoint declarado como delegado
  responde `503` con `*_DISABLED`, THEN el smoke SHALL terminar con código distinto de `0` y SHALL
  imprimir **el ambiente probado**, el endpoint, el status y el `error` recibido.
- **AC-11** *(NUEVO — DT-7)*: IF el Agent Card de `wasiai-a2a` declara un nombre de header que **no**
  está en la lista blanca del proxy, THEN el cron SHALL emitir la misma señal observable de AC-7,
  nombrando cada header faltante. IF el Agent Card **no se puede obtener**, THEN el cron SHALL
  reportarlo como advertencia y **NO** como divergencia.

**Grupo C — reversa**

- ~~**AC-9**~~ — **ELIMINADO** por DT-2(B+): declaraba "cuando staging tenga las tres variables
  configuradas", premisa que con (B+) nunca se cumple. Un AC con premisa falsa se aprueba solo.
- **AC-10** *(heredado, conservado)*: WHILE `V2_DELEGATE_TO_A2A` esté vacío o ausente en un
  ambiente, the system SHALL responder `503` en `/compose` y `/orchestrate` en **ese** ambiente —
  o sea, la reversa devuelve exactamente el comportamiento previo.

---

## 8. Scope

### 8.1 Scope IN

| Archivo | Existe | Acción | Wave |
|---|---|---|---|
| `src/lib/proxy/passthrough-headers.ts` | No | **Crear** — la lista blanca como datos con criterio (`{header, consumer, citation, why}`) | W0 |
| `src/lib/proxy/delegation-manifest.ts` | No | **Crear** — declaración por ambiente, módulo **puro** | W0 |
| `src/lib/proxy/forward-handler.ts` | Sí | Modificar — consume la lista de W0; exporta `listDelegatedEndpoints()` y `isForwardKeyConfigured()` | W1 |
| `src/lib/proxy/__tests__/forward-handler.test.ts` | Sí | Modificar — AC-1, AC-1b, AC-2, AC-3, AC-4, AC-4b | W1 |
| `src/lib/proxy/__tests__/delegation-off.test.ts` | No | **Crear** — AC-10 (mock propio, DT-9) | W1 |
| `src/lib/proxy/__tests__/delegation-manifest.test.ts` | No | **Crear** — resolución por host, exhaustividad | W1 |
| `src/app/api/v1/status/delegation/route.ts` | No | **Crear** — AC-5, AC-6 | W2 |
| `src/app/api/v1/status/delegation/__tests__/route.test.ts` | No | **Crear** — AC-5, AC-6 | W2 |
| `src/app/api/cron/delegation-drift/route.ts` | No | **Crear** — AC-7, AC-11 | W2 |
| `src/app/api/cron/delegation-drift/__tests__/route.test.ts` | No | **Crear** — AC-7, AC-11 | W2 |
| `vercel.json` | Sí | Modificar — registrar el cron (`0 6 * * *`) | W2 |
| `scripts/smoke-delegation.mjs` | No | **Crear** — AC-8 + la terna de CD-7; host obligatorio | W2 |
| `package.json` | Sí | Modificar — script `smoke:delegation` **sin host por defecto** | W2 |
| `scripts/validate-env.js` | Sí | Modificar — regla **condicional** para las 3 vars (DT-4) | W3 |
| `.env.example` | Sí | Modificar — orden de encendido/apagado (CD-1) junto a `:105`/`:109`/`:118` | W3 |
| `CLAUDE.md` | Sí | Modificar — el estado del cutover pasa a ser **un puntero al endpoint**, y la fila de `wasiai-prod` nombra `app.wasiai.io` | W3 |
| `doc/sdd/077-…/` | Sí | artefactos + evidencia con host y fecha | W0–W3 |

### 8.2 Scope OUT

- **Encender la delegación en `wasiai-prod` / `app.wasiai.io`**: ya está encendida. Esta HU **no
  toca** ninguna env var de `wasiai-prod`.
- **Alinear staging** (`wasiai-v2` / `wasiai-v2.vercel.app`) — DT-2(B+). No se tocan sus env vars.
- **`V2_DELEGATE_TO_A2A=mcp`** — `CLAUDE.md:101`.
- **Editar `wasiai-a2a`** (ni `src/`, ni su `CLAUDE.md`, ni su Agent Card) — CD-5. Sale como A-1/A-3.
- **Migrar las dos pantallas a `x-a2a-key`** — DT-8 → A-5.
- **Arreglar el copy de error de las dos pantallas** (`DemoPageClient.tsx:97`,
  `PipelinePageClient.tsx:112` muestran el código crudo).
- **Reenviar headers de *respuesta*** del gateway hacia el caller — hallazgo **H-1** (§13).
- **Agregar el ambiente a `x-wasiai-source`** — hallazgo **A-3b** (§13); cambia lo que ve el gateway
  y no tiene AC en esta HU.
- **El camino paginado** de `capabilities` (`route.ts:152`) y el loop-break TD-002 (`:143-145`).
- **Cualquier lógica de pricing/x402/settlement en v2** — `CLAUDE.md:97`.

---

## 9. Diseño técnico

### 9.0 Waves de implementación

| Wave | Serial? | Archivos exactos | Depende de | Verificación al cerrar |
|---|---|---|---|---|
| **W0** — contratos y datos | **serial** (gate) | `src/lib/proxy/passthrough-headers.ts` *(nuevo)* · `src/lib/proxy/delegation-manifest.ts` *(nuevo)* | — | `npm run typecheck` |
| **W1** — el fix del camino del dinero | tras W0 | `src/lib/proxy/forward-handler.ts` · `src/lib/proxy/__tests__/forward-handler.test.ts` · `src/lib/proxy/__tests__/delegation-off.test.ts` *(nuevo)* · `src/lib/proxy/__tests__/delegation-manifest.test.ts` *(nuevo)* | W0 | `npm test` **completo** (CD-13) — T-01…T-04b, T-10, T-11, T-12 |
| **W2** — anti-silencio | tras W1 | `src/app/api/v1/status/delegation/route.ts` *(nuevo)* + su `__tests__/route.test.ts` · `src/app/api/cron/delegation-drift/route.ts` *(nuevo)* + su `__tests__/route.test.ts` · `vercel.json` · `scripts/smoke-delegation.mjs` *(nuevo)* + su test · `package.json` | W1 (usa `listDelegatedEndpoints`, `isForwardKeyConfigured`, `PASSTHROUGH_HEADERS`) | `npm test` completo + **el cron aparece listado en Vercel → `wasiai-prod` → Cron Jobs** (§9.5, R-4) |
| **W3** — documentación y testigo | tras W2 | `scripts/validate-env.js` · `.env.example` · `CLAUDE.md` · `doc/sdd/077-…/` | W2 | `npm run qa` + **W3.1**: sondeo del Preview de `wasiai-prod` (DT-2) + las dos ternas (§3.1, §3.2) |

**W1 y W2 son mergeables por separado** (el work-item lo pedía): W1 sola ya cierra el defecto del
camino del dinero y no necesita nada de W2. W2 sin W1 no compila, porque importa símbolos que W1
exporta.

**W3.1 no bloquea el merge**: decide *dónde* se verifica AC-1/AC-1b, no *si* el código es correcto.

### 9.1 `src/lib/proxy/passthrough-headers.ts` (nuevo, puro)

Contrato:

```
type PassthroughConsumer = 'read' | 'framework' | 'transport' | 'none'

interface PassthroughHeaderEntry {
  header:   string                 // siempre en minúsculas
  consumer: PassthroughConsumer
  citation: string | null          // 'wasiai-a2a/src/…:NNN' — null SÓLO si consumer === 'none'
  why:      string                 // una línea, en castellano
}

PASSTHROUGH_HEADER_ENTRIES : readonly PassthroughHeaderEntry[]
PASSTHROUGH_HEADERS        : readonly string[]   // derivado: entries.map(e => e.header)
```

Contenido (11 entradas = las 8 de hoy, **en el mismo orden**, + las 3 nuevas al final):

| # | header | consumer | citation | nota |
|---|---|---|---|---|
| 1 | `x-payment` | read | `wasiai-a2a/src/middleware/x402.ts:517` | const en `:47` |
| 2 | `payment-signature` | read | `wasiai-a2a/src/middleware/x402.ts:518` | const en `:48` |
| 3 | `x-a2a-key` | read | `wasiai-a2a/src/middleware/a2a-key.ts:546` | |
| 4 | `x-api-key` | **none** | **null** | **alias muerto (DT-8)**. Medido 2026-08-18: `git grep -n "x-api-key" -- src/` en `wasiai-a2a` devuelve **una** línea, `src/services/registry.redaction.test.ts:319`, que es un fixture, no un lector |
| 5 | `authorization` | read | `wasiai-a2a/src/middleware/a2a-key.ts:551` | sólo prefijo `wasi_a2a_` (`:554`) |
| 6 | `content-type` | transport | — | necesario para parsear el body |
| 7 | `user-agent` | framework | `wasiai-a2a/src/index.ts:163` | logging de Fastify; sin `headers['user-agent']` explícito en `src/` |
| 8 | `x-forwarded-for` | framework | `wasiai-a2a/src/index.ts:158` | `trustProxy` (`:163`) resuelve `request.ip` desde acá |
| 9 | **`x-a2a-contracting-chain`** | read | `wasiai-a2a/src/lib/contracting-chain.ts:769` | paso 3 en `:806-818` |
| 10 | **`x-a2a-contracting-depth`** | read | `wasiai-a2a/src/lib/contracting-chain.ts:820` | `''` ⇒ `DEPTH_MALFORMED` (`:822-825`) |
| 11 | **`x-payment-chain`** | read | `wasiai-a2a/src/middleware/a2a-key.ts:358` | también `x402.ts:425`, `routes/compose.ts:107`, `routes/gasless.ts:77` |

En el docblock del archivo va el criterio de DT-1 **completo**, incluida la lista de exclusiones
por definición (`cookie`, `set-cookie`, `referer`, `origin`, `host`, `x-vercel-*`, `x-middleware-*`).

**No** se agrega ningún tope de longitud del lado de v2: el gateway ya tiene el suyo
(`contracting-chain.ts:781-790`, `chainHeaderMaxChars(depthMax)`), y **dos techos que pueden
divergir son peores que uno**.

### 9.2 `src/lib/proxy/delegation-manifest.ts` (nuevo, puro)

```
interface DelegationEnvironmentDeclaration {
  key:           'wasiai-prod' | 'wasiai-v2'
  vercelProject: string
  hosts:         readonly string[]                 // DESCRIPTIVO — medido
  delegated:     readonly DelegatedEndpoint[]      // PRESCRIPTIVO — la intención
  measuredAt:    string                            // 'YYYY-MM-DD'
  evidence:      string                            // el instrumento con el que se midió
}

DELEGATION_MANIFEST : readonly DelegationEnvironmentDeclaration[]
resolveDeclaration(host: string | null): DelegationEnvironmentDeclaration | null
```

Contenido (medido hoy, §3.0):

| key | vercelProject | hosts | delegated |
|---|---|---|---|
| `wasiai-prod` | `wasiai-prod` | `app.wasiai.io`, `wasiai-prod.vercel.app` | `capabilities`, `compose`, `orchestrate` |
| `wasiai-v2` | `wasiai-v2` | `wasiai-v2.vercel.app` | *(vacío)* |

`mcp` no está delegado en ningún ambiente (`CLAUDE.md:101`).

`resolveDeclaration`: normaliza el host (minúsculas, sin puerto), match **exacto**, sin comodines.
Host desconocido ⇒ `null` ⇒ el endpoint reporta `UNDECLARED_HOST` y el cron lo trata como
divergencia. **Fail-loud, nunca silencio.**

⚠️ **La distinción que evita que el mecanismo se aplauda a sí mismo** (CD-9): `hosts` es
**descriptivo** — qué nombres rutean a ese proyecto — y se escribe desde la medición. `delegated` es
**prescriptivo** — qué queremos que delegue — y **jamás se ajusta a lo observado en runtime para
callar al cron**. Si el cron grita, la salida es investigar el ambiente, no editar `delegated`.

`wasiai-prod.vercel.app` va en `hosts` porque `CLAUDE.md:10` lo declara; **si el cron reporta
`UNDECLARED_HOST` con un host distinto, ese host se agrega tras medirlo, y la evidencia va en el PR.**

### 9.3 `src/lib/proxy/forward-handler.ts` (modificar)

1. Importar `PASSTHROUGH_HEADERS` de `./passthrough-headers` y borrar el arreglo local `:39-48`.
   El bucle `:79-82` **no cambia** — en particular **la guarda `if (v)` de `:81` queda intacta**
   (CD-3).
2. Reemplazar la unión suelta `DelegatedEndpoint` (`:50`) por el patrón exhaustivo del exemplar
   verificado `wasiai-a2a/src/adapters/chain-resolver.ts:118-127`:
   `const DELEGATED_ENDPOINT_ORDER: Record<DelegatedEndpoint, true> = { compose:true, orchestrate:true, capabilities:true, mcp:true }`
   y `export const DELEGATED_ENDPOINT_VALUES = Object.keys(DELEGATED_ENDPOINT_ORDER) as DelegatedEndpoint[]`.
   Agregar un miembro a la unión sin clasificarlo **no compila**.
3. `export function listDelegatedEndpoints(): DelegatedEndpoint[]` → `DELEGATED_ENDPOINT_VALUES.filter(isDelegated)`.
   **No** se exporta `DELEGATED` (CD-4).
4. `export function isForwardKeyConfigured(): boolean` con **la misma expresión** que hoy vive dentro
   de `assertForwardKeyConfigured` (`:30`), y `assertForwardKeyConfigured` pasa a usarla. Un solo
   predicado, dos consumidores: el endpoint de estado no puede decir `true` donde el proxy tiraría.

**Nada más cambia en este archivo.** No se toca el timeout, ni el mapeo de errores, ni el
`clearTimeout` de `:147`.

### 9.4 `GET /api/v1/status/delegation` (nuevo)

`export const runtime = 'nodejs'` · `export const dynamic = 'force-dynamic'` ·
`Cache-Control: no-store`.

> El `no-store` **no es cosmético**: una respuesta de estado cacheada en el borde podría contestar
> por un despliegue que no es el que atendió, que es literalmente la familia de error de esta HU.

Respuesta `200`:

```
{
  "environment": {
    "host":         "app.wasiai.io",        // req.headers.get('host'), normalizado
    "vercelEnv":    "production" | "preview" | "development" | null,
    "deploymentId": string | null,          // process.env.VERCEL_DEPLOYMENT_ID
    "commitSha":    string | null,          // process.env.VERCEL_GIT_COMMIT_SHA
    "declaredAs":   "wasiai-prod" | "wasiai-v2" | null
  },
  "delegation": {
    "runtime":  ["capabilities","compose","orchestrate"],   // listDelegatedEndpoints()
    "declared": ["capabilities","compose","orchestrate"] | null,
    "match":    "MATCH" | "DRIFT" | "UNDECLARED_HOST"
  },
  "config": { "WASIAI_A2A_BASE_URL": true, "WASIAI_V2_FORWARD_KEY": true },
  "passthroughHeaders": ["x-payment", "...", "x-payment-chain"],   // NOMBRES, nunca valores
  "checkedAt": "2026-08-18T00:00:00.000Z"
}
```

**Qué se expone y por qué no es un secreto** (esto va también en el docblock): dos booleanos de
presencia (nunca los valores — AC-5), los **nombres** de header reenviados, el conjunto de endpoints
delegados, y datos de despliegue que Vercel ya publica. **No** aparecen `WASIAI_A2A_BASE_URL`,
`WASIAI_V2_FORWARD_KEY`, ni su longitud.

**`host` lo escribe el caller.** Es identidad **informativa**, no un borde de autenticación. Por eso
la respuesta devuelve **el host crudo junto a `declaredAs`**: si alguien falsea el `Host`, se ve en
la misma respuesta. Como el endpoint no expone secretos, falsear el `Host` no habilita nada.

Cómo satisface **AC-6**: dos ambientes contestan con `host` distinto (`app.wasiai.io` vs
`wasiai-v2.vercel.app`) y con `deploymentId` distinto. *Sería falso si* las dos respuestas fueran
byte-idénticas — y eso es exactamente lo que verifica el paso 1 del smoke.

### 9.5 `GET /api/cron/delegation-drift` (nuevo)

Primera línea: `verifyCronAuth(req.headers.get('authorization'))` (exemplar:
`reconcile-onchain/route.ts:13-16`). `export const runtime = 'nodejs'`.

Dos comparaciones **independientes**:

| # | Comparación | Verdicto duro | AC |
|---|---|---|---|
| 1 | `listDelegatedEndpoints()` vs `resolveDeclaration(host).delegated` | `DELEGATION_DRIFT` (con `missing[]` y `unexpected[]`) o `UNDECLARED_HOST` | AC-7 |
| 2 | nombres de header del Agent Card vs `PASSTHROUGH_HEADERS` | `HEADER_WHITELIST_DRIFT` (con `missing[]`) | AC-11 |

Para (2): `GET ${env.WASIAI_A2A_BASE_URL}/.well-known/agent.json` con `AbortController` (10 s).
Extracción: `contracting.chainHeader` y `contracting.depthHeader` si son strings; se ignora todo lo
demás. **Card inalcanzable o sin bloque `contracting` ⇒ `agentCard.reachable: false` y verdicto
`WARN`, NUNCA `DRIFT`** — apagar el gateway no puede fabricar una alarma de lista blanca (AC-11,
segunda oración). *Sería falso si* con el gateway caído el cron reportara `HEADER_WHITELIST_DRIFT`.

Salida: `200` si los dos verdictos son `MATCH` (o `MATCH` + `WARN`); **`500`** con el detalle si
cualquiera es drift. Tres canales de señal, DT-6.

Registro en `vercel.json`: `{ "path": "/api/cron/delegation-drift", "schedule": "0 6 * * *" }` (las 4
existentes ocupan 02:00–05:00 UTC).

⚠️ **Verificación obligatoria de W2** (si no, AC-7 falla en silencio): confirmar en el dashboard de
Vercel → proyecto `wasiai-prod` → Cron Jobs que `/api/cron/delegation-drift` **aparece listado con su
schedule**. Algunos planes limitan la cantidad de crons; si el quinto no se registra, el cron **no
corre y nadie se entera**. En ese caso el backstop declarado es el smoke (AC-8), y hay que decirlo en
el done-report.

### 9.6 `scripts/smoke-delegation.mjs` (nuevo)

```
node scripts/smoke-delegation.mjs <host> [--gateway <url>]
```

- **Sin `<host>` ⇒ exit 2 + uso.** No hay host por defecto (DT-6 del work-item): un smoke con host
  por defecto es el mismo footgun que abrió esta HU.
- **Cada línea de salida empieza por el host probado.**

| Paso | Qué hace | Falla si |
|---|---|---|
| 1 | `GET /api/v1/status/delegation` | status ≠ 200. Imprime `environment` completo |
| 2 | para cada endpoint de `delegation.runtime` ∩ `{compose, orchestrate}`: `POST` con body mínimo | responde `503` con `*_DISABLED` → **AC-8**: exit ≠ 0 + host + endpoint + status + `error` |
| 3 | **terna de contracting**: `POST /api/v1/compose` con y sin `x-a2a-contracting-depth: 99` | las dos respuestas son iguales, o la del header no contiene `CONTRACTING_DEPTH_EXCEEDED` |
| 4 | **terna de `x-payment-chain`** (§3.2): body `{"steps":[{"agent":"wasi-chainlink-price"}]}` con `x-payment-chain: base-sepolia` y sin él | `accepts[0].network` es igual en las dos, o no es `eip155:84532` con el header |
| 5 | con `--gateway`: mismos pasos 3-4 contra el gateway directo | la pata de control no da el resultado esperado ⇒ el instrumento está roto, no el sistema |
| 6 | `delegation.match !== 'MATCH'` | exit ≠ 0, salvo `vercelEnv === 'preview'`, donde imprime `PREVIEW_NOT_DECLARED` y **no** falla |

**Ninguno de los 6 pasos mueve fondos.** Los pasos 3-5 cortan en 400/402 (challenge), y el propio
gateway lo dice en el body del 400 de contracting: *"La peticion se rechaza sin cobrar"*.

`package.json`: `"smoke:delegation": "node scripts/smoke-delegation.mjs"` — **sin host**, para que no
se pueda correr por accidente contra nada.

### 9.7 `scripts/validate-env.js` (modificar)

Hoy: `REQUIRED_VARS` (`:18-29`) es un `Set` de presencia incondicional; las 3 vars caen en
`warnings` (`:76`) y el script sale **0** (`:133`).

Cambio mínimo y aditivo: después de `checkEnv`, una regla condicional —

- si `V2_DELEGATE_TO_A2A` está **no vacío** y falta `WASIAI_A2A_BASE_URL` **o**
  `WASIAI_V2_FORWARD_KEY` ⇒ **error + exit 1**, con el mensaje que nombre CD-1 y diga textualmente
  que el efecto es **500 en toda ruta**, no un 503 acotado (`env.ts:75-86` + `:94`).
- si `V2_DELEGATE_TO_A2A` está vacío ⇒ nota informativa "este ambiente NO delega" (no es error).

**No** se agregan las 3 vars a `REQUIRED_VARS`: haría fallar a todo ambiente que legítimamente no
delega. Y se deja escrito en el docblock que este script **sigue sin saber en qué ambiente corre** —
eso lo contesta el endpoint de AC-5, y decir lo contrario sería el over-claim que abrió esta HU.

### 9.8 Flujo principal (happy path, tras el fix)

1. Un caller hace `POST https://app.wasiai.io/api/v1/compose` con `x-payment-chain: base-sepolia`.
2. `compose/route.ts:19` ⇒ `isDelegated('compose') === true`.
3. `forwardRequest` (`:79-82`) copia los 11 headers de la lista blanca **presentes y no vacíos**,
   incluido `x-payment-chain`, y agrega `x-wasiai-forward-key` + `x-wasiai-source`.
4. El gateway resuelve `resolveChainKey({headerOverride:'base-sepolia'})` (`a2a-key.ts:362` /
   `x402.ts:425`) ⇒ **Base Sepolia**.
5. El caller recibe el challenge/cobro de **la red que pidió**.

### 9.9 Flujo de error

| Caso | Comportamiento |
|---|---|
| header ausente | no se emite (guarda `if (v)`, `:81`) ⇒ el gateway aplica su default y **avisa** (`a2a-key.ts:382`) |
| header con valor `''` | **no se emite** (`if (v)` es falso para `''`) ⇒ igual que ausente. **Es el corazón de CD-3** |
| `x-a2a-contracting-depth: 0` | **sí se emite** (`'0'` es truthy en JS) ⇒ el gateway lee profundidad 0 |
| `x-payment-chain` con slug inválido | llega al gateway ⇒ **400 `CHAIN_NOT_SUPPORTED`** (cambio de comportamiento, DT-3 caso b) |
| `x-a2a-contracting-depth: 99` | llega ⇒ **400 `CONTRACTING_DEPTH_EXCEEDED`** |
| header duplicado | `Headers.get()` los une con `", "`; el gateway lo trata como CSV, que es su semántica declarada (`contracting-guard.test.ts:165-167`). Sin acción |
| gateway caído | el cron reporta `WARN`, **no** `HEADER_WHITELIST_DRIFT` (AC-11) |
| host no declarado | `UNDECLARED_HOST` ⇒ el cron responde 500 (fail-loud) |
| `CRON_SECRET` ausente | el cron responde 500 `CRON_SECRET not configured` (`verifyCronSecret.ts:45-47`) |

---

## 10. Plan de tests (≥ 1 por AC)

| ID | AC | Archivo | Qué verifica | Qué lo haría fallar hoy |
|---|---|---|---|---|
| T-01 | AC-1 | `__tests__/forward-handler.test.ts` | los 2 headers de contracting llegan a `fetch` **con el valor exacto** | hoy falla: no están en la lista |
| T-01b | **AC-1b** | ídem | `x-payment-chain: base-sepolia` llega a `fetch` con el valor exacto | hoy falla |
| T-02 | AC-2 | ídem | sin los 3 headers ⇒ `headers['x-…']` es `undefined`, **no `''`** | pasaría a fallar si alguien cambia `if (v)` por `if (v !== null)` |
| T-02b | AC-2 / CD-3 | ídem | con los 3 en `''` ⇒ **no se emiten** | ídem |
| T-02c | AC-2 | ídem | `x-a2a-contracting-depth: '0'` ⇒ **sí se emite** (`'0'` es truthy) | atrapa a quien "arregle" la guarda con `Number(v)` |
| T-03 | AC-3 | ídem (extiende `:132-146`) | `cookie`, `host`, `origin`, `set-cookie`, `referer`, `x-vercel-id`, `x-middleware-…` **no** se reenvían | |
| T-04 | AC-4 | ídem | `PASSTHROUGH_HEADERS` **igual** al arreglo literal de 11, en orden | cualquier alta/baja rompe la suite |
| T-04b | **AC-4b** | ídem | toda entrada con `consumer !== 'none'` tiene `citation` no vacía **y** `x-api-key` es la **única** con `consumer === 'none'` | agregar un header sin cita rompe |
| T-05 | AC-5 | `status/delegation/__tests__/route.test.ts` | 200 con `environment` + `delegation.runtime` + los 2 booleanos; **`WASIAI_A2A_BASE_URL` y `WASIAI_V2_FORWARD_KEY` no aparecen como valores en ningún lugar del JSON serializado** | |
| T-06 | AC-6 | ídem | dos requests con `Host` distinto ⇒ `environment` **distinto** y `declaredAs` distinto | atrapa un endpoint que ignore el host |
| T-07 | AC-7 | `cron/delegation-drift/__tests__/route.test.ts` | manifiesto `[compose,orchestrate,capabilities]` vs runtime `[compose]` ⇒ **500** con `missing: ['orchestrate','capabilities']` y el `key` del ambiente | |
| T-07b | AC-7 | ídem | host desconocido ⇒ 500 `UNDECLARED_HOST` con el host crudo | |
| T-08 | AC-8 | `scripts/__tests__/smoke-delegation.test.ts` *(sobre las funciones puras del script)* | un 503 `COMPOSE_DISABLED` produce exit ≠ 0 y el mensaje trae **host, endpoint, status, error** | |
| T-08b | AC-8 / DT-6 | ídem | sin argumento de host ⇒ exit **2** | |
| T-09 | **AC-11** | `cron/delegation-drift/__tests__/route.test.ts` | card con `chainHeader` que **no** está en la lista ⇒ 500 `HEADER_WHITELIST_DRIFT` con ese nombre | |
| T-09b | **AC-11** | ídem | `fetch` del card **rechaza** ⇒ `reachable:false` + `WARN` + **200** | atrapa la alarma falsa por gateway caído |
| T-10 | AC-10 | `__tests__/delegation-off.test.ts` (**archivo propio**, DT-9) | `vi.mock('@/lib/env')` con `V2_DELEGATE_TO_A2A: ''` ⇒ `POST /api/v1/compose` responde **503 `COMPOSE_DISABLED`** y `/orchestrate` **503 `ORCHESTRATE_DISABLED`** | es la reversa; hoy **no existe ningún test** que cubra el mundo no-delegado |
| T-11 | DT-5 | `__tests__/forward-handler.test.ts` | `listDelegatedEndpoints()` devuelve el subconjunto correcto y `DELEGATED_ENDPOINT_VALUES` tiene los 4 miembros de la unión | |
| T-12 | §9.2 | `__tests__/delegation-manifest.test.ts` | `resolveDeclaration` normaliza mayúsculas y puerto; host desconocido ⇒ `null`; **ningún `hosts` se repite entre dos ambientes** | dos ambientes con el mismo host romperían AC-6 |

**Verificación externa (no automatizable, va en F4 con host y fecha — CD-7)**: la terna de §3.1 y la
de §3.2 contra `app.wasiai.io`, más la pata de control contra el gateway directo.

---

## 11. Constraint Directives

### Heredadas del work-item (íntegras)

- **CD-1 (PROHIBIDO)** — setear `V2_DELEGATE_TO_A2A` en **cualquier** ambiente donde
  `WASIAI_A2A_BASE_URL` o `WASIAI_V2_FORWARD_KEY` no estén ya presentes y desplegadas.
  Medido: `src/lib/env.ts:75-86` + `:94` ⇒ throw en carga de módulo ⇒ **500 en toda ruta que importe
  `@/lib/env`**, no un 503 acotado.
- **CD-2 (PROHIBIDO)** — reemplazar la lista blanca por un reenvío de `req.headers` completo, o
  agregar un header sin **las tres** condiciones de DT-1 escritas al lado, con el consumidor citado
  en `archivo:línea` de `wasiai-a2a`.
- **CD-3 (PROHIBIDO)** — emitir `x-a2a-contracting-chain`, `x-a2a-contracting-depth` **o
  `x-payment-chain`** con valor vacío. La guarda `if (v)` de `forward-handler.ts:81` **no se toca**.
  Medido: `''` ⇒ `CONTRACTING_DEPTH_MALFORMED` (`contracting-chain.ts:822-825`) y ⇒
  `400 CHAIN_NOT_SUPPORTED` (`chain-resolver.ts:422` + `a2a-key.ts:365-370`). Convierte peticiones
  que hoy funcionan en 400. *(Extendida a `x-payment-chain` por §0.1.)*
- **CD-4 (OBLIGATORIO)** — el endpoint de estado y el cron consumen el **mismo símbolo** que consumen
  las rutas (`isDelegated` vía `listDelegatedEndpoints`), **sin releer `process.env`** para el
  conjunto delegado.
- **CD-5 (PROHIBIDO)** — escribir o desplegar cualquier cambio en el repo `wasiai-a2a` desde esta HU,
  incluida la edición de su `CLAUDE.md` y de su Agent Card (acciones A-1 / A-3).
- **CD-6 (OBLIGATORIO)** — toda afirmación sobre un ambiente —en el SDD, en el AR, en el CR, en F4 y
  en el done-report— nombra **el proyecto Vercel y el dominio**. "Producción" a secas queda
  prohibido en los artefactos de esta HU.
- **CD-7 (PROHIBIDO)** — que el done-report afirme que los headers llegan sin pegar **la terna
  completa** (`con header` / `sin header` / `gateway directo`) contra un host nombrado y con fecha.
  Un `200 OK` **no** distingue "llegó" de "no llegó". *(Extendida: la terna de `x-payment-chain` de
  §3.2 es obligatoria además de la de contracting.)*

### Nuevas de este SDD

- **CD-8 (PROHIBIDO)** — que `src/lib/proxy/delegation-manifest.ts` o
  `src/lib/proxy/passthrough-headers.ts` importen `server-only`, `@/lib/env`, o hagan I/O. Motivo
  medido: `doc/sdd/076-…/auto-blindaje.md` — `import 'server-only'` en el grafo de un test lo hace
  **fallar al colectar** bajo vitest.
- **CD-9 (PROHIBIDO)** — modificar el campo `delegated` del manifiesto para que coincida con lo
  observado en runtime y así callar al cron. `hosts` es descriptivo y se corrige con medición;
  `delegated` es la intención y sólo cambia por decisión explícita, documentada en el PR.
- **CD-10 (PROHIBIDO)** — que el cron trate un Agent Card inalcanzable como divergencia de la lista
  blanca. Gateway caído ⇒ `WARN`, jamás `HEADER_WHITELIST_DRIFT`.
- **CD-11 (PROHIBIDO)** — que el endpoint de AC-5 devuelva el **valor** (o la longitud) de
  `WASIAI_A2A_BASE_URL` o `WASIAI_V2_FORWARD_KEY`, o que se sirva sin `Cache-Control: no-store`.
- **CD-12 (PROHIBIDO)** — tocar `x-api-key` en esta HU: ni sacarlo de la lista, ni cambiar las dos
  pantallas. Su estado de alias muerto se **documenta** (DT-8) y se resuelve en A-5.
- **CD-13 (OBLIGATORIO — lección de `075` y `074`)** — correr `npm test` **completo** antes de cerrar
  cada wave, no sólo los tests nombrados acá; y antes de agregar un parámetro a cualquier función ya
  mockeada, `git grep "toHaveBeenCalledWith\|toHaveBeenNthCalledWith"` y contar argumentos.

### OBLIGATORIO seguir (patrones)

- Módulos puros para el manifiesto y la lista (exemplar: `src/lib/contracts/marketplaceAddressCoherence.ts`).
- `verifyCronAuth` como primera línea de la ruta de cron (exemplar: `cron/reconcile-onchain/route.ts:13-16`).
- `Record<Union, true>` exhaustivo para la lista de endpoints (exemplar verificado:
  `wasiai-a2a/src/adapters/chain-resolver.ts:118-127`).
- TypeScript strict, sin `any` explícito. Sin dependencias nuevas: el smoke usa `fetch` de Node 20+
  (`package.json:5-7`).

---

## 12. Riesgos, despliegue y reversa

### 12.1 Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R-1 | Un caller que hoy manda `x-payment-chain` con slug inválido pasa de 402 a **400** (DT-3 b) | Media | Medio | disparador de reversa DT-3-R + ventana de 60 min + A-4 |
| R-2 | Un caller pasa a **403 `INSUFFICIENT_BUDGET`** en la red que pidió (DT-3 c) | Media | Medio | ídem. Es el comportamiento correcto: antes le cobraban en otra red |
| R-3 | El Preview de `wasiai-prod` **no** delega ⇒ el primer testigo es `app.wasiai.io` | Media | Medio | declarado en DT-2; promoción manual (`CLAUDE.md:23`) + Instant Rollback sobre cambio de **código** |
| R-4 | El 5.º cron no se registra en Vercel ⇒ **AC-7 falla en silencio** | Media | Alto | verificación obligatoria en el dashboard (§9.5) + smoke como backstop + declararlo en el done-report |
| R-5 | Sin `SENTRY_DSN`, el canal Sentry es no-op | Alta | Bajo | DT-6: el canal primario es el 500 del cron, que no depende de ninguna env |
| R-6 | El card-diff no cubre `x-payment-chain` (no está declarado) | **Cierta** | Medio | declarado en DT-7 con su cobertura exacta + A-3 |
| R-7 | Un test nuevo rompe mocks existentes por firma cambiada | Media | Bajo | CD-13 (lección de `074`/`075`) |
| R-8 | `import 'server-only'` arrastrado al grafo de un test | Media | Medio | CD-8 (lección de `076`) |

### 12.2 Despliegue y reversa

**Es un cambio de código, no de env.** `NC-3` resuelto: **`wasiai-prod` no auto-despliega en push**
(`CLAUDE.md:20-23`, confirmado con `vercel ls wasiai-prod`). O sea: **mergear esta HU no publica
nada sobre `app.wasiai.io`.**

| # | Acción | Efecto | Verificación |
|---|---|---|---|
| 1 | push de la branch | crea **Preview** en `wasiai-prod`; `wasiai-v2` (staging) se actualiza | — |
| 2 | **W3.1** — sondear el Preview (DT-2) | decide quién es el primer testigo | `POST <preview>/api/v1/compose {"steps":[]}` |
| 3 | si el Preview delega: terna completa contra el Preview | AC-1 / AC-1b verificados **fuera** del camino de dinero | §3.1 + §3.2 |
| 4 | merge a `main` | staging (`wasiai-v2.vercel.app`) sigue en 503 — **esperado**, no es incidente | AC-10 |
| 5 | **Redeploy manual de `wasiai-prod`** (`CLAUDE.md:22`) | los 3 headers empiezan a atravesar | **las dos ternas** contra `app.wasiai.io` + `smoke:delegation app.wasiai.io` |
| 6 | ventana de 60 min (DT-3-R) | detectar R-1/R-2 | logs de Railway del gateway (**A-4**, fuera de este repo) |

**Reversa del código**: revertir el commit + redeploy, o **Instant Rollback** de Vercel sobre
`wasiai-prod`. Vuelve exactamente al comportamiento de hoy: los 3 headers se descartan.
⚠️ `DELEGATED` se congela en carga de módulo (`forward-handler.ts:59`): **ninguna reversa es
instantánea sobre lambdas tibias**. El rollback de esta HU es de código, así que no depende de ese
congelamiento — pero cualquier reversa que pase por env sí, y hay que esperar el reciclado.

**Orden de apagado de una delegación** (si alguna vez hace falta): **primero el flag, después las
vars**. Es el inverso exacto del encendido. Borrar las vars dejando el flag es CD-1 al revés y tira
el ambiente entero con 500.

---

## 13. Hallazgos fuera de scope y acciones declaradas (NO ejecutadas acá)

- **H-1 — los headers de *respuesta* del gateway también se pierden.** `forwardRequest` devuelve
  **sólo** `content-type` (`:126-129`, y el branch 402 en `:107-112`). El gateway emite
  `x-a2a-payment-chain` (`wasiai-a2a/src/middleware/x402.ts:55`, seteado en `a2a-key.ts:404`) y
  `x-a2a-remaining-budget` (`a2a-key.ts:862`, `:1089`, `:1332`). Un caller que pasa por el
  marketplace **no puede leer en qué red se le cobró ni cuánto saldo le queda**. Es el espejo exacto
  de este bug, del lado de la respuesta. **HU aparte**: necesita su propia lista blanca de salida
  (para no reenviar `set-cookie` del upstream).
- **H-2 — el `resource` del challenge x402 que llega vía `app.wasiai.io` es la URL de Railway**
  (`https://wasiai-a2a-production.up.railway.app/compose`, medido en §3.2). Observado, sin acción en
  esta HU.
- **A-1 — `wasiai-a2a/CLAUDE.md`**: la afirmación *"PROD CUTOVER COMPLETO"* **es cierta** y aun así
  produjo un diagnóstico equivocado, porque no nombra el ambiente ni deja forma de verificarlo.
  Reemplazo propuesto: puntero al endpoint de AC-5 + dominio (`app.wasiai.io`) + fecha de última
  verificación.
- **A-2 — `.nexus/project-context.md` de este repo** (fechado 2026-03-20): `:206` describe un
  `/api/v1/compose` que WKH-66 borró de este repo, y `:265` ("Auto-deploy on push to `main`")
  **contradice** `CLAUDE.md:20-23`. **Gana `CLAUDE.md`** (`NC-3` medido). Este SDD lo **declara y no
  lo edita**.
- **A-3 — pedirle a `wasiai-a2a`** que publique en su Agent Card el set completo de headers inbound
  que honra (hoy declara 2; `x-payment-chain` no está). Sin eso, el mecanismo de DT-7 cubre un
  subconjunto y hay que decirlo.
- **A-3b — agregar el ambiente a `x-wasiai-source`** (`forward-handler.ts:77` emite el literal
  `'v2-proxy'`): hoy el gateway no puede distinguir qué proyecto Vercel lo llamó
  (`forward-key.ts:87-99` sólo loguea ese string). Sin efecto de auth (`:87`), así que es seguro —
  pero no tiene AC en esta HU.
- **A-4 — observar los logs de Railway del gateway** durante los 60 min posteriores a la promoción
  (DT-3-R). Fuera de este repo.
- **A-5 — HU nueva: migrar `DemoPageClient.tsx:93` y `PipelinePageClient.tsx:84` de `x-api-key` a
  `x-a2a-key`**, con selección de red y copy de error. **Desbloqueada por esta HU** (DT-8).
- **NC-6 (heredado, fuera de repo)** — `A2A_SELF_HOSTS` / `BASE_URL` en el Railway del gateway.
  `GET /health` publica `contractingGuard.selfHostCount`. Esta HU arregla la **capa 2**; si
  `selfHostCount` es 0, la capa 1 sigue dependiendo del `Host` entrante.

---

## 14. Missing Inputs y Uncertainty Markers

| Marker | Sección | Descripción | ¿Bloqueante? |
|---|---|---|---|
| `[TBD-1]` | DT-2 / §9.2 | ¿El Preview de `wasiai-prod` delega? Instrumento y ramas escritos en DT-2 | **No** — se resuelve en W3.1, no bloquea W0/W1/W2, y **las dos ramas tienen plan** |
| `[TBD-2]` | §9.5 | ¿Vercel acepta el 5.º cron en `wasiai-prod`? | **No** — verificación obligatoria en W2 + backstop declarado (R-4) |
| `[TBD-3]` | §9.2 | ¿El `Host` con que Vercel invoca el cron está en la lista de `hosts`? | **No** — si no, el cron grita `UNDECLARED_HOST` (fail-loud), y el host se agrega **con evidencia** (CD-9) |

**No hay `[NEEDS CLARIFICATION]`.** `NC-1`, `NC-2`, `NC-3`, `NC-4` y `NC-5` quedaron resueltos con
medición (§0). `NC-6` es fuera de repo y no bloquea.

---

## 15. Readiness Check

```
READINESS CHECK — SDD #077
[x] Cada AC tiene al menos 1 archivo asociado (§8.1) y al menos 1 test (§10)
    AC-1 T-01 · AC-1b T-01b · AC-2 T-02/02b/02c · AC-3 T-03 · AC-4 T-04 · AC-4b T-04b
    AC-5 T-05 · AC-6 T-06 · AC-7 T-07/07b · AC-8 T-08/08b · AC-10 T-10 · AC-11 T-09/09b
    (AC-9 eliminado por DT-2(B+), con motivo escrito)
[x] Cada archivo de §8.1 tiene un Exemplar verificado (§4.3, todos abiertos con Read/git grep hoy)
[x] No hay [NEEDS CLARIFICATION]; los 3 [TBD] son no bloqueantes y traen las dos ramas escritas
[x] Constraint Directives: 13 (7 heredadas + 6 nuevas), 11 de ellas PROHIBIDO
[x] Context Map: 19 archivos de wasiai-v2 + 7 de wasiai-a2a + 1 endpoint vivo
[x] Scope IN y OUT explícitos, con la decisión de las dos pantallas resuelta (DT-8), no diferida
[x] Sin cambios de BD
[x] Happy path completo (§9.8)
[x] Flujo de error: 9 casos (§9.9)
[x] Reversa escrita, y el hazard del congelamiento en carga de módulo declarado (§12.2)
[x] CD-6 respetada: no aparece "producción" a secas — siempre proyecto Vercel + dominio
[x] Auto-blindaje histórico aplicado: 076 (server-only → CD-8), 075 (suite completa → CD-13),
    074 (toHaveBeenCalledWith → CD-13)
[x] Toda afirmación de §3 es falsable, y su falsador está escrito al lado
```

---

*SDD generado por NexusAgil — F2 · Architect · 2026-08-18*
