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
