# Work Item — [WKH-361] Los headers de contracting no atraviesan el proxy de v2 — y nadie podía decir qué ambiente delega

> Repo: `wasiai-v2` (marketplace, consumidor). El servicio canónico es `wasiai-a2a` y esa
> relación NO se invierte en esta HU.
> Fecha: 2026-08-18 · `main` = `b55871347`
>
> ⚠️ **Rev. 2 — el alcance cambió después de medir.** La rev. 1 de este archivo decía que la
> delegación estaba apagada en producción y que `wasiai-a2a/CLAUDE.md` mentía. **Las dos cosas
> eran falsas** y salieron de medir el proyecto Vercel equivocado. Lo que sobrevive de la rev. 1
> está abajo; lo que se cayó queda escrito en "Qué decía la rev. 1 y por qué era falso", porque
> el error de medición ES parte del problema que esta HU cierra.

---

## Resumen

Producción (`app.wasiai.io`) **sí delega** a `wasiai-a2a`: el cutover de WKH-66 está hecho y
`wasiai-a2a/CLAUDE.md` dice la verdad. Pero el proxy de v2 reconstruye los headers desde una
lista blanca de 8 (`src/lib/proxy/forward-handler.ts:39-48`) que **no incluye los dos headers
del guard anti-bucle de WKH-360**, así que la capa 2 de ese guard tiene **cobertura cero en el
camino real**, donde viven 22 de los 25 agentes. Esta HU los agrega con criterio escrito, y
deja el mecanismo que hoy no existe: **una forma de saber qué ambiente delega sin ir a pegarle
a mano** — que es exactamente lo que produjo el diagnóstico equivocado que abrió esta HU.

---

## Sizing

- **SDD_MODE:** full
- **Modo del pipeline:** **QUALITY** — y lo re-evalúo con el alcance nuevo, no lo heredo. Baja
  el componente de "encender producción" (ya está encendida) pero **sube** el de riesgo: el
  cambio de la lista blanca se despliega **directo sobre el camino de dinero en vivo**
  (`app.wasiai.io` cobra x402 vía a2a en `/compose` y `/orchestrate`) y **no se puede probar en
  staging tal como está hoy** (ver DT-2). QUALITY se mantiene.
- **Estimación:** M
- **Branch sugerido:** `fix/077-wkh-361-contracting-headers-passthrough`
- **Skills de dominio (máx. 2):** `security/proxy-headers` · `infra/env-y-deploy`

---

## F0 — Codebase Grounding

### Lecciones de instrumento (las dos de esta HU son la misma familia)

Las dos fallas de medición de este ciclo son **el mismo error**: el instrumento nombraba una
cosa distinta de la que creíamos estar midiendo, y devolvió un resultado **plausible** en vez
de un error.

| # | El instrumento | Lo que devolvió | Lo que en realidad nombraba |
|---|---|---|---|
| 1 | `Glob("src/app/[locale]/pipelines/**")` | **0 resultados** | `[locale]` es **clase de caracteres** en glob, no literal. El archivo existe: `Glob("**/PipelinePageClient.tsx")` lo encuentra |
| 2 | `curl https://wasiai-v2.vercel.app/...` | `503 COMPOSE_DISABLED` | ese host es **staging**. Producción es `app.wasiai.io` (proyecto `wasiai-prod`) |

**Ninguno de los dos falló: los dos contestaron con seguridad sobre otra cosa.** Un cero que no
era ausencia, y un host que no era el que creíamos. Regla operativa que sale de acá y que vale
para todo el repo: **antes de creerle a una medición de ambiente, nombrar el proyecto Vercel y
el dominio, no "producción" a secas** (CD-6). Es la misma exigencia que ya estaba en
`CLAUDE.md:5-10` y que se salteó.

### Estado real, medido (rev. 2)

| Proyecto Vercel | Dominio | Delegación | Evidencia |
|---|---|---|---|
| `wasiai-prod` | **`app.wasiai.io`** | **ENCENDIDA** | ver abajo |
| `wasiai-v2` | `wasiai-v2.vercel.app` (staging) | **APAGADA** | `503 COMPOSE_DISABLED` |

**Por qué eso es delegación y no coincidencia** — la prueba correcta no es "responde bien",
es que **el cuerpo del error es el del gateway, con su `requestId` propio**, que v2 no fabrica
en ningún lado:

```
gateway directo : {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"31118215-…"}
app.wasiai.io   : {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"bfec4194-…"}
staging         : {"error":"COMPOSE_DISABLED", …}
```

`VALIDATION_ERROR` + `requestId` no existen en ningún handler de este repo — el 503 de v2 es
`{error, detail}` (`compose/route.ts:20-27`). Dos `requestId` **distintos** entre las dos
llamadas descartan además que sea una respuesta cacheada.

### El defecto, medido contra producción

```
gateway directo, x-a2a-contracting-depth: 99  ->  CONTRACTING_DEPTH_EXCEEDED
app.wasiai.io,   x-a2a-contracting-depth: 99  ->  (idéntico a no mandar el header)
app.wasiai.io,   sin header                   ->  (idéntico)
```

**El header entra a v2 y no sale.** `99` pasa `^[0-9]{1,3}$` y `99 >= depthMax(2)`, así que el
gateway lo rechazaría — y no lo rechaza porque nunca lo ve. Esa terna es la **prueba de
regresión** de AC-1: es reproducible, no cuesta dinero (corta antes de cobrar) y **discrimina**
(la respuesta con header y sin header tienen que dejar de ser iguales).

### Confirmado leyendo el código (archivo:línea)

| Afirmación | Evidencia | Qué la refutaría |
|---|---|---|
| El proxy **reconstruye** los headers desde una lista blanca de 8 | `src/lib/proxy/forward-handler.ts:39-48` y `:76-85` | — |
| Por eso el `headers: req.headers` del reconstructor de `compose` no llega upstream | `src/app/api/v1/compose/route.ts:62` vs `forward-handler.ts:76-85` | — |
| Los dos headers se llaman así | `wasiai-a2a/src/lib/contracting-chain.ts:168` y `:171` | — |
| La capa 2 del guard **depende de que el intermediario los reenvíe** | `wasiai-a2a/src/lib/contracting-chain.ts:149-153` + `CONTRACTING_LAYER2_BEST_EFFORT_NOTE:187-192` | — |
| **Ausente ⇒ 0; presente-pero-ilegible ⇒ RECHAZO** (`''` no pasa `^[0-9]{1,3}$`) | `wasiai-a2a/src/lib/contracting-chain.ts:820-827` + `:229` | — |
| Hoy ningún agente vivo emite estos headers | `wasiai-a2a/src/lib/contracting-chain.ts:82-84` | un caller en logs con el header puesto |
| El set de endpoints delegados se congela **en carga de módulo** | `src/lib/proxy/forward-handler.ts:59` | — |
| Si el flag está puesto y falta una de las otras dos vars, el boot **tira** | `src/lib/env.ts:88-99` + `:106-110` | — |
| El gateway da **401** si la forward key NO coincide, y **no monta** el middleware si falta | `wasiai-a2a/src/middleware/forward-key.ts:102-123` y `:69-81` | — |
| El auth por key del gateway lee **`x-a2a-key`**; sin ese header cae a x402 | `wasiai-a2a/src/middleware/a2a-key.ts:5-6` | — |
| Las dos pantallas mandan **`x-api-key`** | `DemoPageClient.tsx:93` · `PipelinePageClient.tsx:84` | — |
| La suite corre con la delegación **encendida por mock** | `src/lib/proxy/__tests__/forward-handler.test.ts:9-16` | — |
| `scripts/validate-env.js` no discrimina ambientes ni condicionalidad | `:24-35` (las 3 vars no están en `REQUIRED_VARS`) → `warnings` (`:83-87`) → exit **0** (`:145`) | — |

**Lo que sostiene la HU:** con producción **bien** configurada, el repo entero seguía sin poder
contestar "¿qué ambiente delega?". La suite es verde porque **mockea** el mundo delegado
(`forward-handler.test.ts:9-16`), y `validate-env.js` habría dicho "Entorno válido" en los dos
proyectos. **Ningún instrumento del repo distingue staging de producción**, y por eso el
diagnóstico que abrió esta HU fue el equivocado.

### Qué decía la rev. 1 y por qué era falso

| Afirmación de la rev. 1 | Veredicto | Causa |
|---|---|---|
| "Las 3 vars no existen en producción" | **FALSO** para `wasiai-prod`; cierto para `wasiai-v2` (staging) | se midió staging |
| "`compose`/`orchestrate` dan 503 en producción hace ~112 días" | **FALSO**. En staging sí | ídem |
| "`wasiai-a2a/CLAUDE.md` declara algo falso" | **FALSO — la declaración es CIERTA** | ídem |
| "`capabilities` responde por la rama legacy" | **cierto en staging**; en producción **hay que remedirlo** → `[NC-1]` | ídem |
| "Los 2 headers de contracting no llegan al gateway" | **CIERTO, y confirmado contra producción** | — |
| "Ningún instrumento distingue ambientes" | **CIERTO, y ahora con evidencia vivida** | — |

### Drift del contexto del repo (no se arregla acá, se declara)

`.nexus/project-context.md` está fechado **2026-03-20** y **no menciona la delegación**: su
tabla de endpoints (`:206`) describe un `/api/v1/compose` cuya lógica WKH-66 borró de este
repo. Además `:265` dice "Vercel — Auto-deploy on push to `main`" mientras `CLAUDE.md:20-23`
dice que **producción NO auto-deploya** y requiere redeploy manual. Los dos no pueden ser
ciertos → `[NC-3]`. Actualizarlo es la acción A-2.

---

## Qué está caído, y qué NO

- **Producción (`app.wasiai.io`): NO está caída.** `/compose` y `/orchestrate` llegan al
  gateway y responden. No hay incidente.
- **Lo que sí está roto en producción es invisible y no tiene síntoma:** la capa 2 del guard
  anti-bucle no ve nada en el camino que usan 22 de los 25 agentes. Hoy el radio de explosión
  es chico porque **ningún agente vivo emite esos headers**
  (`contracting-chain.ts:82-84`) — o sea que esto **no duele hoy y duele exactamente el día que
  la función empiece a usarse**. Es el orden de "código para producción, no para hack": no
  explota hoy, cambia la prioridad, no la decisión.
- **Staging (`wasiai-v2.vercel.app`) no refleja producción.** Ahí `/demo` y `/pipelines`
  muestran el código de error crudo al usuario: `DemoPageClient.tsx:91` → `:97` → cuadro rojo
  `:195` pinta **`ORCHESTRATE_DISABLED`**; `PipelinePageClient.tsx:80` → `:112`
  (`errData.reason ?? errData.error`, y el 503 no trae `reason`) muestra **`COMPOSE_DISABLED`**.
  **No es un incidente**, es un ambiente de prueba que valida un mundo distinto del que se
  publica — y con la delegación apagada **no puede validar el cambio de esta HU** (DT-2).

---

## Acceptance Criteria (EARS)

**Grupo A — los dos headers (lo principal)**

- **AC-1**: WHEN el caller envía `x-a2a-contracting-chain` y/o `x-a2a-contracting-depth` con
  valor no vacío a `/api/v1/compose` o `/api/v1/orchestrate`, the system SHALL incluirlos, con
  el valor recibido sin modificar, en el request que emite hacia `wasiai-a2a`.
  *Evidencia exigida: la respuesta de `app.wasiai.io` con `depth: 99` SHALL dejar de ser
  idéntica a la respuesta sin header, y SHALL contener `CONTRACTING_DEPTH_EXCEEDED`.*
- **AC-2**: IF el caller NO envía uno de esos headers, THEN the system SHALL NO emitirlo
  upstream, ni siquiera con valor vacío.
  *(No es cosmético: ausente ⇒ 0 y presente-ilegible ⇒ RECHAZO; `''` no matchea
  `^[0-9]{1,3}$` ⇒ el gateway contestaría `CONTRACTING_DEPTH_MALFORMED` a peticiones que hoy
  funcionan — `wasiai-a2a/src/lib/contracting-chain.ts:820-827`.)*
- **AC-3**: the system SHALL reenviar hacia `wasiai-a2a` únicamente los headers de una lista
  blanca explícita, y SHALL NO reenviar `cookie` ni ningún header no listado.
- **AC-4**: WHEN corre `npm test`, the system SHALL fallar si la lista blanca cambia sin que se
  actualice el test que la fija.

**Grupo B — que el ambiente se pueda contestar sin pegarle a mano**

- **AC-5**: WHEN se hace `GET` al endpoint de estado de delegación, the system SHALL devolver
  `200` con: **(a)** un identificador del ambiente que está respondiendo (proyecto/host/id de
  despliegue), **(b)** la lista de endpoints efectivamente delegados leída del **mismo módulo
  que deciden las rutas**, y **(c)** un booleano por cada una de `WASIAI_A2A_BASE_URL` y
  `WASIAI_V2_FORWARD_KEY`. the system SHALL NO incluir el valor de ninguna de las dos.
- **AC-6**: WHILE dos ambientes distintos respondan ese endpoint, the system SHALL devolver
  identificadores de ambiente distintos entre sí.
  *(Es el AC que impide repetir el error de hoy: si los dos se ven iguales, el endpoint no
  sirve para lo que se construyó.)*
- **AC-7**: IF el conjunto de endpoints delegados observado en runtime difiere del declarado en
  el manifiesto versionado en git para ese ambiente, THEN the system SHALL emitir una señal
  observable sin intervención humana, nombrando el ambiente y cada endpoint que difiere.
- **AC-8**: IF el smoke post-deploy detecta que un endpoint declarado como delegado responde
  `503` con `*_DISABLED`, THEN el smoke SHALL terminar con código distinto de `0` y SHALL
  imprimir **el ambiente probado**, el endpoint, el status y el `error` recibido.

**Grupo C — staging (sólo si entra, ver DT-2)**

- **AC-9**: WHEN staging tenga las tres variables configuradas, `POST /api/v1/compose` contra
  staging SHALL responder algo distinto de `503 COMPOSE_DISABLED`.
- **AC-10**: WHILE `V2_DELEGATE_TO_A2A` esté vacío o ausente en un ambiente, the system SHALL
  responder `503` en `/compose` y `/orchestrate` en **ese** ambiente — o sea, la reversa
  devuelve exactamente el comportamiento previo.

---

## Scope IN

| Archivo | Qué cambia |
|---|---|
| `src/lib/proxy/forward-handler.ts` | agregar los 2 headers a `PASSTHROUGH_HEADERS` (`:39-48`) + criterio de entrada escrito |
| `src/lib/proxy/__tests__/forward-handler.test.ts` | test que fija la lista blanca completa (AC-4) + AC-1/AC-2 |
| `src/lib/proxy/delegation-manifest.ts` *(nuevo)* | la declaración como dato, **por ambiente** |
| `src/app/api/v1/status/delegation/route.ts` *(nuevo, ruta a confirmar en F2)* | AC-5, AC-6 |
| `src/app/api/cron/<a definir>/route.ts` | AC-7 |
| `scripts/smoke-delegation.mjs` *(nuevo)* | AC-8 — recibe el host como argumento obligatorio |
| `scripts/validate-env.js` | regla **condicional** para las 3 vars (DT-4) |
| `.env.example` | documentar las 3 vars, el orden y el hazard de CD-1 |
| `CLAUDE.md` (de este repo) | el estado del cutover pasa a ser un puntero al endpoint, no una frase |
| `doc/sdd/077-.../` | artefactos + evidencia con host y fecha |

## Scope OUT

- **Encender producción**: ya está encendida. Esta HU **no toca** las env vars de `wasiai-prod`.
- **`V2_DELEGATE_TO_A2A=mcp`** — `CLAUDE.md:101` lo prohíbe hasta diseñar el shape adapter.
- **Editar `wasiai-a2a`** (ni `src/`, ni su `CLAUDE.md`). Sale como acción A-1.
- **El camino paginado** de `capabilities` (`route.ts:219-258`) y el loop-break TD-002 (`:143-145`).
- **Reapuntar el `discoveryEndpoint` del registry `WasiAI`** (fix definitivo de TD-002,
  `capabilities/route.ts:23-25`).
- **Arreglar el copy de error de las dos pantallas** (muestran el código crudo). Real, anotado,
  y no es esta HU.
- **Cualquier lógica de pricing/x402/settlement en v2** — `CLAUDE.md:97`.

---

## Decisiones técnicas (DT-N)

**DT-1 — La lista blanca sigue siendo lista blanca, y se le escribe el criterio.**
Reenviar `req.headers` entero mandaría la `cookie` de sesión Supabase del usuario logueado a un
servicio de Railway que no la pidió. Criterio para entrar, las **tres** condiciones juntas:
1. el upstream **lo lee**, con un lector citable en `archivo:línea` de `wasiai-a2a`;
2. **no** es credencial de v2 ni identidad del navegador (`cookie`, `set-cookie`, `referer`,
   `x-vercel-*`, `x-middleware-*` quedan afuera por definición);
3. su **ausencia** es semánticamente distinta de un valor vacío y el reenvío preserva esa
   distinción (por eso el `if (v)` de `forward-handler.ts:83-84` se conserva).
Los dos headers cumplen las tres: lector `readInboundContracting`
(`contracting-chain.ts:769`), no son credenciales, y ausente≠vacío está medido en su paso 4.

**DT-2 — Esta HU no se puede probar en staging tal como está, y eso decide si staging entra.**
`CLAUDE.md:21` manda "probar cambios en staging primero". Pero staging **no delega**: ahí
`/compose` corta en `compose/route.ts:19` y **nunca llega a `forwardRequest`**, así que el
cambio de la lista blanca es **inobservable** en staging. Quedan dos caminos y hay que elegir
uno explícitamente:
- **(A) alinear staging** (setear las 3 vars con el orden de CD-1) y recién ahí probar. Cuesta
  un paso de ops, cierra el desalineamiento, y hace que el checklist del repo vuelva a servir.
  **Recomendado.**
- **(B) no alinear**: entonces el único ambiente donde se verifica AC-1 es **producción**, y
  hay que decirlo en el SDD y aceptar que el primer testigo real es un deploy a prod.
La recomendación es **(A)**, y por eso el Grupo C de ACs está escrito. Si el founder prefiere
(B), se borra el Grupo C y se agrega la nota — pero **no se deja implícito**.

**DT-3 — Riesgo del cambio en producción: fail-closed, y hay que declararlo.**
Después de AC-1, un caller que hoy manda esos headers y **es servido** pasará a recibir
`CONTRACTING_LOOP_DETECTED` / `DEPTH_EXCEEDED` / `*_MALFORMED`. Eso es lo que se quiere. El
radio hoy es ~nulo porque ningún agente vivo los emite (`contracting-chain.ts:82-84`), pero es
un cambio de comportamiento en el camino de dinero y no puede aparecer como sorpresa en el
done-report. La verificación de "hoy nadie los manda" es la contracara de la terna del punto de
medición: si con el fix desplegado el tráfico normal cambia de status, la premisa era falsa y se
revierte.

**DT-4 — El mecanismo anti-silencio se queda, y su motivo mejoró.**
El agujero **no era** "la variable está mal". Era que **nadie podía contestar en qué ambiente
está encendida sin ir a pegarle a mano**, y por eso se reportó staging como producción. Cuatro
piezas, ninguna sola alcanza:

| Pieza | Qué ve | Qué NO ve |
|---|---|---|
| **Manifiesto** en git, **por ambiente** | la intención, revisable en PR | nada del runtime |
| **Endpoint de estado** (AC-5/AC-6) | el runtime real **y qué ambiente es** | si a2a contesta |
| **Cron** (AC-7) manifiesto vs runtime | la divergencia, sin que nadie pregunte | ídem |
| **Smoke** (AC-8) con host obligatorio | que el circuito completo responde | corre cuando alguien lo corre |

Por qué **un test de vitest no puede ser el mecanismo principal**: corre en CI, con el
`process.env` de CI, y este repo **mockea `@/lib/env`** en los tests del proxy
(`forward-handler.test.ts:9-16`). Un test verde no puede afirmar nada sobre Vercel. Por qué
**`validate-env.js` tampoco**: es presencia *incondicional* y estas vars son *condicionalmente*
obligatorias — y sobre todo, **no sabe en qué ambiente corre**, que es justo el dato que faltó.

**DT-5 — El endpoint lee `isDelegated()`, no `process.env`.** Si recalculara el set desde la
env estaría verificando su propia copia de la fórmula y aplaudiría cualquier cosa; y `DELEGATED`
se congela en carga de módulo (`forward-handler.ts:59`), así que leer la env en vivo podría
reportar un valor que las rutas **no** están usando.

**DT-6 — El smoke exige el host como argumento y lo imprime.** Un smoke con host por defecto es
el mismo footgun otra vez. Sin argumento, sale con error.

---

## Constraint Directives (CD-N)

- **CD-1 (PROHIBIDO)**: setear `V2_DELEGATE_TO_A2A` en **cualquier** ambiente donde
  `WASIAI_A2A_BASE_URL` o `WASIAI_V2_FORWARD_KEY` no estén ya presentes y desplegadas. Medido:
  `src/lib/env.ts:88-99` + `:106-110` ⇒ throw en carga de módulo ⇒ **500 en toda ruta que
  importe `@/lib/env`**, no un 503 acotado. Aplica también al alineamiento de staging.
- **CD-2 (PROHIBIDO)**: reemplazar la lista blanca por un reenvío de `req.headers` completo, o
  agregar un header sin las tres condiciones de DT-1 escritas al lado, con el lector citado en
  `archivo:línea` de `wasiai-a2a`.
- **CD-3 (PROHIBIDO)**: emitir `x-a2a-contracting-chain` o `x-a2a-contracting-depth` con valor
  vacío. Medido: `''` no pasa `^[0-9]{1,3}$` ⇒ `CONTRACTING_DEPTH_MALFORMED`
  (`wasiai-a2a/src/lib/contracting-chain.ts:822-827`). Convierte peticiones que hoy funcionan
  en 400.
- **CD-4 (OBLIGATORIO)**: el endpoint de estado y el cron deben consumir el **mismo** símbolo
  que consumen las rutas (`isDelegated` / `DELEGATED`), sin releer `process.env`.
- **CD-5 (PROHIBIDO)**: escribir o desplegar cualquier cambio en el repo `wasiai-a2a` desde esta
  HU, incluida la edición de su `CLAUDE.md` (acción A-1).
- **CD-6 (OBLIGATORIO)**: toda afirmación sobre un ambiente —en el SDD, en el AR, en el CR, en
  F4 y en el done-report— debe nombrar **el proyecto Vercel y el dominio**. "Producción" a
  secas queda prohibido en los artefactos de esta HU. Es la regla que sale del error que la
  abrió.
- **CD-7 (PROHIBIDO)**: que el done-report afirme que los headers llegan sin pegar la terna de
  medición completa (`con header 99` / `sin header` / `gateway directo`) contra un host
  nombrado y con fecha. Una respuesta "200 OK" **no** distingue "llegó" de "no llegó": las dos
  se ven iguales, y así se pasó por alto durante meses.

---

## Despliegue y reversa

**El cambio de código, no de env.** Ojo con dos hechos que hay que confirmar antes de
apoyarse en ellos (`[NC-3]`): `CLAUDE.md:20-23` dice que **producción no auto-deploya** (hay
que hacer redeploy manual en el proyecto `wasiai-prod`), mientras `.nexus/project-context.md:265`
dice "auto-deploy on push to main". Los dos no pueden ser ciertos y de eso depende si un push
publica el cambio en el camino de dinero sin que nadie apriete nada.

| # | Acción | Efecto esperado | Verificación |
|---|---|---|---|
| 1 | merge del cambio de lista blanca | staging se actualiza (si auto-deploya) | ⚠️ **no observable en staging** salvo que entre DT-2(A) |
| 2 | *(si DT-2(A))* alinear staging: **primero** las 2 vars + deploy, **después** el flag + deploy | staging deja de dar 503 | AC-9, endpoint de estado |
| 3 | redeploy de `wasiai-prod` | los headers empiezan a atravesar | **la terna** de AC-1 contra `app.wasiai.io` |

**Reversa del cambio de código:** revertir el commit + redeploy, o Instant Rollback de Vercel
(el rollback de código no depende de env → riesgo menor que en la rev. 1). Vuelve exactamente
al comportamiento de hoy: los headers se descartan.
**Reversa del alineamiento de staging:** vaciar `V2_DELEGATE_TO_A2A` + redeploy (AC-10).
⛔ **El orden de apagado es el inverso exacto del de encendido: primero el flag, después las
vars.** Borrar las vars dejando el flag es CD-1 al revés y tira el ambiente entero.

---

## Quién cobra y a quién

- **Producción ya cobra**: `app.wasiai.io` delega y **`wasiai-a2a` cobra x402** con su propio
  ledger de `a2a_agent_keys`. v2 es transporte: no debita ni firma recibos (`CLAUDE.md:97-100`).
  **Esta HU no cambia quién cobra.**
- **Lo que sí puede cambiar es a quién se le sirve**: DT-3 — después del fix, un pipeline con
  traza de contratación en bucle o por encima del techo **deja de ejecutarse y de cobrarse**.
  Es el comportamiento buscado, y es un cambio en el camino de dinero.
- **Si entra DT-2(A)**, staging pasa a cobrar x402 vía a2a donde hoy no cobra nada. Hay que
  decir contra qué key/red y con qué presupuesto, o el "ambiente de prueba" empieza a gastar.

---

## Missing Inputs

- **`[NC-1]` [BLOQUEANTE para F2] ¿Producción sirve `capabilities` por la rama delegada o por
  la legacy?** En staging es legacy (medido). En `app.wasiai.io` **no se remidió** tras la
  corrección. Instrumento:
  `curl -s 'https://app.wasiai.io/api/v1/capabilities?limit=1' | jq 'keys'` →
  `["agents","next_cursor","total"]` = **legacy** (`route.ts:369-372`);
  `registries`/`sources`/`catalogStatus`/`totalAtLeast` = **delegado** (`:197-206`).
  Importa porque el manifiesto de AC-7 tiene que declarar el conjunto **correcto** por ambiente:
  si el manifiesto dice `capabilities` y producción sirve legacy, el cron gritará todos los días
  por un desalineamiento real que nadie decidió — o peor, alguien lo callará ajustando el
  manifiesto a lo observado, que es el mecanismo aplaudiéndose a sí mismo.
- **`[NC-2]` [BLOQUEANTE para F2] ¿Un `wasi_...` autentica contra a2a?** El gateway lee
  `x-a2a-key` (`a2a-key.ts:5-6`) y las dos pantallas mandan `x-api-key`
  (`DemoPageClient.tsx:93`, `PipelinePageClient.tsx:84`). `x-api-key` **sí** está en la lista
  blanca y llega, pero si a2a no lo trata como su header de key, la rama de key no entra y cae a
  `requirePayment()` ⇒ 402.
  ⚠️ **El coordinador me pidió medirlo y no puedo: este agente no tiene `Bash` ni ninguna
  herramienta de red** (sólo `Read`/`Glob`/`Write`). No lo doy por medido ni lo infiero.
  Instrumento exacto, contra el ambiente que ahora sí responde:
  `curl -s -o /dev/stderr -w '%{http_code}' -X POST https://app.wasiai.io/api/v1/compose -H 'content-type: application/json' -H 'x-api-key: wasi_<key real>' -d '{"steps":[{"agent_slug":"wasi-chainlink-price"}]}'`
  → **402 ⇒ la key del marketplace NO autentica en el gateway**. Si ese es el resultado,
  aparece scope nuevo (puente de credenciales o migrar las pantallas a `x-a2a-key`) que **no
  está** en el Scope IN de hoy y hay que decidirlo explícitamente, no absorberlo.
- **`[NC-3]` [resoluble en F2] ¿`wasiai-prod` auto-deploya en push a `main`?** `CLAUDE.md:20-23`
  dice que no; `.nexus/project-context.md:265` dice que sí. De eso depende si el merge de esta
  HU publica solo en el camino de dinero.
- **`[NC-4]` [resoluble en F2] ¿Sentry está activo en los dos proyectos?** AC-7 lo asume
  (`_INDEX.md:15`, WAS-68). Si no, el cron sólo deja `console.error` en logs que **nadie mira**,
  y eso reintroduce el silencio que la HU cierra.
- **`[NC-5]` [decisión del founder] ¿Entra el alineamiento de staging (DT-2 A o B)?** El
  work-item recomienda (A) y deja los ACs del Grupo C listos para borrar si la respuesta es (B).
- **`[NC-6]` [no bloqueante, fuera de repo] `A2A_SELF_HOSTS` / `BASE_URL` en el Railway del
  gateway.** WKH-360 declara no verificado si están puestas (`contracting-chain.ts:443-454`) y
  `GET /health` publica `contractingGuard.selfHostCount` para saberlo (`:864-875`). Esta HU
  arregla la **capa 2**; si `selfHostCount` es 0, la **capa 1** sigue dependiendo del `Host`
  entrante. Vale mirarlo en el mismo movimiento; no es trabajo de este repo.

---

## Acciones fuera de este repo (declaradas, NO ejecutadas acá — CD-5)

- **A-1 — `wasiai-a2a/CLAUDE.md`: la afirmación es CIERTA y no había cómo comprobarla.**
  Cambia el motivo, no la propuesta: *"Realignment status (2026-04-28): PROD CUTOVER COMPLETO"*
  es verdad y aun así produjo un diagnóstico equivocado, porque **no nombra el ambiente ni deja
  forma de verificarlo**. Reemplazo: el estado deja de ser una frase y pasa a ser **un puntero
  al endpoint de AC-5**, con el dominio (`app.wasiai.io`) y la fecha de la última verificación
  al lado. Una frase cierta sin instrumento envejece igual que una falsa — sólo que nadie la
  discute.
- **A-2 — `.nexus/project-context.md` de este repo** (2026-03-20): `:206` describe un
  `/api/v1/compose` que ya no vive acá, y `:265` contradice a `CLAUDE.md:20-23` sobre el
  auto-deploy de producción.

---

## Análisis de paralelismo

- **¿Bloquea a otras?** No bloquea ninguna HU abierta. Es **pre-requisito de cualquier
  afirmación sobre detección de bucles transitivos**: hasta que los headers atraviesen v2, la
  capa 2 de WKH-360 no cubre el camino de 22 de los 25 agentes, y decir lo contrario es un
  over-claim.
- **¿Puede ir en paralelo?** Sí con **WKH-162 / 076** (`_INDEX.md:78`, in progress): toca
  `src/lib/contracts/`, sin intersección con el Scope IN.
- **Relación con WKH-360** (repo `wasiai-a2a`): esta HU **completa** aquella. WKH-360 construyó
  el lector; sin este cambio el lector no recibe nada por el camino real. Repos distintos, sin
  branch compartido.
- **Waves sugeridas para F2:** (W1) headers + tests — el corazón, independiente de todo lo
  demás; (W2) manifiesto + endpoint con identidad de ambiente + cron + smoke; (W3) *(si
  NC-5 = A)* alineamiento de staging con el orden de CD-1. W1 y W2 son mergeables por separado.
