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
