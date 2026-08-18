# F4 — Validación · [WKH-361] Los headers del camino del dinero no atraviesan el proxy de v2

> Repo: `wasiai-v2` · rama **`feat/077-headers-proxy`** · `HEAD = 349e9c8eb` · base `main = b55871347`
> Fecha: 2026-08-18 · Fase: F4 (QA) · Modo: QUALITY
> ⚠️ **CD-6 aplicada en todo este documento**: nunca "producción" a secas. Siempre proyecto Vercel +
> dominio — `wasiai-prod` / `app.wasiai.io` (ambiente de dinero vivo) y `wasiai-v2` /
> `wasiai-v2.vercel.app` (staging).

---

## VEREDICTO: **APROBADO** para merge a `main` de `wasiai-v2` — **sin desplegar**

**0 ACs en FALLA. 0 gates en rojo. 0 scope creep.** Los 13 ACs vivos (10 del work-item rev. 2 + 3
que el SDD agregó) tienen implementación y test con cita `archivo:línea`.

Lo que **no** cierra hoy y no puede cerrar: la *evidencia exigida* de **AC-1** y **AC-1b** es una
medición contra un host desplegado, y la rama **no está desplegada en ningún ambiente** — medido, no
supuesto: `GET /api/v1/status/delegation` devuelve **404 en los dos dominios**. Eso es lo esperado y
está declarado en el plan (`story-file.md:1018-1031`); no es un hallazgo en contra.

Salen **8 pendientes** con dueño (§7). **Dos de ellos cambian el runbook de despliegue y se
descubrieron acá, midiendo**: el Preview de `wasiai-prod` está detrás de Deployment Protection (⇒ el
instrumento de `[TBD-1]` no puede dar ninguna de sus dos ramas), y el paso 5 del smoke **sí admite un
falso OK** en el caso asimétrico, al revés de lo que el dev midió.

---

## 1. Gates — re-derivados por mí (no leídos del CR)

| Gate | Comando | Resultado **medido hoy** | Exit |
|---|---|---|---|
| Tests | `npx vitest run --reporter=json --outputFile=…` | **Test Files 89** · **819 tests: 814 passed, 0 failed, 5 pending** · `success: true` | 0 |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | sin salida | **0** |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) | sin salida | **0** |
| Build | `npm run build` (`next build`, Turbopack) | `✓ Compiled successfully`; **las dos rutas nuevas construidas**: `ƒ /api/cron/delegation-drift`, `ƒ /api/v1/status/delegation` | **0** |

Coinciden con los números que traía el expediente. **Uno no coincide y es del propio expediente**:
`story-file.md:1163-1166` declara el contador de cierre en **`802 → 812`** y la realidad es **819**
(ver `DRIFT-3`).

⚠️ **El contador del JSON es el instrumento, no el stdout.** Bajo el hook de `rtk`, el stdout de
vitest quedó en **399 bytes** (`PASS (814) FAIL (0)`): el número sobrevive, el detalle no. Todo lo que
cito de la suite sale del `--outputFile`, que lo escribe vitest y no pasa por el filtro.

---

## 2. Verificación de ACs — con evidencia `archivo:línea`

Tres estados, y la diferencia importa:
**PASS** = cerrado con lo que hay en el repo · **PASS-CÓDIGO** = implementación y test verdes, pero la
evidencia que el propio AC exige es una medición contra un host desplegado · **N/A** = eliminado con
motivo escrito.

| AC | Estado | Evidencia (`archivo:línea`) | Nota |
|---|---|---|---|
| **AC-1** — los 2 headers de contracting atraviesan, con el valor sin modificar | **PASS-CÓDIGO** | `src/lib/proxy/passthrough-headers.ts:136-147` (entradas 9 y 10) → `src/lib/proxy/forward-handler.ts:134-137` (bucle de copia). Tests: `src/lib/proxy/__tests__/forward-handler.test.ts:184` (T-01) y `src/app/api/v1/compose/__tests__/proxy-headers.test.ts:63` — este último atraviesa `route → new NextRequest → forwardRequest → fetch` **sin mockear `forwardRequest`**, o sea mide el eslabón, no la intención | La *evidencia exigida* (terna viva) NO cierra hasta la promoción de `wasiai-prod`. Medido hoy (§3): sigue rota, como corresponde |
| **AC-1b** *(agregado por el SDD, `sdd.md:31`)* — `x-payment-chain` atraviesa | **PASS-CÓDIGO** | `passthrough-headers.ts:148-155`; tests `forward-handler.test.ts:198` (T-01b) + `proxy-headers.test.ts:63` | ídem. Es el que cuesta plata |
| **AC-2** — header ausente NO se emite, ni vacío | **PASS** | La guarda `if (v)` **intacta** en `forward-handler.ts:136`. Tests: `forward-handler.test.ts:211` (T-02, `undefined` y no `''`), `:235` (T-02b, los 3 en `''` no se emiten), `:251` (T-02c, `'0'` **sí** se emite); `proxy-headers.test.ts:115` y `:122` | Cerrado sin desplegar |
| **AC-3** — sólo lista blanca; nunca `cookie` | **PASS** | `forward-handler.ts:128-137` construye el objeto desde cero (no clona `req.headers`). Tests: `forward-handler.test.ts:156` (T-03: `host`/`origin`/`cookie`/`set-cookie`/`referer`/`x-vercel-*`/`x-middleware-*`) y `proxy-headers.test.ts:96` (la cookie de sesión no cruza el borde) | Cerrado |
| **AC-4** — la suite falla si la lista cambia sin actualizar el test | **PASS** | `passthrough-headers.ts:84-156` (11 entradas) + `:163-165` (derivación). Tests: `forward-handler.test.ts:373` (literal de 11 **en orden**), `:391` (deriva de `PASSTHROUGH_HEADER_ENTRIES`), `:395` (minúsculas, sin repetidos) | Cerrado |
| **AC-4b** *(agregado por el SDD)* — toda entrada cita su lector | **PASS** | `forward-handler.test.ts:402` y `:413`. `x-api-key` es la única con `consumer:'none'` / `citation:null` (`passthrough-headers.ts:103-111`) | **Verifiqué la cita yo**: en todo `wasiai-a2a/src/` `x-api-key` aparece **una** vez, y es un fixture (`src/services/registry.redaction.test.ts:319`) |
| **AC-5** — endpoint de estado: ambiente + delegados + 2 booleanos, sin valores | **PASS-CÓDIGO** | `src/app/api/v1/status/delegation/route.ts:76-118`: (a) `:93-99`; (b) `:81` vía `listDelegatedEndpoints()` (`forward-handler.ts:113-115`) — **no** relee `process.env` (CD-4); (c) `:105-109` vía `isA2aBaseUrlConfigured`/`isForwardKeyConfigured` (`forward-handler.ts:37-50`, **el mismo predicado que usa el proxy**). Tests `route.test.ts:77`, `:102` (el valor mockeado no aparece en `JSON.stringify`), `:124`, `:133` (`no-store`), `:138`, `:145` | **404 vivo en los dos dominios** (§3) ⇒ no cierra sin desplegar |
| **AC-6** — dos ambientes ⇒ identificadores distintos | **PASS-CÓDIGO** | `route.ts:77-79` + `:98` (`declaredAs`) + `delegation-manifest.ts:113-119` (match exacto, sin comodines). Tests `route.test.ts:170` y `:211`; invariante "ningún host repetido entre ambientes" en `delegation-manifest.test.ts:77` | **Límite declarado**: el test simula dos ambientes variando el `Host` en un proceso. Que `deploymentId`/`vercelEnv` difieran de verdad sólo se mide con los dos desplegados |
| **AC-7** — drift manifiesto↔runtime ⇒ señal observable sin intervención | **PASS-CÓDIGO** | `src/app/api/cron/delegation-drift/route.ts:128-145` (diff como conjunto) + `:186-205` (500 + `logger.error` con el body completo + Sentry best-effort). Manifiesto `delegation-manifest.ts:56-82`. Tests `route.test.ts:142` (T-07: nombra ambiente y cada endpoint), `:165` (`unexpected`), `:180` (MATCH), `:197` (T-07b `UNDECLARED_HOST`) | **Corroboración runtime del manifiesto, medida por mí** (§3.3): lo declarado en `:63` y `:76` coincide con lo que sirve cada dominio hoy. Falta el disparador: `[TBD-2]`/`[TBD-3]`/`[TBD-4]` |
| **AC-8** — smoke: `503 *_DISABLED` ⇒ exit≠0 imprimiendo ambiente, endpoint, status y `error` | **PASS** | `scripts/smoke-delegation.mjs:204-225` (`evaluateDisabled` devuelve los cuatro campos) + `:592-617` (paso 2) + `:471-507` (`decideVerdict`). Tests `smoke-delegation.test.ts:140` (T-08) y `:104` (T-08b) | **Ejecutado en vivo por mí**: `npm run smoke:delegation` (sin host) ⇒ **exit 2** + `USAGE` impreso. El 503 se cubre por test |
| **AC-9** | **N/A — eliminado** | `story-file.md:175-177`: bajo DT-2(B+) su premisa ("cuando staging tenga las tres variables") nunca se cumple; un AC con premisa falsa se aprueba solo | Trazado, no silenciado |
| **AC-10** — sin `V2_DELEGATE_TO_A2A` ⇒ 503, o sea la reversa devuelve el comportamiento previo | **PASS (completo, incluida la pata viva)** | `src/app/api/v1/compose/route.ts:18-27` (sin cambios en esta HU). Tests `delegation-off.test.ts:44`, `:52`, `:61`, `:70` (el 503 se decide **antes** de tocar la red) | **Medido hoy en `wasiai-v2` / `wasiai-v2.vercel.app`**: `/compose` ⇒ `503 {"error":"COMPOSE_DISABLED"}`, `/orchestrate` ⇒ `503 {"error":"ORCHESTRATE_DISABLED"}`. **Único AC cerrable end-to-end sin desplegar** |
| **AC-11** *(agregado por el SDD)* — card-diff, y card inalcanzable ⇒ advertencia, no divergencia | **PASS-CÓDIGO** | `route.ts:72-116` (`fetchAgentCardHeaders`, nunca lanza) + `:147-157` (CD-10: `!reachable ⇒ WARN`). Tests `route.test.ts:214` (T-09), `:236`, `:254` (T-09b), `:273`, `:287`, `:299` | **Corroborado contra el card vivo** (§3.4): declara exactamente 2 headers, los dos ya en la lista ⇒ el cron dará MATCH |

**Ningún AC en FALLA.** Los que dicen PASS-CÓDIGO no están a medias: les falta el testigo que el
propio AC pide y que sólo existe después de la promoción.

---

## 3. Runtime — lo que sólo se ve mirando el sistema corriendo

Todas las mediciones: **2026-08-18**, desde este entorno. Ninguna mueve fondos (cortan en 400/402;
el 402 es el challenge x402).

### 3.1 El defecto sigue vivo en `wasiai-prod` / `app.wasiai.io` — re-derivado, no heredado

```
1 GATEWAY (wasiai-a2a-production.up.railway.app/compose)  x-payment-chain: base-sepolia
  -> 402  accepts[0].network = eip155:84532   maxAmountRequired = 1010                 asset = 0x036CbD53842c5426634e7929541eC2318f3dCF7e
2 app.wasiai.io /api/v1/compose                            x-payment-chain: base-sepolia
  -> 402  accepts[0].network = eip155:2368    maxAmountRequired = 1010000000000000     asset = 0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9
3 app.wasiai.io /api/v1/compose                            SIN header
  -> 402  accepts[0].network = eip155:2368    maxAmountRequired = 1010000000000000     asset = 0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9

comparación de accepts[0] completo:  (2) == (3)  ->  true
```

```
4 GATEWAY        x-a2a-contracting-depth: 99 -> 400 {"error_code":"CONTRACTING_DEPTH_EXCEEDED", …"La peticion se rechaza sin cobrar."}
5 app.wasiai.io  x-a2a-contracting-depth: 99 -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"c61c7833-…"}
   (5) contiene CONTRACTING_DEPTH_EXCEEDED -> false
```

**Las dos ternas siguen exactamente como las midió F1/F2.** Es lo correcto: la rama no está
desplegada. Sirve de línea base para el paso 5 del runbook.

### 3.2 La rama NO está desplegada en ningún ambiente — medido, no inferido

```
GET https://app.wasiai.io/api/v1/status/delegation        -> 404 (HTML 404 de Next)
GET https://wasiai-v2.vercel.app/api/v1/status/delegation -> 404 (HTML 404 de Next)
```

Ese 404 es el discriminador limpio: el endpoint lo **estrena** esta HU. Mientras dé 404, ningún AC
del Grupo B se puede cerrar en vivo — y el propio smoke lo dice con la causa correcta
(`smoke-delegation.mjs:545-556`).

`vercel ls wasiai-prod` (re-derivación del `[NC-3]`): los 3 despliegues más recientes (2 d) son
**Preview**; el `Production` más nuevo tiene **4 d**. ⇒ **mergear a `main` no publica nada sobre
`app.wasiai.io`.** La promoción sigue siendo un acto manual y deliberado.

### 3.3 El manifiesto contra la realidad de cada dominio (corrobora AC-7)

| Dominio | `capabilities` sirve | Rama | Manifiesto declara |
|---|---|---|---|
| `app.wasiai.io` | `agents,catalogStatus,excluded,registries,sources,total,totalAtLeast` | **delegada** | `['capabilities','compose','orchestrate']` (`delegation-manifest.ts:63`) ✅ |
| `wasiai-v2.vercel.app` | `agents,next_cursor,total` | **legacy** + 503 en compose/orchestrate | `[]` (`delegation-manifest.ts:76`) ✅ |

⚠️ **Qué mide y qué NO**: mide que la **conducta observable** de cada dominio coincide con el
`delegated` declarado. **No** mide `V2_DELEGATE_TO_A2A` (no la puedo leer en `wasiai-prod`), y el cron
compara contra `listDelegatedEndpoints()`, que sale de esa var. Son dos cosas consistentes, no la
misma.

### 3.4 El Agent Card vivo (corrobora AC-11 y el residual DT-7)

```
GET https://wasiai-a2a-production.up.railway.app/.well-known/agent.json -> 200
contracting = {"depthMax":2,"chainHeader":"x-a2a-contracting-chain","depthHeader":"x-a2a-contracting-depth","bestEffortNote":"…"}
únicos strings con forma  x-…  en TODO el card: "x-a2a-contracting-chain" "x-a2a-contracting-depth"
'x-payment-chain' presente en el card crudo: false
```

Tres consecuencias, las tres como el expediente las declara: (a) el card-diff dará **MATCH** el
primer día; (b) **DT-7 es cierto**: `x-payment-chain` no está en el card ⇒ ese mecanismo **no** lo
habría cazado; (c) `depthMax: 2` confirma la fila 3 del radio de impacto — `depth: 2`, un valor
normal, pasa de funcionar a `400`.

### 3.5 Paso 0 del runbook, ejecutado: el gateway **sí** monta `forward-key`

```
POST <gateway>/compose  x-wasiai-forward-key: <clave inválida>  -> 401 {"error":"Invalid forward key","error_code":"INVALID_FORWARD_KEY"}
control: SIN el header                                          -> 402 (challenge; la ausencia es passthrough, como declara AC-4)
```

⇒ `WASIAI_V2_FORWARD_KEY` está presente y ≥16 chars en el Railway del gateway
(`wasiai-a2a/src/middleware/forward-key.ts:72-81`) ⇒ **la línea `forward-key source` existirá** y el
método #1 de atribución del disparador de reversa está vivo. Es la precondición de toda la §13 y hoy
se cumple. *(El control da 402 y no el `400 VALIDATION_ERROR` de `story-file.md:1025` porque usé el
body con agente y no `{"steps":[]}`: distinto body, no una contradicción. Lo que el control prueba —
que sin header no hay 401 — se cumple igual.)*

### 3.6 Paridad de env en `wasiai-v2` / `wasiai-v2.vercel.app` (`vercel env ls`, sólo nombres)

| Var | `Production` | `Preview` | Consecuencia |
|---|---|---|---|
| `V2_DELEGATE_TO_A2A`, `WASIAI_A2A_BASE_URL`, `WASIAI_V2_FORWARD_KEY` | **0 coincidencias** | **0** | staging no delega — coherente con DT-2(B+) y con el 503 medido. **CD-1 no está en riesgo acá** |
| `CRON_SECRET` | **presente** | **presente** | el cron de staging **no** va a fallar por auth: va a correr y comparar. Cierra el 4.º renglón de `[TBD-4]` |
| `SENTRY_DSN` | **0 coincidencias** | **0** | **DT-6 confirmado con medición**: en `wasiai-v2` el canal 3 es un no-op silencioso. El canal primario (el 500) es el único que existe ahí |

**No pude medir lo mismo en `wasiai-prod`**: para eso hace falta enlazar ese proyecto, y el intento
quedó **bloqueado por el sistema de permisos** de este entorno. Queda como pendiente con instrumento
escrito (§7, `P-3`).

---

## 4. Hallazgos de esta fase

### `F4-1` (MENOR-ALTO — arreglar **antes de la promoción**, no antes del merge) · El paso 5 del smoke SÍ admite un falso OK

El dev declaró la pata suelta y la midió: *"con 429 en las dos, sale `INSTRUMENTO ROTO` ⇒ exit 1, o
sea acusación ruidosa, no falso OK"*. **Reproduje su medición y es cierta. También reproduje el caso
que no midió, y ahí el resultado se da vuelta.**

`scripts/smoke-delegation.mjs:727-759` es el único paso que **no** pasa por
`evaluateStepPrecondition` en **ninguna** de sus dos patas (los pasos 2, 3, 4 y 4b sí — `:606`,
`:631`, `:641`, `:668`, `:681`, `:713`).

Medido con stubs, sin red, contra el código de `349e9c8eb`:

| Escenario | Salida del paso 5 | Exit |
|---|---|---|
| **A** — las dos patas del gateway en `429` *(lo que el dev midió)* | `paso 5 (control, gateway …) ⇒ INSTRUMENTO ROTO: … no trae un bloque accepts[0]` | **1** ✅ |
| **B** — 1.ª pata medible (`402` con `eip155:84532`), **2.ª pata (control) en `429`** | **`paso 5 OK: el gateway directo (…) discrimina la red`** | **0** ❌ |
| **C** — B + host completamente medible (pasos 2/3/4/4b en OK) | `paso 5 OK` + **`SMOKE OK`** a secas, sin una sola línea diciendo que la pata de control nunca llegó al gateway | **0** ❌ |

**Por qué pasa**: `evaluatePaymentChainTerna` (`:417-443`) da `null` si `withAccept !== withoutAccept`
y `withAccept` contiene la red esperada. Un `429` en el control hace `withoutAccept = null` ⇒ **la
diferencia la fabrica el fallo**, no la discriminación.

**Es exactamente el defecto de `MNR-CR-1`**, que el fix-pack cerró en los pasos 3 y 4 y no en el 5 —
y el propio código lo dice en `:678-680`: *"el día que el default del gateway sea `base-sepolia`, la
ÚNICA cosa que distingue 'el header atravesó' de 'no atravesó' es esta 2.ª pata"*. Hoy el default es
`eip155:2368` (§3.1), así que el `includes` de la 1.ª pata todavía discrimina solo: **el radio real
hoy es que el operador cree validado un control que no se ejecutó**, no una conclusión falsa sobre el
camino del dinero. Por eso no bloquea el merge.

**Corrección**: pasar las dos respuestas del paso 5 por `evaluateStepPrecondition` con
`STEP_CONTROL_LEG(5)`, igual que 3 y 4. Es el mismo patrón, ya escrito y ya testeado.
**No hay test que cubra las patas del paso 5**: `smoke-delegation.test.ts:668` (`MNR-CR-1`) sólo
ejercita los pasos 3 y 4 (`:765-766`, `:770`, `:785`).

### `F4-2` (MEDIO para el runbook, descubierto midiendo) · El instrumento de `[TBD-1]` no puede dar ninguna de sus dos ramas

`story-file.md:851-862` resuelve `[TBD-1]` con `POST https://<preview-url-de-wasiai-prod>/api/v1/compose`
y dos ramas: `VALIDATION_ERROR` ⇒ delega; `503 COMPOSE_DISABLED` ⇒ no delega.

Medido contra los Previews **existentes** de `wasiai-prod`:

```
POST https://wasiai-prod-qxcym047k-….vercel.app/api/v1/compose
  -> 401 {"error":{"message":"Protected deployment","code":"401"},"protection":{"vercel_auth_callback":"https://vercel.com/sso-api?…"}}
GET  https://wasiai-prod-la66nyjzr-….vercel.app/api/v1/capabilities  -> 200, pero el cuerpo es la página SSO de Vercel
GET  https://wasiai-prod-jr73e1w07-….vercel.app/api/v1/capabilities  -> 200, ídem
```

**Los Previews de `wasiai-prod` están detrás de Deployment Protection.** El resultado no es ninguna
de las dos ramas ⇒ cae la Escalation Rule del propio story file (`:1203`: *"Cualquier `[TBD]` de §11
que dé un resultado que no es ninguna de sus dos ramas"*).

Consecuencia concreta sobre `story-file.md:1026-1028` (pasos 1-3 del despliegue): **el paso 2 no se
puede ejecutar con un `curl` pelado**, y el paso 3 ("si el Preview delega: las dos ternas contra el
Preview") tampoco. Quedan tres salidas, y hay que **elegir una explícitamente**, no descubrirla el
día del cutover:
1. usar `x-vercel-protection-bypass` (Protection Bypass for Automation) en las tres sondas;
2. desactivar la protección para ese Preview mientras dure la verificación;
3. **aceptar la rama 2 de `[TBD-1]`**: el primer testigo de AC-1/AC-1b es `app.wasiai.io`, o sea el
   camino del dinero — que es una salida ya escrita y ya justificada (`story-file.md:862`), pero hay
   que **decidirla**, no caer en ella.

### `F4-3` (MENOR) · Dos de los cinco `[TBD]` no declaran qué **no** los mide

Se pidió verificar que cada `[TBD]` declare su instrumento **y** su contra-instrumento. Estado real:

| `[TBD]` | ¿Instrumento? | ¿Qué NO lo mide? | Veredicto |
|---|---|---|---|
| `[TBD-1]` (`:851-862`) | sí | **NO** | ⚠️ y encima el instrumento no funciona (`F4-2`). Le falta justo la negativa que esta HU existe para enseñar: *"un Preview del proyecto `wasiai-v2` no contesta esta pregunta"* — medir el proyecto Vercel equivocado es el error que abrió la HU |
| `[TBD-2]` (`:864-874`) | sí (dashboard → Cron Jobs) | **NO** | ⚠️ falta decir que **invocar el cron a mano con `curl` y ver 200 no prueba que Vercel lo haya registrado**. `[TBD-3]` sí lo dice, para su propia pregunta; acá queda implícito |
| `[TBD-3]` (`:876-921`) | sí | **SÍ**, explícito y con el bloque ⛔ *"Lo que NO mide esto"* (`:890-898`) | ✅ ejemplar |
| `[TBD-4]` (`:923-953`) | sí | **SÍ**, por referencia (`:938`: "NO con `curl`, por la misma razón de `[TBD-3]`") | ✅ · y su 4.º renglón **queda cerrado por §3.6**: `CRON_SECRET` está presente en `wasiai-v2` |
| `[TBD-5]` (`:955-987`) | sí | **SÍ**, explícito (`:985-987`: cronometrar una corrida sana no mide el caso del gateway colgado) | ✅ |

**3 de 5 honestos, 2 incompletos.** Ninguno inventa una medición ni da por resuelto lo que no midió:
los cinco dicen "declarado, NO implementado" o "verificación obligatoria", y `[TBD-4]`/`[TBD-5]`
nombran su origen (`cr-report.md:310-329` y `:331-347`) en vez de presentarse como propios.

### `F4-4` (MENOR) · CD-6 al pie de la letra: una ocurrencia

`src/lib/proxy/__tests__/validate-env-delegation.test.ts:16` — *"las semánticas que Node usa en
producción"*. Es la **única** en todo el código, comentarios, tests y mensajes de commit de la rama
(barrido sobre `src/lib/proxy/`, `src/app/api/v1/status/`, `src/app/api/cron/delegation-drift/`,
`scripts/smoke-delegation.mjs`, `scripts/validate-env.js`, `.env.example` y los 23 subjects de
commit). **Riesgo semántico: cero** — habla del runtime de Node, no de un ambiente Vercel. Lo dejo
anotado porque CD-6 está escrita como prohibición literal (`story-file.md:534`), no como criterio.

---

## 5. Drift Detection

**Scope: limpio.** Los **24** archivos de `git diff --name-only b55871347..HEAD` están **todos** en la
tabla de `story-file.md:186-205` (§4, 18 filas) + §4.b (fix-pack AR, 11 filas) + §4.c (fix-pack it.2).
**Cero archivos fuera del Scope IN. Cero refactors adyacentes.**

**Waves: en orden.** `bf66ba96a` (W0) → `1aa6d0a8f` (W1) → `76334f29f` (W2) → `c2c4db25b` (W3) → los
19 commits de fix-pack. Ningún commit de una wave posterior antes de la anterior.

**Spec: 3 spot-checks contra `wasiai-a2a` @ `10a6eb1` (HEAD del repo canónico, sin mover).** Abrí las
tres citas nuevas y coinciden textualmente: `contracting-chain.ts:769` → `export function
readInboundContracting(`; `contracting-chain.ts:820` → bloque `PASO 4 · PROFUNDIDAD`;
`a2a-key.ts:358` → `const headerRaw = request.headers['x-payment-chain'];`. La 4.ª (`x-api-key` sin
lector) la verifiqué por barrido: 1 sola ocurrencia en todo `wasiai-a2a/src/`, y es un fixture.

El drift ya conocido —`sdd.md:706` declara `commitSha` y el campo se eliminó— **está trazado** en
`story-file.md:316/331` + el docblock de `route.ts:16-38`. **No lo cuento.** Los que siguen **no**
están trazados en ningún lado:

### `DRIFT-1` (MEDIO) · La rama declarada en TRES artefactos no existe

| Dónde | Dice | Realidad |
|---|---|---|
| `work-item.md:36` | `fix/077-wkh-361-contracting-headers-passthrough` | **no existe** |
| `story-file.md:6` | ídem | — |
| `doc/sdd/_INDEX.md:77` *(sin commitear)* | ídem | — |
| `git branch` | — | **`feat/077-headers-proxy`** |

El re-AR lo vio como `MNR-it2-4` y lo declaró preexistente (`story-file.md:242-244`), pero lo acotó a
`_INDEX.md`. **Son tres archivos, y dos de ellos sí están versionados.** Quien siga el expediente
busca una rama que no existe. Dueño: DONE.

### `DRIFT-2` (MEDIO) · `cr-report.md` y `ar-report-it2.md` **no están en git**

```
git ls-files doc/sdd/077-…/  ->  ar-report.md  auto-blindaje.md  sdd.md  story-file.md  work-item.md
git status                   ->  ?? doc/sdd/077-…/ar-report-it2.md
                                 ?? doc/sdd/077-…/cr-report.md
```

Dos consecuencias concretas, no formales:
1. `story-file.md:925` y `:957` fundan `[TBD-4]` y `[TBD-5]` citando **`cr-report.md:310-329`** y
   **`:331-347`**. Si esto se mergea así, **esas dos citas apuntan a un archivo que no existe en el
   repo**. Es literalmente la enfermedad que la HU cura, un piso más abajo.
2. `MNR-CR-3` (los 4 `blindSpot` duplicados), `MNR-CR-4` (el runbook dentro de
   `passthrough-headers.ts`) y `MNR-CR-7` (`declaresDelegation` se llama "declara" y lee lo
   observado) fueron **aceptados y no tomados**, y hoy **existen únicamente en ese archivo sin
   versionar**. Sin commit, esos tres desaparecen del expediente.

### `DRIFT-3` (MENOR) · El contador de cierre del propio story file quedó viejo

`story-file.md:1163-1166` fija el control de CD-14 en `Test Files 89` y `802 → 812` tests. Medido:
**819 (814 passed + 5 skipped)**. Los +7 salen de `048236dcb` (el fix-pack de `MNR-CR-1`), posterior
a que se escribiera el renglón. `Test Files` **sí** sigue en 89, así que el control que importa —el de
CD-14, "si el número no sube el test no se está ejecutando"— **no se rompió**; lo que envejeció es la
cifra de `Tests`. Es el mismo patrón que `CLAUDE.md` documenta para los números escritos a mano.

---

## 6. Las tres preguntas del encargo

**¿Se puede mergear a `main` de `wasiai-v2` sin desplegar? — SÍ.**
Medido, no supuesto: (a) `vercel ls wasiai-prod` muestra los 3 despliegues recientes como **Preview**
y el último **Production** 4 días atrás ⇒ el push/merge **no** publica sobre `app.wasiai.io`; (b)
`wasiai-v2` / `wasiai-v2.vercel.app` **no tiene el trío de vars** (§3.6) ⇒ tras el merge sigue dando
`503 COMPOSE_DISABLED`, que es AC-10 y **no** es un incidente; (c) el único cambio de conducta que
introduce el merge en un ambiente vivo sería el 5.º cron, y ahí `CRON_SECRET` existe y el manifiesto
declara `[]` para staging ⇒ veredicto `MATCH` ⇒ 200, salvo que el `Host` de Vercel no esté declarado
(`[TBD-4]`, sigue abierto).

**¿Hay algún AC que no se pueda cerrar hasta desplegar? — SÍ, seis, y con nombre:**
**AC-1** y **AC-1b** (su *evidencia exigida* es la terna contra un host desplegado), **AC-5**, **AC-6**
y **AC-7** (el endpoint da **404** hoy en los dos dominios), y **AC-8** en su mitad de circuito
completo (la mitad de uso — exit 2 sin host — ya la cerré en vivo). **AC-2, AC-3, AC-4, AC-4b, AC-10
y AC-11 no dependen del despliegue**, y AC-10 está cerrado end-to-end.

**¿Qué queda pendiente después del merge, y quién lo hace?** → §7.

---

## 7. Pendientes post-merge, con dueño

| # | Qué | Quién | Cuándo | Bloquea |
|---|---|---|---|---|
| `P-1` | Commitear `cr-report.md` y `ar-report-it2.md`; corregir la rama en `work-item.md:36`, `story-file.md:6` y `_INDEX.md:77`; poner `_INDEX.md` en el estado real (hoy dice `in progress (F1)`) | **DONE (`nexus-docs`)** | antes de cerrar la HU | `DRIFT-1`, `DRIFT-2` |
| `P-2` | Guardar las dos patas del **paso 5** del smoke con `evaluateStepPrecondition` + `STEP_CONTROL_LEG(5)`, con su test | **Dev** | **antes de la promoción** de `wasiai-prod` (el smoke se corre ahí) | `F4-1` |
| `P-3` | Decidir la salida de `[TBD-1]` (bypass token / desactivar protección / aceptar `app.wasiai.io` como primer testigo) y **escribirla** | **Founder + operador** | antes del paso 2 del runbook | `F4-2` |
| `P-4` | Paso 0 del runbook: re-correr la sonda de `forward-key` **inmediatamente antes** de promover (hoy da 401 ✅, pero es una var de Railway y envejece sola) | **Operador** | t-0 de la promoción | atribución de la reversa |
| `P-5` | Promoción manual de `wasiai-prod` + **las dos ternas** contra `app.wasiai.io` + `npm run smoke:delegation app.wasiai.io --gateway <gw>` | **Operador** | paso 5 de `story-file.md:1030` | AC-1, AC-1b, AC-5, AC-6, AC-7, AC-8 |
| `P-6` | Ventana de 60 min sobre los logs de Railway del gateway (**A-4**), con la regla escrita: las **4** familias `CONTRACTING_*` **no** se atribuyen por `reqId` (`UNATTRIBUTABLE_FAMILIES`) ⇒ **delta contra línea base**, y un cero de coincidencias **no** significa "ninguno vino por el proxy" | **Operador** | post-promoción | reversa |
| `P-7` | `[TBD-2]`, `[TBD-3]`, `[TBD-4]` (los dos proyectos) y `[TBD-5]` (`maxDuration` efectivo) desde el dashboard de Vercel; y la paridad de env de `wasiai-prod` que yo **no pude** medir (§3.6) | **Operador** | primera corrida del cron | AC-7 con disparador real |
| `P-8` | Llevar al done-report, **tal cual**: DT-7 (el card-diff **no** cubre `x-payment-chain`, medido hoy en el card vivo) y DT-8 (las dos pantallas mandan `x-api-key`, que `wasiai-a2a` no lee ⇒ **402** en `app.wasiai.io`; se cierra en **A-5**) | **DONE** | cierre | CD-7 |

Sobre `P-8`: verifiqué **dónde** viven esas dos declaraciones. **DT-7** está en el docblock del cron
(`src/app/api/cron/delegation-drift/route.ts:28-34`) — o sea, en el archivo que alguien abre cuando
toca el mecanismo, no enterrada en un `.md`. ✅ **DT-8** está en `passthrough-headers.ts:107-110`,
pero ahí sólo dice *"alias muerto … migran en A-5"*: **la consecuencia viva (hoy esas dos pantallas
reciben 402 en `app.wasiai.io`) sólo está en `story-file.md:808-813` y `sdd.md:989-990`.** No es un
punto ciego, pero es más débil que DT-7 y por eso va explícito al done-report.

---

## 8. Instrumentos — cuáles fallaron y qué NO pude medir

**Fallaron / hubo que rodear:**
- `npx vitest run` bajo el hook de `rtk`: stdout reducido a **399 bytes**. El número global sobrevive,
  el detalle no. **Rodeo que funcionó**: `--reporter=json --outputFile=<ruta>` (lo escribe vitest, no
  el shell) y leerlo con `node`. Los 8 contadores de §1 salen de ahí.
- `ls` filtrado sobre el scratchpad: devolvió un listado de **807 archivos** antes de la salida que me
  interesaba. Ruido, no corrupción.
- **`grep` pelado no se usó en ningún lado**: todas las citas `archivo:línea` de este informe salen de
  `rtk proxy "grep -n …"` o de `Read`.

**No verificable desde acá (declarado, no inventado):**
1. **Env vars de `wasiai-prod`**: enlazar ese proyecto y leer el token del CLI quedaron **bloqueados
   por el sistema de permisos** de este entorno (2 intentos). ⇒ no puedo afirmar nada sobre si el trío
   está scopeado a `Production` o también a `Preview` — que es, indirectamente, `[TBD-1]`. Instrumento
   para el operador: `vercel link --project wasiai-prod` + `vercel env ls preview`.
2. **Cron Jobs registrados** en cualquiera de los dos proyectos: no hay subcomando de CLI; es
   dashboard. `[TBD-2]`, `[TBD-4]`.
3. **`maxDuration` efectivo / Fluid compute**: dashboard. `[TBD-5]`.
4. **El `Host` con que Vercel invoca el cron**: por construcción sólo lo contesta una corrida
   disparada **por Vercel** (`[TBD-3]`). Cualquier `curl` mío devolvería el `Host` que yo mismo
   mandé — el footgun que abrió esta HU.
5. **Cuántos callers reales mandan hoy estos 3 headers a `app.wasiai.io`**: `wasiai-v2` proxea sin
   loguear headers. Ya declarado en `story-file.md:1061-1063`.

**Ninguna de estas cinco se dio por medida en ninguna línea de este informe.**

---

## 9. Cierre

```
ACs:        13 vivos (10 del work-item rev.2 + AC-1b, AC-4b, AC-11 del SDD) + AC-9 eliminado con motivo
            6 PASS completos · 7 PASS-CÓDIGO (esperan la promoción) · 0 FALLA · 0 sin evidencia
Gates:      tests 819 (814 passed / 5 skipped / 0 failed) · tsc 0 · eslint 0 · build 0   [re-derivados]
Scope:      24/24 archivos declarados · cero creep · waves en orden
Drift:      3 no trazados (rama inexistente en 3 artefactos · 2 reportes sin commitear · contador viejo)
Hallazgos:  1 MENOR-ALTO (falso OK en el paso 5 del smoke, medido) · 1 MEDIO de runbook
            (Preview protegido ⇒ el instrumento de [TBD-1] no da ninguna rama) · 2 MENOR
Runtime:    defecto re-derivado y vivo · rama no desplegada (404 en los dos dominios) · manifiesto
            coherente con los dos dominios · card vivo con 2 headers · paso 0 en 401 ✅ · AC-10 en vivo ✅

VEREDICTO:  APROBADO para merge a `main` de `wasiai-v2` sin desplegar.
            P-2 antes de la promoción de `wasiai-prod`. P-3 antes del paso 2 del runbook.
            NO promover `wasiai-prod` sin ejecutar P-4, P-5 y P-6 en ese orden.
```

*F4 · NexusAgil · QA · 2026-08-18*
