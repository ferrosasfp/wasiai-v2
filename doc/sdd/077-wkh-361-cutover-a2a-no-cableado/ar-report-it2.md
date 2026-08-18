# AR it.2 — Re-Adversarial Review acotado · #077 [WKH-361]

> ⚠️ **Materializado por el ORQUESTADOR.** El agente declaró que sus instrucciones le prohíben crear
> archivos `.md` de reporte. Es la **tercera vez en esta sesión** que un reporte declarado no existe en
> disco, así que ya no es accidente: se materializa **antes** de lanzar el fix-pack, nunca después.

**Rama** `feat/077-headers-proxy` @ `6ff54be3d` · base `main` = `b55871347` · 8 commits sobre el AR it.1 (`a3d333928`)
**Upstream medido**: `wasiai-a2a` @ `10a6eb1` (árbol limpio) · **Fecha** 2026-08-18

## VEREDICTO: 🔴 RECHAZADO — 3 `BLQ-BAJO` nuevos. **Los 7 hallazgos de it.1 están CERRADOS y verificados.**

> CD-6: `wasiai-prod` / `app.wasiai.io` = producción. `wasiai-v2` / `wasiai-v2.vercel.app` = staging.

---

## 0 · Verificación re-derivada, no heredada

| Declarado | Medido | |
|---|---|---|
| `Test Files` 88 passed \| 1 skipped (89) | idéntico | ✅ |
| `Tests` 797 passed \| 5 skipped (802) | idéntico | ✅ |
| `tsc --noEmit` / `eslint --max-warnings 0` / `npm run qa` | 0 / 0 / 0 | ✅ |
| `depth: 1` ⇒ 402 · `depth: 2` ⇒ 400 | `402` / `400 CONTRACTING_DEPTH_EXCEEDED` | ✅ |
| 12 archivos en el fix-pack | `git diff --name-only a3d333928..HEAD` ⇒ 12, todos mapeados a un finding | ✅ |

Los 34 tests nuevos reconcilian (797−763). **El defecto que la HU cura sigue vivo** en `app.wasiai.io`:
`accepts[0]` idéntico con y sin `x-payment-chain`, `eips155:2368`, `1010000000000000` (18 decimales).

## 1 · Cierres verificados uno por uno

**BLQ-MED-1 (radio de impacto) — CERRADO.** Las 6 `citation` verificadas contra `wasiai-a2a` @ `10a6eb1`:
`CHAIN_NOT_SUPPORTED` → `a2a-key.ts:366-370` (`reply.status(400).send`, **sin `request.log`**) ·
`INSUFFICIENT_BUDGET` → `a2a-key.ts:1264-1275` · `DEPTH_EXCEEDED` → `contracting-chain.ts:837-838` ·
`DEPTH_MALFORMED` → `:823-824` · `CHAIN_MALFORMED` → `:810-816` · `LOOP_DETECTED` → `:830-832`.

**El punto ciego de `CHAIN_NOT_SUPPORTED` es EXACTO: no hay tercera vía.** Barrido de `addHook` sobre
`wasiai-a2a/src/` entero: `error-boundary.ts:72` (sólo excepciones lanzadas, leídas sus 4 ramas `:76-114`),
`event-tracking.ts:111-141` (cubre `/compose` pero graba `statusCode`/`requestId`, **nunca `error_code`**),
los dos `onSend` (`request-id.ts:14`, `security-headers.ts:13`, ninguno mira el payload), y
`metrics.ts:105/108` — **el único gancho que el dev NO nombró** — que sólo incrementa `errors++` sin
discriminar código. La suplencia declarada existe: `forward-key.ts:96-98`.

**BLQ-BAJO-1 (el smoke se auto-diagnosticaba mal) — CERRADO, calibrado en las dos direcciones.**
Contra staging: 3 acusaciones falsas desaparecidas, exit 1 legítimo del paso 1 (404, rama no desplegada).
Contra `app.wasiai.io`: **FALLA con 0 inconclusos** ⇒ el guard **no tapa el defecto real**.

**Mutantes re-corridos en worktree desechable, restauración por md5 + `git status` vacío:**

| # | Mutante | |
|---|---|---|
| `M-FP-5` | guard de INCONCLUSO ⇒ `null` | **KILLED** (3 rojos, la salida reproduce **textual** la acusación falsa de it.1) |
| `M-FP-7` | un inconcluso cuenta como falla | **KILLED** (`smoke-delegation.test.ts:357`) |
| `M-FP-10` | sacar `headers` de `compose/route.ts:62` | **KILLED** (2 rojos en `proxy-headers.test.ts`) y **`proxy.test.ts` VERDE (5/5)** — la demostración exacta de MNR-5 |
| `AR-M-A` (del AR) | `v === ''` deja de contar como faltante | **KILLED** (`validate-env-delegation.test.ts:125`) |

**Los 5 MENORes — todos cerrados.** MNR-1 (los dos sitios citan `env.ts:88-99` + `:106-110`, re-medidas
exactas) · MNR-2 (`checkDelegationTrio` exportado + main-guard, 10 tests vía `createRequire`) · MNR-3 (paso
4b sólo por status code) · MNR-4 (`commitSha` fuera, con test negativo; **premisa corregida re-medida**:
`x-vercel-id: iad1::…` es id de **petición**, ni `dpl_` ni commit) · MNR-5 (`proxy-headers.test.ts` espía
`fetch`, no mockea `forwardRequest`).

**La medición que it.1 descartó, cerrada a nivel de wire** (socket TLS crudo contra el gateway):

```
OWS-only ('   ') => 400 {"error_code":"CHAIN_NOT_SUPPORTED","error":"Chain '' is not a recognized slug…"}
vacio ()         => 400 idem
ausente          => 402 accepts[0].network = eip155:2368
```
El dev tiene razón en las dos patas: el gateway lo rechazaría con 400 y la guarda `if (v)`
(`forward-handler.ts:136`) lo descarta ⇒ el caller recibe el default. Lo fija `proxy-headers.test.ts:122-135`.

---

## 2 · Hallazgos nuevos

Los tres son `BLQ-BAJO`. Ninguno rompe un AC ni expone una vulnerabilidad; los tres rompen **el instrumento
y el runbook del camino del dinero**, que es la misma clase de defecto que el fix-pack cerró un piso arriba.

### 🟠 BLQ-BAJO-1 · El disparador de reversa nombra 6 códigos pero sólo puede ATRIBUIR 2 al proxy
**Integration · Error Handling** · `story-file.md:1001` · `passthrough-headers.ts:233/242/251-252/261`
(`blindSpot: null` en las 4 familias `CONTRACTING_*`).

El disparador (`story-file.md:988-993`) exige rechazos **con `x-wasiai-source: v2-proxy`**, y esa línea la
emite `wasiai-a2a/src/middleware/forward-key.ts:96-98`, montado como preHandler en `compose.ts:912`. Pero
`contractingGuardHandler` es **el PRIMERO** (`compose.ts:909`) y aborta con
`return reply.status(400).send(...)` (`contracting-guard.ts:116`), lo que en Fastify corta el resto.

Reproducción con `app.inject` sobre la versión real:
```
preHandler: [contractingGuard(400), forwardKey(log), a2aKey]
status = 400 · preHandlers ejecutados = ["contractingGuard"]   <-- forwardKey NUNCA corrió
```
Y el log que sí sale (`contracting-guard.ts:99-114`) lleva `{code, layer, chainHeaderChars, depthMax,
selfHostCount}` — **ningún campo de origen**.

**Impacto**: en la ventana de 60 min post-promoción, el operador cruza por `reqId` y obtiene **cero
coincidencias** para las 4 familias ⇒ concluye *"ninguno vino por el proxy"* y **no ejecuta la reversa**,
aunque hayan venido todos. Es "acotar un agujero presentado como cerrarlo", en la misma tabla que el
fix-pack reescribió para no hacer eso.

**Segunda pata que nadie midió**: `requireForwardKey()` devuelve `[]` —middleware **no montado**— si
`WASIAI_V2_FORWARD_KEY` está ausente o mide <16 chars en Railway (`forward-key.ts:72-81`). Si eso pasa,
**tampoco existe la suplencia de `CHAIN_NOT_SUPPORTED`** (`story-file.md:1016-1018`), que es el método #1.

**Sugerencia**: (a) fila en la tabla `:995-1001` diciendo que para las 4 `CONTRACTING_*` la atribución **no
está disponible** y que lo que hay es un delta contra línea base; (b) llenar el `blindSpot` de esas 4 (hoy
`null` afirma que no hay punto ciego, y `T-FP-4` **certifica** esa afirmación); (c) el chequeo de
`WASIAI_V2_FORWARD_KEY` como paso previo del runbook. Todo prosa + un campo.

### 🟠 BLQ-BAJO-2 · La acusación falsa de it.1 vuelve TEXTUAL cuando el gateway está caído o lento
**Error Handling · Test Coverage** · `smoke-delegation.mjs:179-197` y su docblock `:20-34`, que declara
**exhaustividad** (*"hay **dos** estados…"*, enumera `503 *_DISABLED` y `429`). **Hay al menos cuatro.**

El proxy **genera él mismo** dos respuestas con body estático y byte-idéntico entre las dos patas:
`504 {"error":"GATEWAY_TIMEOUT"}` (`forward-handler.ts:186-190`) y `502 {"error":"UPSTREAM_ERROR",…}`
(`:195-202`). Ninguna entra al guard.

Reproducción determinista (ambiente que **sí** delega, lista blanca **perfecta**, gateway con timeout):
```
ERR AC-1 FALLA: la respuesta con x-a2a-contracting-depth:99 es IDÉNTICA a la respuesta sin el header
    ⇒ el header no atraviesa el proxy
ERR AC-1b FALLA: … Recibido: {"error":"GATEWAY_TIMEOUT"}
SMOKE FALLA — 3 problema(s)   EXIT = 1
```
Esperado: `INCONCLUSO: el gateway upstream no contesta`. **Recibido: la misma frase, palabra por palabra**,
que motivó el `BLQ-BAJO-1` de it.1.

**Impacto**: `502`/`504` son **más probables durante el cutover** que el `429` que sí se cubrió — el paso 5
del runbook corre el smoke inmediatamente después del redeploy manual, con lambda fría y arranque en frío de
Railway. El instrumento manda a auditar la lista blanca **mientras el gateway está caído**.

**Sugerencia**: la raíz es que el guard **enumera estados malos** en vez de exigir una **precondición
positiva** ("la respuesta llegó a ejecutarse en el gateway"). Y el docblock no puede seguir diciendo "dos
estados" sin un test que lo respalde.

### 🟠 BLQ-BAJO-3 · Exit 0 sobre una corrida que no midió NADA, con "paso 2 OK" sobre un 429
**Error Handling · Test Coverage** · `smoke-delegation.mjs:537-546` + `:396-398` + `:140-141`.

El docblock `:36-43` justifica el exit 0 diciendo que el caso "debería delegar y no delega" lo cazan antes el
paso 2 o el paso 6. **Ese argumento no aplica a la rama `429`, que es la que el fix-pack agregó**: con 429 el
paso 2 no caza nada (su aserción es "no es `*_DISABLED`", que un 429 satisface **vacuamente**) y el paso 6
sólo lee datos del env.

```
paso 2 OK: /compose responde 429 (no *_DISABLED)      <-- afirma OK sin medir AC-8
paso 3/4/4b INCONCLUSO · paso 6 OK
SMOKE OK — 3 paso(s) INCONCLUSO(s)                    EXIT CODE = 0
```
**Los tres headers del camino del dinero se midieron cero veces y el proceso sale 0.** Y reintentar el smoke
—la acción más natural tras un resultado dudoso— es exactamente lo que dispara este estado.

**Sugerencia**: (a) que el paso 2 distinga "no es `*_DISABLED`" de "no se pudo medir" (hoy dice OK ante 429,
502, 504, 500 y 404 por igual); (b) decidir el exit code con inconclusos cuando el ambiente **declara**
delegar. El caso `503 *_DISABLED` sí está bien resuelto con exit 0.

---

## 3 · MENORes

**MNR-it2-1** · el paso 4b da OK ante **cualquier** 400 (`smoke-delegation.mjs:212-213`). Medido: los tres
400 distintos (el que quiere ver, uno de validación de body, uno de contracting) dan **OK** por igual. Hoy no
produce respuesta equivocada (en vivo da 402 ⇒ FALLA correcta), pero un cambio de schema lo vuelve verde sin
que el header haya atravesado. Agregar `includes('CHAIN_NOT_SUPPORTED')` **no reintroduce volatilidad**: el
campo volátil es `requestId`, no `error_code`.

**MNR-it2-2** · el criterio 3 del docblock afirma lo contrario de lo que el código hace.
`passthrough-headers.ts:31-32`: *"su ausencia es semánticamente distinta de un valor vacío, **y el reenvío
preserva esa distinción**"*. El reenvío **colapsa** la distinción (`if (v)`, `forward-handler.ts:136`), y el
propio test nuevo lo dice al revés (*"el proxy es más permisivo que el gateway, a propósito"*,
`proxy-headers.test.ts:122`). En una HU cuya tesis es que la prosa que afirma de más apaga las revisiones, el
titular del criterio de admisión es el peor lugar para dejarlo.

**MNR-it2-3** · la deuda del mensaje de `575ebd307` se declaró impagable **sobre una premisa falsa**.
Medido: `git ls-remote --heads origin feat/077-headers-proxy` ⇒ **vacío**, y `git branch -vv` no muestra
upstream. **La rama no está publicada**, así que un `git rebase --reword` local no altera historia de nadie.
Es textualmente el patrón del bloque 7 del propio auto-blindaje (*"toda frase de la forma 'esto ya es
público'… es el tipo de premisa que decide un finding y que nadie vuelve a medir"*) cometido al decidir que la
deuda es impagable. **Costo cero, y la ventana se cierra en el primer `git push`.**

**MNR-it2-4** · `doc/sdd/_INDEX.md` apunta a una rama que no existe (`fix/077-wkh-361-contracting-headers-passthrough`;
la única es `feat/077-headers-proxy`) y declara estado `in progress (F1)`. **Confirmado preexistente**
(mtime `13:28`, ~2 h antes del primer commit del fix-pack). Su dueño es la fase DONE, no este fix-pack.

**Observación sin severidad**: `sdd.md:706` sigue declarando `"commitSha": string | null`. El SDD es artefacto
congelado y `story-file.md:316/331` documenta la eliminación ⇒ la desviación está trazada. Se anota para que
F4 no lo lea como drift.

---

## 4 · Categorías

| | |
|---|---|
| **Security** | ✅ `commitSha` fuera con test negativo · `REJECTION_FAMILIES` **no se publica por ningún endpoint** (importa: su `blindSpot` describe cómo evadir la observación) · `cookie`/`referer`/`x-vercel-*` no cruzan, verificado **por la ruta real** (`proxy-headers.test.ts:96-113`), no por sonda ad-hoc. |
| **Error Handling** | 🟠 `BLQ-BAJO-2`, `BLQ-BAJO-3`. El `finally { clearTimeout }` y el mapeo 402/5xx→502/Abort→504 intactos. |
| **Data Integrity** | ✅ Sin escrituras. `REVERSAL_WATCHLIST` se **deriva** de `REJECTION_FAMILIES` (`:273`) ⇒ no hay dos listas que puedan divergir. |
| **Performance** | ✅ Sin I/O nuevo; el paso 4b suma 1 POST, contabilizado en el docblock. |
| **Integration** | 🟠 `BLQ-BAJO-1`. Las 6 citas verificadas una por una; las 11 de la lista blanca sin tocar. |
| **Type Safety** | ✅ `tsc` 0. `RejectionFamily` usa `string \| null` explícito y `T-FP-4` fuerza el XOR ⇒ el `null` no se propaga como "sin declarar". |
| **Test Coverage** | 🟡 +34 tests reales, 4/4 mutantes muertos. `MNR-it2-1`. ⚠️ **Nada cubre** la exhaustividad que el docblock afirma (`BLQ-BAJO-2`) ni el exit code ante 429 (`BLQ-BAJO-3`). |
| **Scope Drift** | ✅ 12 archivos, todos mapeables. `wasiai-a2a` **no se tocó** (CD-5): `git status` limpio, `HEAD` = `10a6eb1`. |
| Migraciones / RPC | **N/A** — cero SQL, cero funciones Postgres. |
| Cache | ✅ `no-store` intacto con test, `force-dynamic` en `:72`. |

## 5 · Instrumentos que fallaron

1. 🔴 **`npx vitest run > archivo` a través del hook de `rtk` TRUNCA A 500 CHARS Y DEVUELVE EXIT 0.** El
   archivo quedó en **624 bytes** con `Output truncated (277584 chars → 500 chars)` y `EXIT=0`. **La
   redirección a archivo no salva del filtro, y acá el exit code también miente.**
2. El `grep` sobre ese archivo truncado devolvió **cero** líneas — un cero del instrumento. Se cazó midiendo
   el tamaño (624 B para 802 tests es imposible).
3. `ls -la --time-style=full-iso` a través del hook devuelve un resumen **sin mtimes**; resuelto con
   `rtk proxy "stat -c …"`.
4. Un script de sonda en el scratchpad no resuelve `import 'fastify'`: la resolución de Node necesita el cwd
   dentro del repo.
5. Todos los exit codes medidos inmediatamente después del comando, **nunca después de un pipe**.

## 6 · Límites declarados

Sin acceso a Railway ni a la consola de Vercel ⇒ `BLQ-BAJO-1` está probado **por código** (orden de
preHandlers + semántica de aborto de Fastify con `app.inject`), no por logs vivos. **No se pudo verificar si
`WASIAI_V2_FORWARD_KEY` está seteada con ≥16 chars en el gateway** — precondición de todo el mecanismo de
atribución, hoy sin dueño. `/api/v1/status/delegation` sigue en **404** en los dos hosts (la rama no está
desplegada). No se contó población afectada. **Ninguna petición movió fondos.**

## 7 · Orden del fix-pack

1. **`BLQ-BAJO-2`** — el guard debe cubrir `502`/`504` o invertirse a precondición positiva. Es el que
   reintroduce **textualmente** la acusación falsa que it.1 cerró, en el escenario más probable del cutover.
2. **`BLQ-BAJO-3`** — el paso 2 no puede decir OK sobre un `429`/`504`; el exit code con inconclusos necesita
   decisión escrita para el ambiente que **sí** declara delegar.
3. **`BLQ-BAJO-1`** — la tabla y los 4 `blindSpot: null` tienen que decir que la atribución no existe para
   `CONTRACTING_*`, y el runbook verificar `WASIAI_V2_FORWARD_KEY` **antes** de promover.
4. **`MNR-it2-3` conviene que entre ahora**: la rama no está publicada, el costo es cero y la ventana se
   cierra en el primer `git push`.

**Lo que no es finding y quiero dejar escrito**: el fix-pack cerró los 7 hallazgos de it.1 **de verdad, no de
palabra**. Los tres mutantes que más importan mueren, y `M-FP-10` demuestra `MNR-5` exactamente como se
declaró. Bajar el radio de impacto a datos versionados con `T-FP-1…6` es el arreglo estructuralmente
correcto: **convierte una prosa que no falla en un dato que sí**. Las dos correcciones de premisa del
auto-blindaje se re-midieron y **son exactas las dos**. Los tres findings nuevos están todos en el borde que
el fix-pack tocó último y midió menos: **el instrumento, no el arreglo**.
