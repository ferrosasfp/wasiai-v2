# Code Review (CR) — #077: [WKH-361] Los headers del camino del dinero no atraviesan el proxy de v2

- **Revisor**: `nexus-adversary` en modo **CR** (calidad, mantenibilidad y si lo escrito es verdad).
- **Fecha**: 2026-08-18
- **Rama**: `feat/077-headers-proxy` @ `a2353b38f` · base `main` = `b55871347` · 20 commits (incluye el `reword` de `MNR-it2-3`)
- **Alcance**: 19 archivos de código/config + 5 artefactos del expediente. Fix-pack 1 (AR) y fix-pack 2 (AR it.2) incluidos.
- **Entradas leídas**: `work-item.md`, `sdd.md` (§ relevantes), `story-file.md`, `ar-report.md`, `ar-report-it2.md`, `auto-blindaje.md` (15 bloques), todo el diff, y el repo `wasiai-a2a` @ `e2f8d71` para verificar las citas cruzadas.
- ⚠️ **No se modificó código.** Las mediciones que requerían mutar un archivo se hicieron en un **worktree descartable** fuera del repo, y se removió al terminar (`git worktree list` ⇒ sólo el árbol principal).

---

## VEREDICTO: **APROBADO con MENORes**

**Cero BLOQUEANTEs.** 7 `MNR`. Ninguno rompe un AC, ninguno toca el camino del dinero en runtime:
los siete están en el **instrumento y en la mantenibilidad**, igual que la ronda anterior. El arreglo
en sí (`forward-handler.ts` + `passthrough-headers.ts` + la ruta `compose`) lo revisé línea por línea
y no tengo hallazgos: los tres headers atraviesan, la guarda `if (v)` está justificada y medida, y la
cadena real `route → new NextRequest → forwardRequest → fetch` ahora sí tiene un test que la ejercita
sin mockear el medio (`proxy-headers.test.ts`).

Los 7 `MNR` **no bloquean el gate**. Recomiendo tomar `MNR-CR-1` y `MNR-CR-2` ahora (son 20 minutos y
están en el instrumento que se va a correr en el cutover); el resto puede ir al backlog con la HU de
seguimiento.

---

## 1. Lo que el Dev declara, re-medido

Todo verificado por mí, con el instrumento fuera del pipe (los exit codes nunca se leyeron después de
un `|`).

| Declarado | Medido por el CR | Instrumento |
|---|---|---|
| `Test Files` **89**, sin archivos nuevos | **89** (88 passed, 1 skipped) | `rtk proxy "npx vitest run --reporter=dot --silent"` |
| `Tests` **807 passed** (+10), 5 skipped | **807 passed \| 5 skipped (812)** | ídem |
| `tsc --noEmit` ⇒ 0 | **0 salida, exit 0** | `rtk proxy "npx tsc --noEmit"` |
| `eslint --max-warnings 0` ⇒ 0 | **0 salida, exit 0** | `rtk proxy "npx eslint . --max-warnings 0"` |
| Los 5 archivos de `src/lib/proxy` y las 2 rutas nuevas en verde | **103 tests en 5 archivos, 0 fallas** | corrida acotada |

**Los 5 tests skipped son preexistentes y ajenos a la HU**: `creator-earnings-rls.integration.test.ts`
y `agents/__tests__/trial.test.ts`. Lo verifiqué porque un `skipped` es una de las formas conocidas
en que una suite miente; ninguno de los dos toca `src/lib/proxy` ni las rutas de esta HU.

**Scope**: 19 archivos fuera de `doc/sdd/**` = los 17 de `story-file.md` §4 + los 2 de test que suma
el fix-pack 1 (`validate-env-delegation.test.ts`, `proxy-headers.test.ts`). **Sin drift.** El fix-pack
2 no agregó archivos, como declara §4.c.

### Citas cruzadas a `wasiai-a2a` — verificadas contra el repo, no heredadas

El razonamiento entero de atribución de la reversa depende de cuatro hechos del otro repo. Los abrí:

| Afirmación del expediente | Verificado |
|---|---|
| `requireForwardKey()` devuelve `[]` si la var falta o mide <16 (`forward-key.ts:72-81`) | ✅ `const FORWARD_KEY_MIN_LENGTH = 16` (`:37`), guarda en `:74`, `return []` en `:80` |
| La línea `forward-key source` se emite en `:96-98` | ✅ `'forward-key source'` en `:98` |
| `contractingGuardHandler` es el PRIMER preHandler de `/compose` (`compose.ts:909`) y `requireForwardKey()` va después (`:912`) | ✅ textual, con el comentario de WKH-360 explicando por qué va primero |
| El log `contracting-guard.rejected` no lleva ningún campo de origen | ✅ lleva `{code, layer, chainHeaderChars, depthMax, selfHostCount}` (`contracting-guard.ts:100-113`) y aborta con `reply.status(400).send` en `:116` |
| El `.refine` de `src/lib/env.ts:88-99` + el `throw` de `:106-110` (cita re-medida en `MNR-1`) | ✅ ambas exactas |

**Conclusión**: la parte más frágil del expediente —la que decide cómo se vigila el cutover— **es
verdad**. No encontré ninguna cita inventada ni desplazada.

---

## 2. Las seis preguntas del encargo, contestadas con medición

### 2.1 El mutante `M-FP1-3` que sobrevive: ¿importa el residual?

**No, y lo medí en vez de razonarlo.** El dev reporta que escribir `UNATTRIBUTABLE_FAMILIES` a mano
con los mismos 4 códigos no lo distingue ningún test. Es cierto — y es todo lo que es.

Método: worktree descartable en `a2353b38f`, `node_modules` por symlink, tres corridas de
`forward-handler.test.ts`.

| Escenario | Resultado medido |
|---|---|
| (a) sólo el mutante (lista a mano, datos sin cambiar) | **40/40 verde** — sobrevive, como declara el dev |
| (b) sólo el cambio futuro realista: el gateway agrega el origen al log ⇒ `CONTRACTING_LOOP_DETECTED` pasa a `proxyAttribution: 'reqId'` + `blindSpot: null` | **2 rojos**: `T-FP-7` (`expected [...3] to deeply equal [...4]`) y `T-FP-8` (`+ CONTRACTING_LOOP_DETECTED`) |
| (c) el mutante **más** ese cambio futuro | **2 rojos**: `T-FP-7` (`CONTRACTING_LOOP_DETECTED sin punto ciego escrito: expected null to be truthy`) y `T-FP-8` |

O sea: **la lista a mano no abre ningún agujero silencioso.** En el único escenario donde la lista
derivada y la escrita a mano divergirían, el conjunto `T-FP-7` + `T-FP-8` pone rojo igual, y el
mensaje sigue nombrando la familia exacta. Lo que compra la derivación no es detección: es que el
rojo aparezca en la línea correcta sin que nadie tenga que acordarse de un segundo lugar.

**Alcanza con lo que hay.** No es finding. (Y `M-FP1-4` —a mano + una familia flipeada— muriendo es
exactamente el control que hacía falta para poder decir esto.)

### 2.2 `GATEWAY_EXECUTED_STATUSES = [400, 402, 403]`: ¿correcta y completa?

**Correcta.** Verifiqué la premisa que la sostiene —que ninguno de esos tres se puede fabricar sin
hablar con el gateway— **en el código de v2, no en el docblock**:

- `src/app/api/v1/compose/route.ts` genera localmente **503** (`:20-27`) y **422** (`:44-51`), nada más;
- `src/app/api/v1/orchestrate/route.ts` genera localmente **503** y nada más (`grep 'status: 4'` ⇒ sin matches);
- `forward-handler.ts` genera **502** (`:176-179`, `:199-202`) y **504** (`:187-190`), y reenvía el resto tal cual (`:181-184`);
- no hay `middleware.ts` que emita 4xx sobre `/api/**` (el matcher lo deja pasar con `NextResponse.next()`).

**Sobre el 200 y el 404** (las dos preguntas explícitas del encargo): los dos caen en INCONCLUSO, y el
mensaje nombra el criterio en vez de inventar una causa. Medido:

```
precondicion(200) -> [h] paso 4b INCONCLUSO: /compose responde 200, que NO prueba que la petición se
haya ejecutado en el gateway (los medibles son 400/402/403) ⇒ no se puede concluir nada sobre la
lista blanca. Recibido: {"ok":true}
precondicion(404) -> ... responde 404, que NO prueba ...
```

Un criterio positivo mal calibrado **rechaza mediciones buenas** — el error espejo. Acá el costo de
ese rechazo está acotado y es el correcto: en un ambiente que declara delegar, un INCONCLUSO sale
**1** (`decideVerdict`), así que la medición no se pierde en silencio; se vuelve a pedir. La única
consecuencia real la anoto en `MNR-CR-2`: con un 200 el operador lee *"no se pudo medir"* donde en
realidad hay un defecto (el header no atravesó y el agente salió gratis). Es conservador, no
peligroso.

**Incompleta en un punto teórico que NO cuento como finding**: un `403` del borde de Vercel (regla de
firewall) satisfaría la guarda sin que el gateway ejecute, y las dos patas darían el mismo HTML ⇒
acusación falsa. No lo reporto porque no puedo reproducirlo (no tengo consola de Vercel y el proyecto
no tiene reglas de firewall declaradas en el repo): es una sospecha, no un hallazgo.

### 2.3 `decideVerdict()`: la lógica completa y los cruces

La función tiene 4 ramas y el test `T-FP3-1` cubre 4 combinaciones. Enumeré el espacio entero
`(failures, inconclusos, declara)` y **no falta ninguna rama alcanzable**: `(N>0, 0, *)` cae en la
primera con sufijo vacío y `(0, 0, false)` en la última; ambas son triviales y su comportamiento es
correcto.

El cruce que **sí** merece atención no está en las combinaciones sino en de dónde sale el tercer
argumento — ver `MNR-CR-7`. Resumen: `declaresDelegation` se calcula desde `delegation.runtime` (lo
observado) y no desde `delegation.declared` (la intención del manifiesto, que viene en el mismo
payload). Recorrí el escenario que importa —`app.wasiai.io` con el flag caído a `capabilities`— y
**el exit code sigue siendo 1**, pero por el paso 6 (`DRIFT`), no por `decideVerdict`. Es correcto
hoy; lo que no está escrito en ningún lado es que esa corrección depende del paso 6.

El caso `503 *_DISABLED` saliendo **0** está bien y es deliberado (DT-2 B+): el manifiesto declara
`delegated: []` para `wasiai-v2`, no hay nada que medir, y una alarma que suena siempre es una alarma
apagada. La última línea nunca dice `SMOKE OK` a secas: dice cuántos inconclusos hubo. Verificado en
`T-FP3-1` (c) y en la corrida real contra `wasiai-v2.vercel.app` que reporta el dev.

### 2.4 La sonda del forward-key (paso 0 del runbook)

**La lectura es correcta y la verifiqué en el código del otro repo**, no en la salida de esa corrida:

- clave **inválida** ⇒ `401 INVALID_FORWARD_KEY` (`forward-key.ts:121`) **sólo puede ocurrir si el
  middleware está montado**, porque el `return []` de `:80` es lo único que lo desmonta. La inferencia
  "401 ⇒ montado" es válida.
- **ausencia** de header ⇒ passthrough (`forward-key.ts:104-107`, `if (typeof headerValue !== 'string' || headerValue.length === 0) return`),
  así que el control sin header cortando en `400 VALIDATION_ERROR` es el resultado esperado y **no
  distingue montado de no montado**. Por eso la sonda tiene que mandar una clave MALA. El runbook lo
  dice con esas palabras (`story-file.md:959`).

**Y el paso 0 dice lo que hay que hacer, no lo que salió bien esa vez**: la celda declara el
procedimiento (`POST <gateway>/compose` con clave inválida), el resultado esperado, el control, y la
razón del control. El "Medido el 2026-08-18: 401" va **al lado** del procedimiento, no en su lugar.
Es la forma correcta.

Una limitación que el runbook no nombra la anoto en las observaciones (no es finding): la línea
`forward-key source` se emite **antes** de validar la clave y con el valor del header
`x-wasiai-source` que escribe el caller (`forward-key.ts:88-99`), así que marca qué `reqId`
**dice** venir del proxy.

### 2.5 Calidad y mantenibilidad

- **Nombres**: buenos en general (`isForwardKeyConfigured`, `listDelegatedEndpoints`,
  `evaluateStepPrecondition`, `diffDelegation` dicen lo que hacen). La excepción es
  `declaresDelegation` (`MNR-CR-7`).
- **Duplicación**: dos focos — los 4 `blindSpot` idénticos (`MNR-CR-3`) y los literales de red del
  smoke (observación 3).
- **Acoplamiento**: bien resuelto. `passthrough-headers.ts` y `delegation-manifest.ts` son módulos
  puros sin `@/lib/env` ni `server-only`; `delegation-manifest.ts` importa `DelegatedEndpoint` como
  `import type` para no arrastrar el grafo de `forward-handler`. CD-4 se cumple de verdad: ni la ruta
  de estado ni el cron releen `process.env` para el conjunto delegado, los dos llaman a
  `listDelegatedEndpoints()`, y `DELEGATED` no se exporta.
- **¿Los docblocks dicen la verdad?** Sí, con **una** excepción medida (`MNR-CR-2`), y con el mérito
  de que el criterio 3 de `passthrough-headers.ts:31-52` ahora describe la conducta real (colapsa la
  distinción, no la preserva) y lo dice con su test al lado.
- **¿Un dev nuevo entiende `passthrough-headers.ts` sin leer el expediente?** La primera mitad sí. La
  segunda no, y no por difícil sino por larga: 230 de sus 393 líneas son datos de runbook que ningún
  camino de runtime importa, y nada se lo avisa (`MNR-CR-4`).
- **¿Los tests prueban comportamiento o implementación?** Comportamiento, en su gran mayoría, y con
  aserciones específicas: `proxy-headers.test.ts` mide la cadena real; `delegation-off.test.ts` mide
  el mundo apagado que antes no tenía ningún test; los tests del smoke afirman sobre la SALIDA que
  lee el operador (`expect(out).not.toContain('el header no atraviesa el proxy')`), que es lo que
  importa. Los tests de literal (`T-04`, `T-FP-1`) son contratos declarados como tales, no
  acoplamiento accidental.

### 2.6 Lo que el fix-pack 2 tocó último y midió menos

Ahí están 3 de los 7 hallazgos: `MNR-CR-1`, `MNR-CR-2` y `MNR-CR-7`, los tres en
`scripts/smoke-delegation.mjs` y su test — los dos archivos que el fix-pack 2 reescribió al final.
Es el mismo patrón que el propio dev documenta en el bloque de las 17:35 (la conducta escrita en dos
lugares y sólo uno actualizado): su `grep` cazó el `USAGE`, y no cazó el título del `it(...)` porque
la frase estaba dicha con otras palabras.

---

## 3. Hallazgos

### `MNR-CR-1` — La guarda de precondición cubre la PRIMERA pata de cada terna; la segunda entra sin control

- **Categoría**: Test Coverage / calidad del instrumento
- **Archivo:línea**: `scripts/smoke-delegation.mjs:594-607` (paso 3), `:619-637` (paso 4), `:666-681` (paso 5)
- **Qué está mal**: la tesis del fix-pack 2 —escrita en el docblock, `:22-26`— es que *"una
  comparación de bodies sólo significa algo si la petición LLEGÓ A EJECUTARSE EN EL GATEWAY"*. La
  guarda `evaluateStepPrecondition` se aplica sólo a `withHeader`. La respuesta `without` —la que el
  mismo docblock llama el discriminador (*"Si las dos últimas son iguales, el header no llegó"*,
  `:18-19`)— se compara **sin mirar su status**. El comentario de `:592-593` justifica el orden con
  una premisa que no se cumple siempre: *"si la 1ª no es medible, la 2ª tampoco lo es"*.
- **Reproducción (ejecutable, sin red)**:

```
node --input-type=module -e '
const m = await import("scripts/smoke-delegation.mjs");
// 1ª pata medible, 2ª pata en 429 (el estado que el propio docblock documenta
// como probable: una corrida hace 7 POST y el límite del borde salta en el 11º,
// así que DOS corridas encadenadas lo disparan a mitad de camino)
...'
```

Resultado medido con ese stub (paso 2 en 400, primeras patas medibles, patas de control en 429):

```
[app.wasiai.io] paso 3 OK: x-a2a-contracting-depth atraviesa el proxy
[app.wasiai.io] paso 4 OK: x-payment-chain atraviesa el proxy
[app.wasiai.io] SMOKE OK
EXIT=0  patas-sin-header=4
```

Nada en la salida le dice al operador que 2 de las 4 patas comparadas nunca llegaron al gateway.

- **Impacto**: hoy **no produce un veredicto falso**, y lo digo con la medición al lado: en los dos
  pasos la aserción que carga el peso es la positiva (`withAccept.includes('eip155:84532')` y
  `withHeader.includes('CONTRACTING_DEPTH_EXCEEDED')`), que por sí sola prueba que el header
  atravesó. Se vuelve un **falso OK sobre el camino del dinero** el día que el default del gateway
  sea `base-sepolia` — ahí el único discriminador es la diferencia entre patas. Medido:

```
terna con la pata de control MEDIBLE (402): DETECTA el defecto
terna con la pata de control en 429       : NO detecta -> paso 4 OK
```

- **Para quien mantenga esto en 3 meses**: el archivo declara un invariante ("comparar bodies exige
  gateway ejecutado") que su propio código aplica a la mitad de los bodies que compara. El que venga
  después va a confiar en el docblock.
- **Sugerencia**: pasar `without.status` por la misma `evaluateStepPrecondition` antes de comparar, y
  que un control no medible haga el paso INCONCLUSO en vez de OK. No escribo el código.

### `MNR-CR-2` — Un título de test que afirma la conducta que `MNR-it2-1` eliminó, sobre un caso que `runSmoke` ya no puede producir

- **Categoría**: Test Coverage / "el docblock dice la verdad"
- **Archivo:línea**: `src/lib/proxy/__tests__/smoke-delegation.test.ts:580` (título) y `:596-598` (la aserción del 200)
- **Qué está mal**: el título dice **"decide SOLO por el status: un 400 con cualquier body pasa, un
  200 con el código adentro falla"**. El fix-pack 2 reescribió el cuerpo de ese mismo `it(...)` para
  asertar lo contrario (`otro400` ⇒ `'NO es el'` + `'CHAIN_NOT_SUPPORTED'`) y dejó el título. El
  título es lo que sale por la terminal en cada `npm test`; el cuerpo hay que ir a abrirlo.
- **Reproducción**: `rtk proxy "grep -n 'cualquier 400' src doc scripts"` ⇒ una única aparición viva,
  ésa. Y ejecutando la función:
  `evaluateInvalidChainSlug(h, 400, '{"code":"VALIDATION_ERROR"}')` ⇒ `AC-1b FALLA: ... NO es el de la red`.
  O sea: un 400 con cualquier body **ya no pasa**, que es justo lo contrario del título.
- **Segunda mitad**: la última aserción de ese test (`evaluateInvalidChainSlug(host, 200, …)` ⇒ no
  null) documenta una garantía que el sistema compuesto **ya no da**: con `GATEWAY_EXECUTED_STATUSES`
  un 200 nunca llega a esa función. Medido: `evaluateStepPrecondition('h','4b','compose',200,…)` ⇒
  `paso 4b INCONCLUSO`, mientras el unit test dice que ese mismo input produce `AC-1b FALLA`.
- **Impacto**: es la **tercera** aparición en esta HU del patrón que el propio dev documenta en
  `auto-blindaje.md:411-429` ("arreglé el comportamiento y dejé el `--help` afirmando el viejo"), y
  sobrevivió a la mitigación que él mismo se recetó (el `grep` de la frase vieja) porque acá la frase
  vieja está dicha con otras palabras. En 3 meses, el que lea la salida del runner va a creer que el
  paso 4b decide sólo por el status.
- **Sugerencia**: reescribir el título con la conducta actual, y decidir qué hacer con la aserción
  del 200 (dejarla documentando la función pura **diciendo** que `runSmoke` no la alcanza, o moverla
  a una aserción sobre `evaluateStepPrecondition`).

### `MNR-CR-3` — El mismo párrafo de `blindSpot` copiado cuatro veces, con un test que no exige que sigan siendo iguales

- **Categoría**: Mantenibilidad / duplicación
- **Archivo:línea**: `src/lib/proxy/passthrough-headers.ts:280-291`, `:301-312`, `:323-334`, `:344-355`
- **Qué está mal**: las 4 familias `CONTRACTING_*` llevan un `blindSpot` de ~11 líneas **idéntico
  palabra por palabra** (mismas citas `compose.ts:909`, `contracting-guard.ts:116`, mismo párrafo de
  DELTA, misma frase de CD-5). `T-FP-7` sólo exige que cada uno **contenga** 4 substrings
  (`compose.ts:909`, `forward-key source`, `CERO`, `DELTA`): nada exige que las 4 copias digan lo
  mismo, ni las mantiene sincronizadas.
- **Reproducción**: leer las 4 celdas; y en el worktree, editar una sola de ellas para cambiar la
  cita a `compose.ts:910` deja las otras 3 con la cita vieja y la suite **verde** mientras el
  substring exigido siga presente.
- **Impacto**: la acción `A-6` (agregar el origen al log de `contracting-guard` en `wasiai-a2a`) está
  **declarada** en el expediente. El día que se ejecute, hay que editar 4 párrafos; el que edite 1 o
  2 deja el archivo afirmando dos cosas distintas sobre el mismo punto de observación, y nada se pone
  rojo. Es la misma familia de defecto que la HU vino a cerrar, un piso más abajo.
- **Sugerencia**: una constante compartida (`const CONTRACTING_BLIND_SPOT = '…'`) usada por las 4
  filas, o un test que exija que los 4 sean el mismo string.

### `MNR-CR-4` — `passthrough-headers.ts` mezcla el dato que el runtime consume con 230 líneas de runbook que no consume nadie

- **Categoría**: Mantenibilidad / cohesión
- **Archivo:línea**: `src/lib/proxy/passthrough-headers.ts:167-392` (todo el bloque "RADIO DE IMPACTO")
- **Qué está mal**: medido con `grep` sobre todo el repo, los consumidores de `REJECTION_FAMILIES`,
  `REVERSAL_WATCHLIST`, `UNATTRIBUTABLE_FAMILIES` y `WKH_361_NEW_HEADERS` son **exclusivamente**
  `forward-handler.test.ts` y la prosa de `story-file.md`. **Ningún camino de runtime los importa**:
  la ruta de estado y el cron sólo usan `PASSTHROUGH_HEADERS`. El archivo pasa de 0 a 393 líneas y
  ~60% es material de runbook.
- **Impacto**: no es un defecto —la decisión de bajar el radio de impacto de prosa a datos
  versionados es correcta y cerró `BLQ-MED-1`— pero un dev nuevo que abre el archivo para agregar un
  header no tiene cómo saber qué parte se ejecuta y qué parte es documentación con test. El riesgo
  concreto a 3 meses es el opuesto al que se quiso cerrar: alguien "limpia código muerto" y borra el
  radio de impacto porque nada lo importa.
- **Sugerencia**: separar en `rejection-families.ts`, o —más barato— encabezar la sección con una
  línea explícita: *"nada de acá abajo se ejecuta en runtime; su consumidor es el runbook §13 y sus
  tests `T-FP-*`. No borrar por estar 'sin usar'."*

### `MNR-CR-5` — El cron se despliega en LOS DOS proyectos, y sólo se analizó uno

- **Categoría**: Integration
- **Archivo:línea**: `vercel.json:19-22` + `story-file.md:864-874` (`[TBD-2]`) y `:876-921` (`[TBD-3]`)
- **Qué está mal**: `vercel.json` está versionado en el repo que despliegan **los dos** proyectos
  Vercel, así que `/api/cron/delegation-drift` queda registrado tanto en `wasiai-prod`
  (`app.wasiai.io`) como en `wasiai-v2` (`wasiai-v2.vercel.app`, staging). Los dos TBD que analizan
  el cron nombran **sólo `wasiai-prod`**: TBD-2 (¿acepta Vercel el 5.º cron?) y TBD-3 (¿está
  declarado el `Host` con que Vercel invoca?) — este último con un procedimiento excelente que dice
  "Dashboard → proyecto **`wasiai-prod`**".
- **Reproducción**: `rtk proxy "grep -n cron doc/sdd/077-…/story-file.md"` ⇒ ninguna línea contempla
  la corrida del cron en el proyecto de staging.
- **Impacto**: en staging el cron corre igual a las 06:00 UTC. Si el `Host` de invocación no es
  exactamente `wasiai-v2.vercel.app` (por ejemplo la URL de deployment), el handler devuelve **500
  `UNDECLARED_HOST` todos los días** con `logger.error` + `Sentry.captureMessage`; y si ese proyecto
  no tiene `CRON_SECRET`, devuelve **500 todos los días** por otra razón (`route.ts:119-122` vía
  `verifyCronAuth`). Una alarma diaria en el proyecto que nadie mira es exactamente el ruido que
  CD-10 evita con tanto cuidado en el otro.
- **Sugerencia**: extender el procedimiento de TBD-3 a los dos proyectos (es el mismo, cambia el
  nombre), o declarar explícitamente qué se espera del cron en staging.

### `MNR-CR-6` — El cron no declara presupuesto de ejecución, y su timeout de card es del mismo orden que el default de la plataforma

- **Categoría**: Error Handling
- **Archivo:línea**: `src/app/api/cron/delegation-drift/route.ts:49-51` (`export const runtime`, sin
  `maxDuration`) vs su exemplar `src/app/api/cron/reconcile-onchain/route.ts:9-10`
  (`runtime` **y** `maxDuration = 120`)
- **Qué está mal**: `AGENT_CARD_TIMEOUT_MS = 10_000`. La rama que CD-10 protege —gateway colgado ⇒
  `reachable:false` ⇒ `WARN` ⇒ **200**— sólo se alcanza si la función vive lo suficiente para que el
  `AbortController` dispare. Si el presupuesto efectivo de la función fuera ≤10 s, con el gateway
  colgado la función muere **antes** del abort, la corrida del cron queda registrada como fallida, y
  el resultado es la alarma falsa por gateway caído que CD-10 existe para impedir.
- **Impacto**: acotado, pero cae justo sobre la única garantía que el cron promete en su docblock
  (`:17-21`).
- **⚠️ Límite honesto**: **no pude medir el presupuesto efectivo** (sin consola de Vercel). Lo reporto
  como *medición pendiente + asimetría con el exemplar*, no como defecto probado. Si el proyecto corre
  con Fluid compute (default 300 s) esto es un no-issue y se cierra con una línea.
- **Sugerencia**: declarar `maxDuration` explícito (como el exemplar) o medir el efectivo y anotarlo.

### `MNR-CR-7` — `declaresDelegation` dice "declara" pero lee lo observado, y la red de seguridad real (paso 6) no está escrita

- **Categoría**: Type Safety / claridad semántica
- **Archivo:línea**: `scripts/smoke-delegation.mjs:539-544` (cálculo), `:437-457` (`decideVerdict` y
  su docblock), `:121-125` (`USAGE`)
- **Qué está mal**: toda la HU se apoya en una distinción explícita —`delegated` es **prescriptivo**
  (la intención del manifiesto) y el runtime es **descriptivo** (`delegation-manifest.ts:16-29`,
  CD-9)—. `decideVerdict` recibe un parámetro llamado `declaresDelegation` que se calcula desde
  `status.delegation.runtime`, o sea **lo observado**, mientras `status.delegation.declared` —la
  intención— viene en el mismo payload y no se usa. El `USAGE` que lee el operador repite la palabra:
  *"si el ambiente DECLARA delegar (delegation.runtime …)"*.
- **Reproducción / cruce**: ambiente `app.wasiai.io` con el flag caído a `capabilities`:
  `runtime=['capabilities']` ⇒ `ac8Targets=[]` ⇒ `declaresDelegation=false` ⇒ pasos 3/4/4b INCONCLUSOS
  (503) ⇒ `decideVerdict` devolvería **0**. El exit 1 lo salva **el paso 6** (`declared` ≠ `runtime`
  ⇒ `DRIFT` ⇒ falla). Correcto hoy — y en ningún lado está escrito que depende de eso.
- **Impacto**: el que toque el paso 6 en el futuro (por ejemplo, para no fallar en algún ambiente)
  rompe una garantía que cree que vive en `decideVerdict`. Es la clase de acoplamiento invisible que
  esta HU documenta bien en otros lados y acá no.
- **Sugerencia**: renombrar a `runtimeDelegates`, o alimentarlo con `delegation.declared` (que es lo
  que el nombre promete) — y en cualquiera de los dos casos, escribir en el docblock que el caso
  "declara pero el runtime no delega" lo caza el paso 6.

---

## 4. Las categorías

| # | Categoría | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **Security** | **OK** | El endpoint público publica presencia (`boolean`), nunca valor ni longitud (`route.ts:105-109`), con test que busca el substring del valor mockeado (`route.test.ts:102-122`). `commitSha` sacado con test negativo que lo mide **con la env presente** (`:145-166`). `cookie`/`referer`/`x-vercel-*` no cruzan, verificado por la ruta real (`proxy-headers.test.ts:96-113`). El cron va detrás de `verifyCronAuth`. `checkDelegationTrio` imprime el valor del flag (nombres de endpoints), nunca la key. `REJECTION_FAMILIES` —cuyos `blindSpot` describen cómo evadir la observación— no lo publica ningún endpoint. |
| 2 | **Error Handling** | **1 MNR** | `MNR-CR-6`. Fuera de eso: `fetchAgentCardHeaders` no lanza nunca por diseño y lo cumple (`route.ts:72-116`, `catch` + `finally clearTimeout`); Sentry envuelto en `try/catch` para que no tumbe la señal primaria (`:196-203`); el `finally { clearTimeout(timer) }` de CD-8 intacto (`forward-handler.ts:203-205`). |
| 3 | **Data Integrity** | **OK** | Cero escrituras: la HU no toca base de datos ni estado. `REVERSAL_WATCHLIST` y `UNATTRIBUTABLE_FAMILIES` se derivan de una sola fuente ⇒ no hay dos listas que puedan divergir (y medí que la versión a mano tampoco abriría un hueco, §2.1). `diffDelegation` compara conjuntos y ordena la salida (CD-16) ⇒ sin alarmas por orden de inserción. |
| 4 | **Performance** | **OK** | El endpoint de estado no hace I/O. El cron hace **un** `fetch` con timeout y corre 1×/día. El smoke hace **hasta 7 POST** al host, contado y documentado contra el límite medido del borde (11). Sin loops ni N+1. |
| 5 | **Integration** | **1 MNR** | `MNR-CR-5`. Compatibilidad hacia atrás: las 8 entradas históricas de la lista blanca conservan orden y `T-04` lo fija; `x-api-key` se conserva como alias muerto con su razón escrita; el mundo no-delegado (503) tiene test propio por primera vez (`delegation-off.test.ts`). Las citas cruzadas a `wasiai-a2a` verificadas una por una (§1). |
| 6 | **Type Safety** | **1 MNR** | `MNR-CR-7` (semántico, no de tipos). Cero `any` en el diff; `tsc --noEmit` limpio; `Record<DelegatedEndpoint, true>` fuerza exhaustividad de la unión; `fetchAgentCardHeaders` valida `typeof value === 'string'` antes de aceptar un nombre de header del card (no se inventa un header con un no-string). El `as unknown as SmokeModule` del test está justificado (`scripts/**` fuera del typecheck) y un rename de export rompería el test igual. |
| 7 | **Test Coverage** | **2 MNR** | `MNR-CR-1`, `MNR-CR-2`. Lo positivo, que es mucho: `proxy-headers.test.ts` mide el eslabón real sin mockear `forwardRequest`; los tests del smoke afirman sobre la salida que lee el operador y contienen negativos textuales (`not.toContain('el header no atraviesa el proxy')`); `delegation-off.test.ts` cubre el mundo apagado; `validate-env-delegation.test.ts` es el único control mecánico de un script que decide un `exit 1`. 807 tests verdes, medidos por mí. |
| 8 | **Scope Drift** | **OK** | 19 archivos fuera de `doc/sdd/**` = los 17 declarados en §4 + los 2 de test del fix-pack 1. Ninguna feature no pedida; ningún refactor no autorizado. El cambio a `CLAUDE.md` está declarado (ítem 17) y es el que CD-6 pide (`app.wasiai.io` = producción). |
| 9 | **Destructive Migrations** | **N/A** | La HU no toca SQL ni schema: cero archivos en `supabase/` o `migrations/` en el diff. |
| 10 | **RPC `SECURITY DEFINER`** | **N/A** | No se crea ni se modifica ninguna función de Postgres; no hay `supabase.rpc(...)` en el diff. |
| 11 | **Cache Invalidation** | **OK** | La única capa de cache que la HU introduce es la ausencia de una: `Cache-Control: no-store` en el endpoint de estado (`route.ts:116`), con test (`route.test.ts:133-136`) y con el motivo escrito —una respuesta de estado cacheada en el borde contestaría por un despliegue que no atendió, que es la familia de error que abrió la HU—. El cron es dinámico (lee `authorization`) y Next 16 no estatiza handlers GET. No hay claves de cache por usuario en juego (endpoint sin sesión, sin datos de tenant). |

---

## 5. Observaciones que **NO** son findings (calibración)

Las escribo para que se vea que las miré y las descarté, no que las olvidé.

1. **La línea `forward-key source` es forjable.** `wasiai-a2a/src/middleware/forward-key.ts:88-99`
   loguea `forwardSource` **antes** de validar la clave y con el valor que manda el caller; el propio
   código lo marca como *"informational only, no auth effect"*. O sea que el método de atribución #1
   del disparador de reversa marca qué `reqId` **dice** venir del proxy. No lo cuento como finding:
   requiere que un tercero forje deliberadamente el header contra el gateway, el repo del gateway está
   fuera de scope por CD-5, y para el uso previsto (contar tráfico propio en una ventana de 60 min)
   la medición sigue sirviendo. **Vale una línea en §13 si el fix-pack toca ese párrafo por otra razón.**
2. **`deploymentId` nunca se observó desde un despliegue real.** El docblock de la ruta
   (`route.ts:25-30`) afirma que es "lo único que distingue DOS DESPLIEGUES DEL MISMO COMMIT, que es
   exactamente la pregunta del cutover". La ruta no está desplegada en ningún ambiente todavía (el
   propio dev midió 404 en staging), así que esa propiedad está probada **sólo con `process.env`
   mockeado** (`route.test.ts:79`, `:151`). Si el proyecto no expone las system env vars de Vercel, el
   campo sale `null` y la pregunta del cutover se contesta igual por `host` + `declaredAs` +
   `vercelEnv`. No es finding porque el código maneja el `null` correctamente y hay test para eso
   (`:138-143`); **sí es algo para confirmar en el paso 2 del runbook** (la sonda al Preview), antes de
   apoyarse en ese campo.
3. **Literales de red repetidos en el smoke.** `'base-sepolia'` y `'eip155:84532'` van inline en el
   paso 4 (`:616`, `:633`) y en el paso 5 (`:668`, `:680`), mientras el resto de los literales del
   archivo son constantes exportadas y testeadas (`INVALID_CHAIN_SLUG`, `INVALID_CHAIN_ERROR_CODE`,
   los dos bodies). Un cambio de red de prueba obliga a tocar 4 lugares. Es un nit de consistencia: si
   se desincronizan, el smoke falla ruidosamente, no en silencio. No bloquea nada.
4. **`doc/sdd/_INDEX.md` tiene la fila de 077 SIN COMMITEAR** (`git status` ⇒ ` M`), diciendo
   `in progress (F1)` y apuntando a `fix/077-wkh-361-contracting-headers-passthrough`, rama que no
   existe. Es `MNR-it2-4` del AR it.2, **preexistente y de la fase DONE**: no lo cuento como hallazgo
   del Dev, tal como pidió el encargo. Lo anoto sólo porque estar sin commitear lo hace además
   perdible con cualquier `git checkout`. **También sin commitear**: `ar-report-it2.md` (untracked) y
   `contracts/cache/solidity-files-cache.json` (artefacto de build, ajeno a la HU).
5. **Un `403` del borde de Vercel satisfaría `GATEWAY_EXECUTED_STATUSES`** sin gateway ejecutado (ver
   §2.2). Sospecha no reproducible con los instrumentos que tengo ⇒ no es finding.

---

## 6. Instrumentos y límites

**Instrumentos usados** (todos con el exit code leído **antes** de cualquier pipe):

- `rtk proxy "npx vitest run --reporter=dot --silent"` — suite completa, sin redirección.
- `rtk proxy "npx tsc --noEmit"` · `rtk proxy "npx eslint . --max-warnings 0"`.
- `node --input-type=module -e '…'` con `fetchImpl` inyectado — para ejercitar `runSmoke` y las
  funciones puras del smoke **sin tocar la red**. Ni una sola petición salió a `app.wasiai.io`,
  a `wasiai-v2.vercel.app` ni al gateway durante este CR.
- **Worktree descartable** (`git worktree add … --detach` + symlink a `node_modules`) para las tres
  corridas de mutación de §2.1. Removido al terminar; `git worktree list` ⇒ sólo el árbol principal,
  y el working tree del repo quedó como estaba.
- Lectura directa del repo `wasiai-a2a` @ `e2f8d71` para las citas cruzadas.

**Instrumentos que fallaron acá** (para el próximo revisor):

- `npx vitest run --reporter=dot --silent <archivo>` ⇒ **error de parseo de vitest**: interpreta el
  archivo como valor de `--silent`. Hay que escribir `--silent=true <archivo>` o soltar `--silent`.
- `node -e '…'` con literales entre comillas simples dentro de un script bash entre comillas simples:
  el `'` interno **cierra el string** y el script corre truncado (me devolvió un "no encontré la
  familia" que era falso). Solución usada: `String.fromCharCode(39)`.
- `VAR=valor` **después** del script en `node -e '…' VAR=valor` no setea nada: entra como `argv`. La
  variable quedó `undefined` y el error apuntaba a un path inexistente.
- Confirmados los 4 del encargo: no usé pipes dentro de `rtk proxy`, no redirigí dentro de
  `rtk proxy`, no redirigí `vitest` a un archivo bajo el hook, y no usé `cat` para citar.

**Límites declarados de este CR**:

1. **Sin consola de Vercel**: no pude medir el `maxDuration` efectivo del cron (`MNR-CR-6`), ni con
   qué `Host` invoca Vercel el cron en cada proyecto (`MNR-CR-5`, TBD-3), ni si el 5.º cron entra en
   el plan (TBD-2). Los tres quedan como mediciones del post-deploy, con el procedimiento ya escrito
   en el expediente para el primero de ellos.
2. **Nada desplegado**: ningún ambiente sirve todavía `GET /api/v1/status/delegation`, así que el
   comportamiento de W2 está medido **sólo** en tests. Es lo esperable en CR y el runbook lo cubre
   (paso 2: sondear el Preview antes de promover).
3. **No re-litigo lo cerrado**: los 7 hallazgos del AR it.1 y los 7 del AR it.2 los di por cerrados
   tras verificar el diff que los cierra; no los volví a listar (regla anti-duplicación). Sí re-medí
   sus consecuencias cuando el fix tocaba código que reviso acá.

---

## 7. Orden sugerido para el Dev (ninguno bloquea el gate)

1. `MNR-CR-2` — 5 minutos, y es el que se lee en cada corrida de la suite.
2. `MNR-CR-1` — el instrumento se va a correr en el cutover; conviene que no pueda decir OK sobre una
   pata que no se midió.
3. `MNR-CR-7` — rename + dos líneas de docblock.
4. `MNR-CR-3`, `MNR-CR-4` — mantenibilidad del archivo que más va a crecer.
5. `MNR-CR-5`, `MNR-CR-6` — se cierran con las mediciones del post-deploy que ya están planificadas.
