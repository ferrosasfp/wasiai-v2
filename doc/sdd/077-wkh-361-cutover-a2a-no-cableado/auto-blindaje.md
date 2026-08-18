# Auto-Blindaje — #077 [WKH-361]

Un bloque por error REAL cometido durante F3. Si no hubo errores, este archivo
no existe.

---

### [2026-08-18 14:16] Wave 2 — `vi.mock` referenció un `const` del archivo y explotó al colectar

- **Error**: `src/app/api/v1/status/delegation/__tests__/route.test.ts` definía
  `const A2A_URL` / `const FORWARD_KEY` arriba y los usaba dentro de la factory
  de `vi.mock('@/lib/env', …)`. El archivo entero falló al colectar con
  `ReferenceError: Cannot access 'A2A_URL' before initialization`, reportando
  `Tests: no tests`.
- **Causa raíz**: `vi.mock` se **hoistea por encima de todas las declaraciones**
  del archivo. Cuando corre la factory, los `const` del módulo todavía están en
  su zona muerta temporal. El exemplar que el Story File cita (§6.4,
  `forward-handler.test.ts:8-15`) no lo mostraba porque ahí los valores están
  **inline** dentro de la factory, no en variables.
- **Fix**: mover los valores a `vi.hoisted(() => ({ … }))` y que la factory lea
  de ahí; los alias `const A2A_URL = secrets.A2A_URL` quedan para los `expect`.
  Es el mismo patrón que ya usa
  `src/app/api/cron/__tests__/process-refunds.test.ts:7-9` para los spies.
- **Aplicar en**: cualquier test nuevo de esta HU que quiera parametrizar el
  mock de `@/lib/env` — el del cron de W2 y cualquier futuro. Si un archivo de
  test reporta `Tests: no tests` en vez de un fallo de aserción, sospechar del
  colectado, no del caso.
- **Cómo lo detecté**: corriendo el archivo solo *antes* de seguir escribiendo.
  Un `npm test` completo lo habría mostrado igual, pero mezclado con 86 archivos
  verdes.

---

### [2026-08-18 14:12] Wave 1 — importé `vi` dos veces en el mismo archivo

- **Error**: `src/lib/proxy/__tests__/delegation-off.test.ts` quedó escrito con
  `import { describe, it, expect } from 'vitest'` arriba y un segundo
  `import { vi } from 'vitest'` más abajo, después del `vi.mock`.
- **Causa raíz**: escribí el `vi.mock` antes que el bloque de imports pensando
  en el orden de ejecución (que efectivamente se hoistea) y después agregué el
  import que faltaba en el lugar donde el ojo lo pedía, no donde el módulo lo
  admite.
- **Fix**: un solo `import { describe, it, expect, vi } from 'vitest'` al tope.
- **Aplicar en**: cualquier archivo de test nuevo que empiece por el `vi.mock`.
  Que `vi.mock` se hoistee NO significa que el resto del archivo también.
- **Cómo lo detecté**: releyendo antes de correr. **El lint no lo habría
  atajado**: `eslint.config.mjs` no tiene `no-duplicate-imports` activo, así que
  esto es un caso donde la única red es leer.

---

### [2026-08-18 14:16] Wave 2 — escribí una aserción que era una bomba de tiempo, no un control

- **Error**: en el test de "no filtrar el secreto" puse
  `expect(serialized).not.toContain(String(FORWARD_KEY.length))`, o sea buscar
  el substring `"31"` en el JSON de la respuesta.
- **Causa raíz**: traduje literalmente el "ni su longitud" del Story File a una
  búsqueda de substring, sin preguntarme qué OTRA cosa del body puede contener
  esos dígitos. La respuesta trae `checkedAt` en ISO 8601: cualquier día 31, o
  cualquier milisegundo que contenga "31", habría puesto el test en rojo sin que
  nada estuviera mal. Un flake que aparece un día de cada treinta es peor que no
  tener el test: enseña a re-correr la suite hasta que pase.
- **Fix**: verificar la FORMA en vez del substring — que `config` tenga
  exactamente dos claves y que las dos sean `boolean`. Un booleano no puede
  filtrar una longitud.
- **Aplicar en**: toda aserción `not.toContain(<número>)` sobre un cuerpo que
  incluya una marca de tiempo, un `requestId` o un hash. Antes de escribirla:
  ¿qué input hace que esto falle sin que exista el bug?
- **Cómo lo detecté**: releyendo la aserción antes de correrla. La suite habría
  pasado **hoy** (2026-08-18) y habría quedado sembrada.

---

### [2026-08-18 20:35] Wave 2 — la mitad "obvia" de la terna de contracting da FALSO VERDE

- **Error**: casi escribo el paso 3 del smoke con un solo control —
  "¿la respuesta con `x-a2a-contracting-depth:99` es distinta de la respuesta sin
  el header?"— que es como está redactada la intuición en §2.2 del Story File
  ("(2) y (3) son la misma respuesta").
- **Causa raíz**: **no son byte-idénticas.** El gateway mete un `requestId`
  distinto en cada respuesta. Medido hoy contra `app.wasiai.io`, con el defecto
  todavía vivo:
  ```
  2 app.wasiai.io depth:99   -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"8d46cf09-…"}
  3 app.wasiai.io SIN header -> 400 {"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"cd52c61d-…"}
  ```
  Un check de igualdad estricta las declara "distintas" y **reporta que el
  header llegó cuando no llegó**. El propio Story File dice que esos `requestId`
  distintos sirven para descartar caché — el mismo campo que sirve para una cosa
  arruina la otra.
- **Fix**: el paso 3 exige **las dos** condiciones, y la que decide es la
  segunda: distintas **y** la del header contiene `CONTRACTING_DEPTH_EXCEEDED`.
  Está fijado por el test
  `'terna de contracting: distintas pero sin el error_code esperado ⇒ falla'`
  (`src/lib/proxy/__tests__/smoke-delegation.test.ts`), que usa dos bodies que
  difieren SÓLO en el `requestId`.
- **Aplicar en**: toda comparación de dos respuestas HTTP del gateway. Antes de
  usar igualdad, listar qué campos cambian en cada llamada por diseño
  (`requestId`, timestamps, nonces). La terna de `x-payment-chain` no tiene este
  problema porque compara `accepts[0]`, que no lleva campos volátiles — por eso
  ahí sí la igualdad discrimina, y por eso hay que compararlo **completo** y no
  un campo suelto.
- **Cómo lo detecté**: corriendo el smoke contra `app.wasiai.io` de verdad y
  leyendo POR CUÁL de las dos ramas cayó. Cayó por la segunda. Si hubiera
  escrito sólo la primera, el smoke habría dicho "paso 3 OK" sobre un defecto
  vivo — el mismo falso verde que esta HU cura.

---

### [2026-08-18 15:12] Fix-pack AR — escribí un byte de control CRUDO en un archivo fuente

- **Error**: en `src/lib/proxy/__tests__/validate-env-delegation.test.ts` puse
  `.replace(/\x1b\[[0-9;]*m/g, '')` para sacar los colores ANSI. Lo que quedó en
  disco **no fue la secuencia `\x1b` de 4 caracteres: fue el byte 0x1B literal**.
  `npm run lint` falló con `Unused eslint-disable directive
  (no problems were reported from 'no-control-regex')`, o sea que el disable que
  había puesto por las dudas era mentira y la regla ni siquiera está activa.
- **Causa raíz**: doble. (a) Asumí que `no-control-regex` estaba activo y puse un
  `eslint-disable` *preventivo* — un disable que no desactiva nada es ruido que
  el lint marca como warning, y con `--max-warnings 0` eso es rojo. (b) No
  verifiqué qué BYTES quedaron en disco: el `Edit` posterior falló con "String to
  replace not found" mostrando en pantalla exactamente el texto que yo pasaba, y
  recién `python3 -c print(repr(...))` mostró el `\x1b` real.
- **Fix**: `const ANSI = new RegExp(\`${String.fromCharCode(27)}\\[[0-9;]*m\`, 'g')`.
  Sin byte de control en el fuente, sin `eslint-disable`. Y una aserción que
  vuelve falsable lo que el helper afirma:
  `expect(out.text()).not.toContain(String.fromCharCode(27))` — sin ella, el
  helper podía dejar de limpiar y ningún test se enteraba.
- **Aplicar en**: cualquier escape en un literal (`\x`, `\u`, `\0`) escrito con
  una herramienta de edición. Si un `Edit` falla contra un texto que se ve
  idéntico en pantalla, **mirar los bytes** (`repr()`), no volver a intentar. Y
  nunca poner un `eslint-disable` "por las dudas": o lo pide una regla que falló,
  o no va.
- **Cómo lo detecté**: `npm run lint`, que es parte de `npm run qa`. Un `npm test`
  verde no lo habría mostrado nunca.

---

### [2026-08-18 15:05] Fix-pack AR — casi publico un número medido con un off-by-one

- **Error**: escribí en el docblock del smoke "medido: 12 POST seguidos a
  `/compose` alcanzan para disparar el 429". Mi propia medición decía otra cosa:
  los 10 primeros pasaron y **el 11.º** fue el primer `429`.
- **Causa raíz**: conté los CASOS de mi script de medición (12 filas) en vez de
  las PETICIONES POR HOST hasta el primer rechazo. Cada fila pega a dos hosts, y
  el rate limit es por host: dos unidades distintas sumadas como si fueran la
  misma.
- **Fix**: el docblock dice ahora "los 10 primeros POST seguidos pasaron y el
  11.º ya devolvió 429", y agrega el dato que hace accionable al número: el smoke
  hace 5 POST a `/compose`, o sea que está por debajo, **pero dos corridas
  encadenadas no**.
- **Aplicar en**: todo número que se copie de una salida propia. Antes de
  escribirlo: ¿qué unidad estoy contando, y es la misma que la del sistema que
  impone el límite? Un número con la unidad equivocada envejece peor que ninguno,
  porque parece medido.
- **Cómo lo detecté**: releyendo la salida cruda de la medición antes de commitear
  la prosa, no la prosa contra sí misma.

---

### [2026-08-18 15:20] Fix-pack AR — heredé una afirmación de infraestructura sin medirla

- **Error**: el docblock de `status/delegation/route.ts` justificaba exponer
  `deploymentId` + `commitSha` diciendo que eran "datos de despliegue que Vercel
  ya publica por su cuenta". Al decidir el `MNR-4` del AR me apoyé en esa frase
  por un rato: si Vercel ya los publica, exponerlos no agrega nada.
- **Causa raíz**: la frase venía del Story File y la traté como medida. **Es
  falsa para el `dpl_…`**: medido el 2026-08-18 con
  `curl -sSD - https://app.wasiai.io/api/v1/capabilities`, lo que Vercel manda sin
  auth es `x-vercel-id: iad1::iad1::glws9-…`, un id de **petición**, no de
  despliegue. Ni `dpl_` ni el commit aparecen en ninguna cabecera.
- **Fix**: la justificación de `deploymentId` pasó a apoyarse en tres razones que
  sí se sostienen (distingue dos despliegues del mismo commit, es la evidencia
  declarada de AC-6, y es opaco sin credencial de Vercel), y la frase falsa está
  corregida **en los dos lugares** donde vivía: el docblock y `story-file.md` §5.2.
  `commitSha` se sacó.
- **Aplicar en**: toda frase de la forma "esto ya es público / esto ya lo hace la
  plataforma" que aparezca en una justificación de seguridad. Es exactamente el
  tipo de premisa que decide un finding y que nadie vuelve a medir. Se mide con
  un `curl -sSD -` antes de apoyarse en ella.
- **Cómo lo detecté**: porque la decisión de `MNR-4` dependía de esa premisa y la
  regla es medir la PRECONDICIÓN, no la consecuencia. Si la daba por buena,
  dejaba los dos campos y escribía una justificación falsa en el docblock.

---

### [2026-08-18 14:58] Fix-pack AR — el `grep -n` filtrado me devolvió los matches SIN su archivo:línea

- **Error**: usé `grep -n 'env.ts:75-86\|env.ts:' .env.example scripts/validate-env.js …`
  para ubicar la cita rota del `MNR-1`. La salida filtrada mostró **1 match en 1
  archivo**, con el número de línea pegado a un fragmento y sin el nombre del
  archivo — cuando en realidad la cita estaba **duplicada en dos archivos**
  (`.env.example:115` y `scripts/validate-env.js:179`), que es justamente lo que
  el AR advertía: "arreglar uno solo deja el otro podrido".
- **Causa raíz**: el hook de `rtk` reformatea la salida de `grep` en un resumen
  agrupado y **deduplica**. Es el mismo mecanismo que le borró 6 líneas a `cat`
  en el AR, en otra herramienta.
- **Fix**: todas las búsquedas de este fix-pack se hicieron con
  `rtk proxy "grep -n …"` (salida cruda) o con la herramienta `Read`. Ninguna cita
  `archivo:línea` de este fix-pack sale de un `grep` filtrado.
- **Aplicar en**: cualquier búsqueda cuyo resultado se vaya a convertir en una
  cita, en un conteo, o en un "no hay ninguno". El filtro está pensado para
  ahorrar tokens de lectura, no para ser un instrumento de medición. ⚠️ Y ojo:
  `rtk proxy "cmd | pipe"` **rompe el pipe** (el AR ya lo había reportado): dentro
  de `rtk proxy` va un comando solo, sin tuberías.
- **Cómo lo detecté**: el resultado no cerraba con lo que el AR decía (él citaba
  dos archivos, yo veía uno). Re-medí con `rtk proxy` y aparecieron los dos.

---

### [2026-08-18 15:35] Fix-pack AR — el MISMO off-by-one, otra vez, en el mismo docblock

- **Error**: después de corregir "12 POST" por "el 11.º", escribí en la línea de
  al lado "el smoke hace 5 POST a `/compose`, así que está por debajo". Conté los
  POST de la corrida que **acababa de ver** contra `app.wasiai.io` — donde el
  paso 2 salió OMITIDO porque el endpoint de estado todavía no está desplegado.
  Con el paso 2 corriendo son **6 a `/compose` + 1 a `/orchestrate`**.
- **Causa raíz**: conté sobre una corrida DEGRADADA y la reporté como si fuera la
  normal. Es la misma familia de error que el bloque anterior (contar la unidad
  equivocada), cometida **veinte minutos después de escribirlo**, lo cual dice
  algo sobre cuánto sirve documentar una lección sin un instrumento.
- **Fix**: el docblock enumera de dónde sale cada POST (1 del paso 2, 2 del 3, 2
  del 4, 1 del 4b, más 1 a `/orchestrate`) en vez de dar un total suelto. Un
  número que se puede re-derivar leyendo la lista no se puede equivocar en
  silencio.
- **Aplicar en**: todo conteo tomado de una corrida propia. Preguntarse **qué
  ramas NO se ejecutaron en esa corrida** antes de convertirla en el número
  general. Una corrida donde algo salió OMITIDO/INCONCLUSO no es la corrida
  típica: es justo la que subestima.
- **Cómo lo detecté**: re-derivando el número desde el código (contando los
  `readResponse` por paso) en vez de confiar en la salida que tenía a la vista.

---

### [2026-08-18 15:50] Fix-pack AR — afirmé una AUSENCIA después de mirar dos archivos

- **Error**: escribí —en el código, en `story-file.md` y en el mensaje del commit
  `a071b6131` (era `575ebd307` antes del `reword` del fix-pack it.2, ver el último
  bloque)— que `CHAIN_NOT_SUPPORTED` es invisible en los logs porque "el
  gateway no tiene `onSend` ni `setErrorHandler` global que loguee el body". Lo
  había "medido" con un `grep` sobre **dos archivos**: `src/index.ts` y
  `src/lib/logger.ts`. Salió vacío y lo tomé por un "no existe".
- **Causa raíz**: una afirmación de ausencia se prueba sobre TODO el universo, no
  sobre donde uno esperaría encontrarla. Grepeando `src/` entero aparecieron
  **los dos**: `setErrorHandler` en `middleware/error-boundary.ts:72` y un
  `onResponse` en `middleware/event-tracking.ts:111` que además **cubre
  `/compose`** y escribe en `a2a_events`.
- **Fix**: la conclusión aguanta —el `setErrorHandler` sólo atrapa excepciones
  lanzadas y esto es un `reply.send` normal; el `onResponse` graba `statusCode` y
  `requestId` pero **nunca el `error_code`**, así que un 400 de slug inválido y
  uno de validación de body son la misma fila— pero **la razón que había escrito
  era falsa**. Ahora los dos ganchos están nombrados con su cita y con por qué no
  alcanzan. Una conclusión correcta apoyada en una premisa falsa se cae sola la
  próxima vez que alguien la verifique.
- **Aplicar en**: toda frase de la forma "no existe / no hay / nadie lo hace". El
  grep que la sostiene tiene que ser sobre el árbol completo y **hay que decir
  cuál fue**. Si el resultado es vacío, sospechar del alcance antes que del
  sistema.
- **Cómo lo detecté**: releyendo mis propias afirmaciones antes de cerrar, con la
  pregunta "¿qué grep hice exactamente para poder decir esto?".

---

### [2026-08-18 16:05] Fix-pack it.2 — declaré EXHAUSTIVA una lista de los dos casos que había visto

- **Error**: la guarda de INCONCLUSO del smoke enumeraba `503 *_DISABLED` y `429`,
  y el docblock lo escribía como un hecho: *"hay **dos** estados del ambiente en
  los que…"*. Hay al menos cuatro: el propio proxy genera `504 GATEWAY_TIMEOUT`
  (`forward-handler.ts:186-190`) y `502 UPSTREAM_ERROR` (`:168-179` / `:198-201`)
  **sin que el gateway ejecute nada**, y con cualquiera de las dos el smoke
  volvía a escupir, palabra por palabra, la acusación falsa que ese mismo
  fix-pack había cerrado.
- **Causa raíz**: enumeré los estados que **había producido en mis pruebas** y
  cerré la lista. Peor: los dos que faltaban los generaba **el código de este
  repo, a 40 líneas del que estaba tocando** — no hacía falta ningún ambiente
  raro, sólo leer la función que el smoke atraviesa. Y el más probable de todos
  durante el cutover, porque el runbook corre el smoke con la lambda fría.
- **Fix**: invertir el criterio. La guarda ya no pregunta "¿es uno de los estados
  malos?" sino "¿esta respuesta PRUEBA que se ejecutó en el gateway?"
  (`GATEWAY_EXECUTED_STATUSES` = 400/402/403). El default pasó de **acusar** a
  **no se pudo medir**, así que un estado que nadie enumeró ya no puede fabricar
  una acusación falsa. `T-FP2-3` barre 418/500/404/503/302 para fijarlo.
- **Aplicar en**: toda guarda escrita como lista de casos malos. Preguntarse
  **qué produce el sistema propio** (no el ajeno) que no esté en la lista, y si
  se puede reemplazar por una precondición positiva. Una lista de estados malos
  envejece con cada rama nueva de error; una precondición positiva, no.
- **Cómo lo detecté**: me lo reportó el AR. Lo que yo no hice fue leer
  `forwardRequest` entera antes de escribir "hay dos estados": la respuesta
  estaba en el archivo que el propio docblock citaba.

---

### [2026-08-18 16:20] Fix-pack it.2 — reciclé una justificación para una rama que no cubría

- **Error**: el docblock justificaba el exit 0 ante inconclusos con "el caso
  'debería delegar y no delega' lo cazan antes el paso 2 o el paso 6". Era cierto
  para la rama `503 *_DISABLED`, y **lo dejé escrito igual después de agregar la
  rama `429`**, donde es falso: con un 429 la aserción del paso 2 ("no es
  `*_DISABLED`") se satisface **vacuamente** y el paso 6 sólo lee datos del env.
  Resultado: `paso 2 OK` sobre un 429, los tres headers del camino del dinero
  medidos **cero veces**, y el proceso saliendo **0**.
- **Causa raíz**: al agregar un caso nuevo a una función, heredé la justificación
  del caso viejo sin re-derivarla para el nuevo. La justificación era una frase
  en prosa, así que nada se puso rojo cuando dejó de ser cierta.
- **Fix**: (a) el paso 2 pasa por la misma guarda positiva, así que ya no puede
  decir OK sobre lo que no midió; (b) `decideVerdict()` —pura y exportada— decide
  el exit code, y sale **1** cuando el ambiente DECLARA delegar y quedó algo sin
  medir. Las cuatro combinaciones tienen test (`T-FP3-1`).
- **Aplicar en**: cada vez que se agrega una rama a una función que tiene una
  justificación escrita. Releer la justificación **con la rama nueva puesta**, y
  si sigue valiendo, escribir por qué. Vale también para los `switch` y para todo
  `default:` que hereda el comentario del caso anterior.
- **Cómo lo detecté**: me lo reportó el AR, con la corrida exacta que lo produce.

---

### [2026-08-18 16:40] Fix-pack it.2 — un `null` que AFIRMA, y un test que certificaba la afirmación

- **Error**: las 4 familias `CONTRACTING_*` tenían `blindSpot: null`, campo cuya
  semántica documentada es "no hay punto ciego". Sí lo hay: su rechazo **no se
  puede atribuir al proxy**, porque `contractingGuardHandler` corta la cadena de
  preHandlers antes de que `requireForwardKey()` emita la línea de origen. Y
  `T-FP-4` —el test que yo mismo escribí para que ninguna familia quedara sin
  declarar— **certificaba** ese `null`, porque hacía el XOR contra
  `railwayLogLine` **sola**.
- **Causa raíz**: modelé UNA pregunta ("¿se ve el `error_code` en los logs?") y
  la usé para responder DOS ("¿y se puede atribuir al proxy?"). Un campo que
  puede valer `null` afirma algo cuando vale `null`; si el invariante que lo
  vigila sólo mira una de las dos dimensiones, el test **le da respaldo a la
  afirmación falsa** en vez de cazarla.
- **Fix**: campo `proxyAttribution: 'reqId' | 'unavailable'` separado del de los
  logs, los 4 `blindSpot` escritos, `UNATTRIBUTABLE_FAMILIES` derivada (no a
  mano), y `T-FP-4` convertido en **bicondicional**: hay punto ciego escrito si y
  sólo si falta la línea de log **o** falta la atribución. Medido: con los 4
  `blindSpot` de vuelta en `null`, `T-FP-4` da rojo; en `10f63ac80` ese mismo
  estado estaba verde.
- **Aplicar en**: todo campo `X | null` donde `null` signifique "no hay
  problema". Preguntar **cuántas preguntas distintas** puede responder ese `null`
  y si el invariante las cubre a todas. Un guard que mira una dimensión de dos
  no es medio guard: es un guard que **firma** la dimensión que no mira.
- **Cómo lo detecté**: me lo reportó el AR. Yo verifiqué sus dos premisas por mi
  cuenta antes de moverme (`compose.ts:909` vs `:912`, y el `reply.status(400)`
  de `contracting-guard.ts:116`), y las dos eran exactas.

---

### [2026-08-18 16:55] Fix-pack it.2 — declaré una deuda impagable sobre una premisa que nunca medí

- **Error**: en it.1 escribí que corregir el mensaje del commit `575ebd307` era
  impagable porque "altera historia publicada". Medido ahora:
  `git ls-remote --heads origin feat/077-headers-proxy` ⇒ **vacío**, y
  `git branch -vv` no muestra upstream. **La rama nunca estuvo publicada.** Un
  `rebase --reword` local no alteraba historia de nadie y costaba cero.
- **Causa raíz**: es textualmente el patrón que yo mismo había escrito dos
  bloques más arriba —*"toda frase de la forma 'esto ya es público' es el tipo de
  premisa que decide un finding y que nadie vuelve a medir"*— aplicado a una
  decisión propia, veinte minutos después. Documentar una lección no la aplica.
- **Fix**: `reword` hecho (con `GIT_SEQUENCE_EDITOR` + `GIT_EDITOR`, sin `-i`
  interactivo). El árbol quedó **idéntico**: `git rev-parse <viejo>^{tree}` y
  `<nuevo>^{tree}` dan el mismo SHA, y `git diff` entre los dos commits sale
  vacío. **Remapeo de hashes** (lo viejo sigue vivo en el reflog):

  | antes | después |
  |---|---|
  | `575ebd307` | `a071b6131` |
  | `f1934db5a` | `0a14b8260` |
  | `a51118378` | `dcf5a49f0` |
  | `2a72a2ff1` | `066175bbc` |
  | `6c506178f` | `3b0977ddb` |
  | `4e306d5ce` | `03a5d28b4` |
  | `6ff54be3d` | `aa0a5183d` |

  ⚠️ **Un `reword` rompe toda cita al hash de los commits que le siguen.** La
  única cita en el expediente era la de este archivo (`575ebd307`) y quedó
  actualizada; `ar-report-it2.md` cita `6ff54be3d` y `a3d333928` y **no se toca**,
  porque es el artefacto congelado del revisor: `a3d333928` sigue siendo válido
  (es anterior al `reword`) y el otro está en esta tabla.
- **Aplicar en**: antes de declarar una deuda impagable, **medir la precondición
  que la vuelve impagable**, no la consecuencia. Y si la premisa es "ya es
  público", el comando que lo decide es `git ls-remote`, no la intuición. La
  ventana se cierra en el primer `git push`.
- **Cómo lo detecté**: me lo reportó el AR, que corrió el `ls-remote` que yo no
  corrí. Lo re-medí antes de tocar nada.

---

### [2026-08-18 17:10] Fix-pack it.2 — mi verificación contó el tipo como si fuera un dato

- **Error**: al aplicar el campo nuevo, mi script de edición abortó con
  `AssertionError` porque contó **3** apariciones de `proxyAttribution: 'reqId'`
  cuando había 2 entradas. La tercera era la **declaración del tipo**
  (`proxyAttribution: 'reqId' | 'unavailable'`), que contiene la cadena buscada
  como prefijo.
- **Causa raíz**: conté por subcadena sobre un archivo donde el tipo y los datos
  comparten el literal. La herramienta de medición fabricó una discrepancia que
  no existía; si el assert hubiera sido `>= 2` en vez de `== 2`, habría pasado
  desapercibido y yo habría "confirmado" un conteo falso.
- **Fix**: contar con la indentación del dato (`"    proxyAttribution: 'reqId',"`,
  con la coma final), que la declaración del tipo no tiene. Los tres asserts del
  script (`4` inatribuibles, `2` atribuibles, `1` `blindSpot: null` restante)
  quedaron exactos.
- **Aplicar en**: todo conteo por subcadena sobre un archivo TypeScript donde
  conviven el tipo y sus instancias. Anclar por indentación o por el separador
  final antes de convertir un conteo en una verificación.
- **Cómo lo detecté**: el propio assert. Es el argumento para que los scripts de
  edición afirmen conteos EXACTOS: si hubiera usado `replace` a secas, el error
  habría entrado en silencio.

---

### [2026-08-18 17:35] Fix-pack it.2 — arreglé el comportamiento y dejé el `--help` afirmando el viejo

- **Error**: después de que `decideVerdict` hiciera que un INCONCLUSO **sí**
  cambie el exit code cuando el ambiente declara delegar, el texto de `USAGE`
  —lo que ve el operador al correr el script sin argumentos— seguía diciendo
  *"INCONCLUSO no cambia el exit code"*. Actualicé el docblock del archivo y no
  el mensaje de ayuda, que es el único de los dos que el operador lee.
- **Causa raíz**: la misma afirmación vivía en DOS lugares (docblock + `USAGE`) y
  sólo uno estaba cerca de la línea que cambié. Ningún test compara el `USAGE`
  con la conducta: es una constante de strings.
- **Fix**: `USAGE` reescrito con la regla completa (1 si el ambiente declara
  delegar, 0 si no).
- **Aplicar en**: todo cambio de conducta en un script con `--help`/`USAGE`
  propio. `grep` de la frase vieja por el repo **antes** de dar por cerrado el
  cambio: si la conducta estaba escrita en prosa, está escrita más de una vez.
- **Cómo lo detecté**: corriendo el script de verdad (`node
  scripts/smoke-delegation.mjs`, sin argumentos) en vez de sólo el test que lo
  importa. El runner de tests no imprime el `USAGE` completo, y el ojo lo lee
  entero sólo cuando sale por la terminal.
