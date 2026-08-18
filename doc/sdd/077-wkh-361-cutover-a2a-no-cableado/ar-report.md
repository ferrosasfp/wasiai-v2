# AR — Adversarial Review · #077 [WKH-361]

**Rama auditada**: `feat/077-headers-proxy` (`6a7937680`), base `main` = `b55871347`
**Repo**: `wasiai-v2` (PÚBLICO — `gh repo view` ⇒ `"visibility":"PUBLIC"`)
**Upstream medido**: `wasiai-a2a` @ `10a6eb1` (`git rev-parse HEAD` verificado, ver §Instrumentos)
**Fecha**: 2026-08-18
**Veredicto**: **RECHAZADO — 1 `BLQ-MED` + 1 `BLQ-BAJO` activos**

> Nomenclatura CD-6: `wasiai-prod` / `app.wasiai.io` es el proyecto Vercel de producción;
> `wasiai-v2` / `wasiai-v2.vercel.app` es staging. Nunca "producción" a secas.

---

## 0. Lo que verifiqué de lo que el Dev declara (no lo heredé)

| Declarado por el Dev | Medido por mí | ¿Coincide? |
|---|---|---|
| `Test Files` 87, `763 passed \| 5 skipped` | `86 passed \| 1 skipped (87)` · `763 passed \| 5 skipped (768)` | **Sí** |
| `npm run qa` exit 0 | `tsc --noEmit` exit 0 · `eslint . --max-warnings 0` exit 0 · `vitest run` exit 0 | **Sí** |
| 32/32 en `forward-handler.test.ts` | `✓ … (32 tests) 47ms` | **Sí** |
| Cada archivo de test nuevo se ejecuta | los 6 aparecen con `✓` y su conteo en la salida por archivo | **Sí** |
| "18 archivos tocados" | `git diff --name-only` ⇒ **21** (17 código/config + 4 `.md` del expediente) | reconcilia (17 + la fila `doc/sdd/077-…/` de §4 = 18). Sin drift. |
| `(4)==(5)` y `(4)==(6)` por `app.wasiai.io` | `accepts[0]` byte-idéntico con y sin `x-payment-chain: base-sepolia` ⇒ `EQUAL=true` | **Sí** |
| El gateway directo discrimina | `eip155:84532 / "1010"` con header vs `eip155:2368 / "1010000000000000"` sin él | **Sí** |
| Smoke contra `app.wasiai.io` ⇒ exit 1, 3 problemas, paso 5 OK | reproducido idéntico | **Sí** |
| DT-7: el card declara 2 headers y **no** `x-payment-chain` | `contracting` = `{depthMax, chainHeader, depthHeader, bestEffortNote}`; `JSON.stringify(card).includes('x-payment-chain')` ⇒ `false` | **Sí** |

**El defecto que la HU cura sigue vivo en `wasiai-prod` / `app.wasiai.io` al momento de este AR**
(medido, no supuesto): `POST /api/v1/compose` + `x-payment-chain: base-sepolia` devuelve
`402` con `accepts[0].network = "eip155:2368"` y `maxAmountRequired = "1010000000000000"` (18
decimales). El mismo request contra el gateway devuelve `eip155:84532` / `"1010"`.

---

## 1. Mutación — ¿los candados muerden?

Corridas sobre un `git worktree` desechable (nunca sobre el árbol del Dev). Todas revertidas.

| # | Mutante | Resultado | Tests que lo mataron |
|---|---|---|---|
| M1 | quitar la entrada `x-payment-chain` de la lista blanca | **KILLED** (3 rojos) | `T-01b`, `T-04`, `T-05` |
| M2 | agregar `cookie` a la lista blanca | **KILLED** (3 rojos) | `AC-7/T-03`, `T-04`, `T-05` |
| M3 | agregar una **2ª** entrada con `consumer:'none'`/`citation:null` | **KILLED** (2 rojos) | `T-04`, **`T-04b`** |
| M4 | el cron devuelve `200` en vez de `500` ante drift + `WARN` pasa a contar como drift | **KILLED** (8 rojos) | todo `T-07`/`T-07b`/`T-09`/`T-09b` |
| M5 | borrar la 2ª condición de `evaluateContractingTerna` (`includes('CONTRACTING_DEPTH_EXCEEDED')`) | **KILLED** | `'terna de contracting: distintas pero sin el error_code esperado ⇒ falla'` |
| M6 | borrar la 2ª condición de `evaluatePaymentChainTerna` (`withAccept === withoutAccept`) | **KILLED** | `'terna de x-payment-chain: el defecto real medido el 2026-08-18 se detecta'` |

**M3 responde el punto 8 del encargo**: el test de `x-api-key` **sí muerde**.
**M5/M6 responden el punto 2**: el arreglo del falso verde del auto-blindaje está fijado por
un test que discrimina de verdad, no por prosa.

### Sonda propia: ¿el header sobrevive la reconstrucción de `compose/route.ts`?

`src/app/api/v1/compose/route.ts:60-69` **reconstruye** el `NextRequest` antes de forwardear, y
`src/app/api/v1/compose/__tests__/proxy.test.ts:24` **mockea `forwardRequest`** — o sea, ningún
test del repo ejercita ese eslabón. Escribí una sonda que replica la reconstrucción exacta:

```
AR-PROBE headers enviados = {"x-wasiai-forward-key":"…","x-wasiai-source":"v2-proxy",
 "content-type":"application/json","x-a2a-contracting-chain":"a.example",
 "x-a2a-contracting-depth":"7","x-payment-chain":"base-sepolia"}
```

**Los tres pasan y `cookie` NO pasa.** El fix funciona punta a punta por el endpoint que cuesta
plata. Sin defecto ⇒ no es finding; el hueco de cobertura queda como `MNR-5`.

---

## 2. Hallazgos, ordenados por prioridad de fix-pack

### 🔴 `BLQ-MED-1` — El radio de impacto declarado y el disparador de reversa cubren 2 de 6 familias de rechazo nuevas

- **Categoría**: Integration (backwards compatibility) · Error Handling
- **Archivo:línea**: `doc/sdd/077-…/story-file.md:873-877` (tabla "Lo que cambia de status en el
  camino de dinero vivo") y `story-file.md:887-889` (disparador de reversa).
  Origen del cambio de comportamiento: `src/lib/proxy/passthrough-headers.ts:127-138`.
- **Qué está mal**: la tabla declara **3** filas y las 3 son de `x-payment-chain`
  (el arreglo, `(b)` slug inválido ⇒ `400 CHAIN_NOT_SUPPORTED`, `(c)` red sin saldo ⇒
  `403 INSUFFICIENT_BUDGET`). El disparador de reversa vigila **exactamente esos dos códigos**:

  > "si aparecen … respuestas `CHAIN_NOT_SUPPORTED` o `INSUFFICIENT_BUDGET` con
  > `x-wasiai-source: v2-proxy` que no existían antes, se ejecuta la reversa."

  Pero admitir `x-a2a-contracting-chain` y `x-a2a-contracting-depth` abre **cuatro familias
  más** de `400` que hoy son inalcanzables desde `app.wasiai.io` porque el proxy las descarta.

- **Reproducción** (medida hoy, sin mover fondos — todo corta en `400`/`402`):

  | Request (body `{"steps":[{"agent":"wasi-chainlink-price"}]}`) | `app.wasiai.io` HOY | gateway (= lo que pasará) |
  |---|---|---|
  | `x-a2a-contracting-depth: 2` | **`402`** (challenge) | **`400` `CONTRACTING_DEPTH_EXCEEDED`** |
  | `x-a2a-contracting-depth: abc` | `402` | `400` `CONTRACTING_DEPTH_MALFORMED` |
  | `x-a2a-contracting-chain: no es un host!!` | **`402`** | **`400` `CONTRACTING_CHAIN_MALFORMED`** |
  | `x-a2a-contracting-chain: wasiai-a2a-production.up.railway.app` | `402` | `400` `CONTRACTING_LOOP_DETECTED` |

  ```
  app.wasiai.io HOY  x-a2a-contracting-depth: 2                 HTTP 402
  app.wasiai.io HOY  x-a2a-contracting-chain: no es un host!!   HTTP 402
  ```
  El techo del gateway es `depthMax: 2` (leído del agent card vivo), así que **`depth: 2` —un
  valor perfectamente normal para un intermediario de segundo nivel— pasa de funcionar a `400`.**

- **Impacto**: la ventana de observación de 60 minutos posterior a la promoción de `wasiai-prod`
  está **ciega a 4 de las 6 familias nuevas**. Un caller que hoy funciona y mañana recibe
  `CONTRACTING_DEPTH_EXCEEDED` no dispara la reversa, y el done-report va a decir que el cambio de
  status en el camino del dinero fueron 2 casos cuando fueron 6. Es "acotar un agujero" presentado
  como "cerrarlo".
- **Sugerencia** (no escribo el fix): ampliar la lista de códigos vigilados a
  `CONTRACTING_DEPTH_MALFORMED`, `CONTRACTING_DEPTH_EXCEEDED`, `CONTRACTING_CHAIN_MALFORMED`,
  `CONTRACTING_LOOP_DETECTED`, y agregar esas 4 filas a la tabla de radio de impacto **antes** de
  promover `wasiai-prod`. Como el punto de observación es A-4 (fuera del repo), alcanza con que el
  runbook nombre los 6 códigos: es una línea, y sin ella la red de seguridad no cubre lo que cree.

---

### 🟠 `BLQ-BAJO-1` — El smoke acusa "el header no atraviesa el proxy" cuando la causa real es `*_DISABLED`

- **Categoría**: Error Handling · Test Coverage
- **Archivo:línea**: `scripts/smoke-delegation.mjs:132-148` (`evaluateContractingTerna`) y
  `:171-197` (`evaluatePaymentChainTerna`), invocados incondicionalmente en `:294` y `:313`.
  El host afectado está en el USAGE del propio script: `:48`
  (`ej: app.wasiai.io | wasiai-v2.vercel.app`).
- **Qué está mal**: los pasos 3 y 4 pegan a `/api/v1/compose` **sin mirar si compose está
  delegado en ese ambiente**. En `wasiai-v2` / `wasiai-v2.vercel.app` (que el manifiesto declara
  con `delegated: []` a propósito, DT-2 B+) las tres patas devuelven el mismo
  `503 COMPOSE_DISABLED`, y el script concluye la causa equivocada. El script **ya tiene**
  `evaluateDisabled` (`:104`) que sabe reconocer `*_DISABLED`; los pasos 3 y 4 no lo consultan.
- **Reproducción** (corrida real, exit 1):
  ```
  $ node scripts/smoke-delegation.mjs wasiai-v2.vercel.app
  [wasiai-v2.vercel.app] AC-1 FALLA: la respuesta con x-a2a-contracting-depth:99 es IDÉNTICA
     a la respuesta sin el header ⇒ el header no atraviesa el proxy
  [wasiai-v2.vercel.app] AC-1b FALLA: … Recibido: {"error":"COMPOSE_DISABLED", …}
  ```
  Esperado: algo del tenor `paso 3 OMITIDO: /compose responde 503 COMPOSE_DISABLED en este
  ambiente (no delega)`. Recibido: una acusación falsa contra la lista blanca.
  Notar que el paso 4 **sí** muestra el `COMPOSE_DISABLED` en su mensaje, así que la evidencia de
  que el diagnóstico del paso 3 es falso está en la línea siguiente del mismo reporte.
- **Impacto**: el instrumento nombra la causa equivocada y manda a quien lo corra a auditar
  `passthrough-headers.ts` por un ambiente que está exactamente como el manifiesto dice que debe
  estar. Es la misma clase de error de diagnóstico que abrió esta HU, un piso más abajo — y es la
  única salida automática que va a existir después de la promoción. Además hace que el smoke
  **nunca** pueda dar verde en staging, o sea que su exit code deja de ser informativo ahí.
- **Sugerencia**: reutilizar `evaluateDisabled` como guarda de entrada de los pasos 3 y 4 (si el
  body trae `*_DISABLED`, reportar OMITIDO con la causa, no FALLA con una causa inventada), y
  darle al paso 2 el mismo `OMITIDO` explícito que ya tiene el paso 5 en `:352` — hoy, si
  `delegation.runtime` no trae `compose`/`orchestrate`, el paso 2 no imprime **nada**.

---

### 🟡 `MNR-1` — La cita del constraint que "se cae el ambiente entero" apunta al docblock de otra variable

- **Categoría**: Integration (documentación operativa)
- **Archivo:línea**: `.env.example:115` y `scripts/validate-env.js:179`, ambos:
  `` `src/lib/env.ts:75-86` + `:94` ``.
- **Medido**: `src/lib/env.ts:75` es una línea de jsdoc de `V2_DELEGATE_TO_A2A`; **`:79-86` es el
  docblock de `FACILITATOR_API_KEY`**, una variable sin relación; `:94` es el `{` que abre el
  objeto de opciones del `refine`. El constraint que realmente decide vive en **`:88-99`** y el
  `throw` en **`:106-110`**.
- **Impacto**: los dos textos son runbook de cutover ("el efecto no es un 503 acotado: es un 500 en
  TODA ruta"). Un operador que siga el puntero cae en la doc de `FACILITATOR_API_KEY`. En una HU
  cuya tesis es que las citas se miden y no se renumeran a ojo (`passthrough-headers.ts:46-48`),
  esto es la excepción dentro de la misma entrega.
- **Sugerencia**: re-medir y corregir en los dos sitios; están duplicados, así que arreglar uno
  solo deja el otro podrido.

### 🟡 `MNR-2` — `checkDelegationTrio` es lógica nueva con decisión de `exit 1` y cero control automático

- **Categoría**: Test Coverage
- **Archivo:línea**: `scripts/validate-env.js:144-187`.
- **Qué está mal**: `scripts/**` está fuera del typecheck (`tsconfig.json`) y del lint
  (`eslint.config.mjs`). El Dev **reconoció exactamente ese problema** para el otro script nuevo y
  lo resolvió poniéndole un test bajo `src/`
  (`src/lib/proxy/__tests__/smoke-delegation.test.ts:11-13`: *"Este es el ÚNICO control automático
  de `scripts/smoke-delegation.mjs`"*). La misma regla no se aplicó a `validate-env.js`, que además
  no está en `npm run qa` (`package.json`: `qa = typecheck && lint && test && build`).
- **Impacto**: la única guarda mecánica del orden de encendido/apagado de las 3 vars puede romperse
  sin que nada se ponga rojo. Revisé la lógica a mano y **hoy es correcta** (rama vacía ⇒ info,
  rama coherente ⇒ ok, rama incoherente ⇒ `exit 1`); el riesgo es de regresión, no actual.
- **Sugerencia**: extraer `checkDelegationTrio` a algo importable y darle el mismo tratamiento que
  `smoke-delegation.mjs`, o declarar explícitamente por qué este script sí puede vivir sin control.

### 🟡 `MNR-3` — La mitad más robusta de la evidencia exigida por AC-1b no tiene instrumento

- **Categoría**: Test Coverage
- **Archivo:línea**: `sdd.md:491-492` declara como *Evidencia exigida* que
  `app.wasiai.io` + `x-payment-chain: nonexistent-chain-xyz` ⇒ `400 CHAIN_NOT_SUPPORTED`.
  `grep -rn 'CHAIN_NOT_SUPPORTED\|nonexistent-chain' src/ scripts/` no devuelve **ninguna**
  aserción ni paso de smoke: sólo comentarios y el expediente.
- **Por qué importa**: esa pata es la **única volatile-free** de todo el aparato — discrimina por
  **status code** (`400` vs `402`), sin comparar cuerpos. Todo lo que el smoke sí automatiza
  (`evaluatePaymentChainTerna`, `:171-197`) descansa en que `accepts[0]` sea determinista entre dos
  llamadas. **Medí que hoy lo es** (dos llamadas consecutivas a `app.wasiai.io`,
  `JSON.stringify(accepts[0])` idéntico: sin `requestId`, sin nonce, sin timestamp — `extra` es
  `null`), así que el paso 4 es sólido al 2026-08-18. Pero esa propiedad la controla el upstream y
  **no la afirma nadie**: si `wasiai-a2a` mete un `nonce` o un `validBefore` en `accepts[0]`, la
  condición `withAccept === withoutAccept` deja de discriminar y el paso 4 queda apoyado sólo en
  `includes('eip155:84532')` — que da verde por casualidad si el default del gateway alguna vez
  pasa a ser Base Sepolia. Es la misma trampa del auto-blindaje del `requestId`, un paso más allá.
- **Verificado**: el gateway responde
  `400 {"error_code":"CHAIN_NOT_SUPPORTED","error":"Chain 'nonexistent-chain-xyz' is not a
  recognized slug or chainId"}`; `app.wasiai.io` hoy responde `402` con `eip155:2368`.
- **Sugerencia**: agregar un paso de smoke con el slug inválido (una comparación de status code,
  sin parseo de body). Cierra la evidencia de AC-1b y vuelve el paso 4 independiente de la
  determinismo de `accepts[0]`.

### 🟡 `MNR-4` — `commitSha` + `deploymentId` sin autenticar en el host del camino del dinero

- **Categoría**: Security (information disclosure)
- **Archivo:línea**: `src/app/api/v1/status/delegation/route.ts:71-73`.
- **Qué está mal**: AC-5 pide "un identificador del ambiente que responde"; `host` + `declaredAs` +
  `vercelEnv` ya lo dan. `deploymentId` y `commitSha` son **de más**, y `grep -rln
  'VERCEL_GIT_COMMIT_SHA\|VERCEL_DEPLOYMENT_ID' src/` confirma que **no existía ningún otro
  endpoint del repo que los publique**: esta HU estrena la exposición.
- **Impacto**: `wasiai-v2` es un repo **PÚBLICO** y `doc/sdd/**` (incluidos los SDD con sus
  secciones de riesgo residual y TD abiertos) está versionado ahí. Publicar sin auth el commit
  exacto que corre `app.wasiai.io` permite mapear "qué está desplegado" contra "qué se sabe que
  todavía no está arreglado". No es explotable por sí solo; es reconocimiento gratis.
- **No es finding la falta de auth en sí**: el docblock argumenta bien por qué un endpoint de
  estado con credencial es un endpoint que nadie consulta, y lo comparto. El finding es el
  **alcance**: dos campos que ningún AC pide.
- **Sugerencia**: o sacarlos, o dejarlos y escribir en el docblock por qué el fingerprint del
  commit es aceptable en un repo público con el expediente versionado.

### 🟡 `MNR-5` — La reconstrucción del `NextRequest` en `compose` no tiene test propio

- **Categoría**: Test Coverage
- **Archivo:línea**: `src/app/api/v1/compose/route.ts:60-69`; el test de esa ruta
  (`src/app/api/v1/compose/__tests__/proxy.test.ts:24`) **mockea `forwardRequest`**, así que la
  cadena "header del caller → `new NextRequest(...)` → `forwardRequest` → fetch" no está cubierta
  por nada.
- **Verificado que HOY funciona** (sonda del §1: los 3 headers llegan, `cookie` no). El riesgo es
  que un cambio futuro en cómo se reconstruye el request mate el fix del camino del dinero con
  `T-01b` y `T-04` en verde: los dos miden `forwardRequest` aislado.
- **Sugerencia**: un test de la ruta `compose` que no mockee `forwardRequest` y assertee sobre el
  `fetch` espiado. Es el eslabón donde el defecto sería invisible.

---

## 3. Las 8 categorías obligatorias

### 3.1 Security — `MNR` (`MNR-4`)

- ✅ **No se cuela nada de más.** La lista quedó en 11 entradas y el mutante M2 (agregar `cookie`)
  muere en 3 tests. `AC-7/T-03` (`forward-handler.test.ts:160-174`) verifica explícitamente que
  `cookie` / `set-cookie` / `referer` / `x-vercel-*` / `x-middleware-*` no salen. Mi sonda
  independiente confirmó que la cookie de sesión de Supabase **no** llega al fetch upstream.
- ✅ **El endpoint de estado no filtra secretos.** `config` son dos booleanos estrictos y el test
  lo verifica por **forma** (`Object.keys(body.config)` y `typeof === 'boolean'`) además de por
  substring, evitando el flake que el propio Dev documentó en el auto-blindaje.
- ✅ **Auth del cron reutiliza `verifyCronAuth`** (`src/lib/cron/verifyCronSecret.ts:43-52`):
  fail-closed sin `CRON_SECRET`, `timingSafeEqual` con guarda de longitud. La auth **corta antes**
  de salir a la red por el card, y hay test que lo fija (`route.test.ts:118-123`).
- ✅ **Forjar los headers de contracting no escala privilegios.** El gateway es alcanzable
  directamente (lo probé: `POST https://wasiai-a2a-production.up.railway.app/compose` responde),
  así que el proxy nunca fue un borde de seguridad para esos headers, y `wasiai-a2a` documenta y
  yo verifiqué que un header forjado sólo puede hacer fallar **la petición que lo trae**
  (`wasiai-a2a/src/lib/contracting-chain.ts:761-762`, pasos 1-4).
- 🟡 `MNR-4` (arriba).

### 3.2 Error Handling — `BLQ-BAJO` (`BLQ-BAJO-1`)

- ✅ `forwardRequest` conserva el `finally { clearTimeout(timer) }` (`forward-handler.ts:203-205`)
  y el mapeo 402/5xx→502/AbortError→504, con test de cada rama.
- ✅ **CD-10 implementado y mutación-verificado**: card irrecuperable (reject / `503` / sin bloque
  `contracting` / campos no-string) ⇒ `WARN` + `200`, nunca `HEADER_WHITELIST_DRIFT`. M4 lo mata.
  `fetchAgentCardHeaders` **nunca lanza** y acota con `AbortController` a 10 s.
- ✅ Tres canales de señal (500 / `logger.error` / Sentry best-effort en `try/catch` vacío
  deliberado), con el 500 como primario y sin depender de `SENTRY_DSN`.
- 🟠 `BLQ-BAJO-1` (arriba).
- ℹ️ **Residual declarado, no finding**: `WARN` sólo emite `logger.warn` y `200`. Un card
  permanentemente inalcanzable (p. ej. si cambia la ruta del `.well-known`) deja el mecanismo de
  AC-11 muerto en silencio, y no hay contador de fallos consecutivos. CD-10 lo pide así a
  propósito y estoy de acuerdo con el criterio (una alarma que suena cuando el upstream se cae se
  aprende a ignorar); lo dejo anotado para que el residual esté escrito, no como hallazgo.

### 3.3 Data Integrity — `OK`

Sin escrituras, sin transacciones, sin concurrencia. El cron y el endpoint de estado son de sólo
lectura e idempotentes. `DELEGATED` **no** se exporta (`forward-handler.ts:111` lo dice y lo
verifiqué: sólo `listDelegatedEndpoints()` sale del módulo), así que el conjunto no es mutable
desde afuera. Las comparaciones son por conjunto y ordenadas (`diffDelegation`,
`delegation-manifest.ts:135-145`), o sea el veredicto no depende del orden de inserción del flag —
hay test que lo fija pasando el flag en otro orden que el manifiesto.

### 3.4 Performance — `OK`

El bucle de copia pasó de 8 a 11 `headers.get()` por request: irrelevante. El cron agrega **una**
petición diaria acotada a 10 s. `/api/v1/status/delegation` es `force-dynamic` con `no-store` y
**sin I/O** (sólo lectura de `process.env` y de dos módulos puros), así que aunque no tiene rate
limit —`middleware.ts:132-137` sólo aplica cabeceras de seguridad, no rate limiting— el costo por
invocación es el mínimo. Sin N+1, sin leaks, sin bloqueo.

### 3.5 Integration — `BLQ-MED` (`BLQ-MED-1`)

- ✅ **Las 11 citas de `passthrough-headers.ts` las verifiqué una por una** contra `wasiai-a2a` @
  `10a6eb1`. Las 10 con `citation` apuntan a líneas reales y coherentes
  (`x402.ts:517/518`, `a2a-key.ts:546/551/358`, `compose.ts:326/107`, `gasless.ts:77`,
  `logger.test.ts:43`, `index.ts:163`, `contracting-chain.ts:769/820`). Las dos de contracting
  apuntan a la firma de `readInboundContracting` y al comentario del PASO 4 en vez de al `headers[…]`
  literal — es una aproximación razonable (el header entra por parámetro, no por lectura directa) y
  **no la cuento como finding**.
- ✅ **`ausente ≠ vacío` verificado en el código upstream, los tres casos**:
  `contracting-chain.ts:792-795` absorbe `chain: ''` como ausente (no da malformed);
  `:822-825` da `CONTRACTING_DEPTH_MALFORMED` con `depth: ''`;
  `chain-resolver.ts:419-423` + `a2a-key.ts:364-371` dan `400 CHAIN_NOT_SUPPORTED` con
  `x-payment-chain: ''`. La guarda `if (v)` de `forward-handler.ts:136` está **intacta** y T-02b la
  fija. **Ningún test afirma un tercer 400 que no exista**: los comentarios de
  `forward-handler.test.ts:221-230` describen los tres casos con la asimetría correcta.
- ✅ **`x-a2a-contracting-depth: '0'` se reenvía** (T-02c), que es lo correcto: `'0'` es truthy como
  string y es un valor legítimo del techo.
- ✅ **Ningún cliente propio de `wasiai-v2` manda estos headers**: `grep -rn` sobre `src/`,
  `scripts/` y `__tests__/` no encuentra un solo emisor. El radio de impacto es exclusivamente de
  callers externos.
- 🔴 `BLQ-MED-1` (arriba).

### 3.6 Type Safety — `OK`

`tsc --noEmit` limpio. Sin `any` nuevo. Los tres casts que hay están justificados y acotados:
`Object.keys(DELEGATED_ENDPOINT_ORDER) as DelegatedEndpoint[]` es seguro porque el
`Record<DelegatedEndpoint, true>` es exhaustivo por construcción (y ese patrón es precisamente lo
que impide que agregar un miembro a la unión pase en silencio); el `as unknown as
ConstructorParameters<…>` de `compose/route.ts` es preexistente; el `@ts-expect-error` +
`as unknown as SmokeModule` del test del smoke está explicado y es correcto (`scripts/**` fuera del
typecheck). `fetchAgentCardHeaders` parsea el card como `unknown` y estrecha con
`typeof value === 'string'` antes de usar nada — no hay propagación de `undefined` ni de `NaN`.

### 3.7 Test Coverage — `MNR` (`MNR-2`, `MNR-3`, `MNR-5`)

- ✅ Los 6 archivos de test nuevos/modificados **se ejecutan de verdad** (verificado por sonda:
  cada uno aparece con su `✓` y su conteo). `vitest.config.ts:10` (`include: ['src/**/*.test.{ts,tsx}']`)
  los toma a todos, incluido el del smoke, que vive bajo `src/` justamente por eso.
- ✅ 6 de 6 mutantes muertos (§1), incluidos los dos que fijan el falso verde del auto-blindaje.
- ✅ AC-10 (la reversa) tiene por primera vez un test del mundo apagado, en archivo propio con su
  propio mock — la razón (DT-9) es correcta y la verifiqué: `DELEGATED` se congela en carga de
  módulo, así que dos mundos no pueden convivir en un archivo.
- 🟡 `MNR-2`, `MNR-3`, `MNR-5`.
- ℹ️ Sin hallazgo: `'listDelegatedEndpoints agrees with isDelegated for every member'`
  (`forward-handler.test.ts:445-450`) es casi tautológico —`listDelegatedEndpoints` **es**
  `VALUES.filter(isDelegated)`—, pero el test de al lado fija la lista esperada literal, así que la
  categoría no queda sin candado real. Lo anoto y no lo cuento.

### 3.8 Scope Drift — `OK`

Los 21 archivos del diff mapean uno a uno contra la tabla de Scope IN de `sdd.md:538-556` (17 filas
+ el archivo de test del smoke, nombrado en la tabla de waves de `:584`). **Ningún archivo fuera de
scope.** No se agregó ninguna dependencia a `package.json`. No se tocó `wasiai-a2a` (CD-5). No se
tocó ninguna env var. El cambio a `CLAUDE.md` está en scope y es honesto: declara la verificación
de la terna como **pendiente de la promoción de `wasiai-prod`**, lo cual confirmé que es cierto hoy.

---

## 4. Las 3 categorías extra del checklist

| Categoría | Veredicto | Justificación |
|---|---|---|
| **Destructive Migrations** | **N/A** | Cero SQL en el diff. Ningún archivo de `supabase/migrations/` tocado. |
| **RPC con `SECURITY DEFINER`** | **N/A** | Cero funciones Postgres. El único `supabase` que aparece en el diff es la palabra "Supabase" en `.env.example`. |
| **Cache Invalidation** | **OK** | Sí hay lógica de cache y está bien resuelta: `Cache-Control: no-store` en el endpoint de estado (`route.ts:91`), con test que lo fija — necesario porque una respuesta de estado cacheada en el borde contestaría por un despliegue que no es el que atendió, que es la familia de error de esta HU. La respuesta no contiene datos por usuario, así que la ausencia de `user_id` en ninguna clave de cache es correcta y no el patrón de LUM-58. `forwardRequest` descarta **todas** las cabeceras de respuesta del upstream salvo `content-type`, así que tampoco se filtra un `Cache-Control` del gateway hacia el caller. |

---

## 5. Respuestas puntuales al encargo

| # | Pregunta | Respuesta medida |
|---|---|---|
| 1 | ¿Los 3 headers salen y no se cuela nada más? | **Sí.** Sonda propia sobre la reconstrucción real de `compose`: salen los 3, `cookie` no. M1/M2/M3 muertos. |
| 2 | ¿El arreglo del falso verde distingue de verdad? ¿Otros campos volátiles? ¿Las 6 filas? | **El paso 3 sí** (M5 lo mata). **Otros volátiles: hoy no** — medí `accepts[0]` byte-idéntico entre dos llamadas vivas, sin `requestId`/nonce/timestamp. **Pero nada lo asegura** ⇒ `MNR-3`. La condición correcta está en las dos ternas de `app.wasiai.io` (pasos 3 y 4) **y** en la de control (paso 5), que reusa la misma función. |
| 3 | `ausente ≠ vacío`, los tres casos | **Confirmado leyendo el upstream**, con la asimetría intacta: sólo `depth:''` y `x-payment-chain:''` dan 400; `chain:''` se absorbe. Ningún test afirma un tercer 400. |
| 4 | ¿El anti-silencio se aplaude solo? ¿Y el card roto? | **No se aplaude**: la ruta y el cron importan `listDelegatedEndpoints()` de `forward-handler.ts:113`, no releen `process.env` para el conjunto delegado. El card roto (4 formas) ⇒ `WARN` + 200, mutación-verificado. |
| 5 | ¿El residual de DT-7 es exactamente ese? | **Sí**, confirmado contra el card vivo: declara 2 headers y `x-payment-chain` no está. **Qué más no cubre**: (a) un header que el gateway estrene y **no** declare (ya declarado en DT-7 → A-3); (b) el sentido inverso — un header de la lista blanca que el gateway **deje** de leer queda como reenvío muerto y el diff no lo ve; (c) el ambiente donde `WASIAI_A2A_BASE_URL` esté vacío, donde el diff nunca corre y da `WARN` + 200 de por vida. |
| 6 | ¿La reversa funciona? ¿Hay estado intermedio peor? | La reversa declarada es de **código** (revert + redeploy o Instant Rollback), así que **no depende** del congelamiento de `DELEGATED` en `forward-handler.ts:94` — el aviso del Story File es correcto. **Estado intermedio a nombrar**: después de un rollback, `GET /api/v1/status/delegation` vuelve a `404` (lo medí: hoy da 404 en los dos hosts) y el smoke devuelve **exit 1 con 3 problemas**, indistinguible de un deploy fallido. No es peor que hoy, pero el runbook no lo dice. |
| 7 | Regresión: ¿hay una tercera? | **Hay cuatro más** ⇒ `BLQ-MED-1`. |
| 8 | ¿El test de `x-api-key` muerde? | **Sí** — M3 lo pone rojo por `T-04b` específicamente. |
| 9 | ¿Los tests corren? ¿El contador es real? | **Sí a las dos.** 87 `Test Files`, 763 passed / 5 skipped, y cada archivo nuevo verificado individualmente en la salida por archivo. |

---

## 6. Instrumentos que me fallaron (declarados, como pide el encargo)

1. **`cat`/`cat -n` a través del hook de `rtk` BORRA LÍNEAS.** Al leer
   `scripts/smoke-delegation.mjs` me devolvió el archivo **sin las líneas 35-40** (elidió parte del
   docblock), dejando el comentario aparentemente sin cerrar y **desplazando todos los números de
   línea ~6 posiciones**. `node --check scripts/smoke-delegation.mjs` ⇒ exit 0 probó que el archivo
   está sano y que el instrumento mentía. **Re-leí todo con la herramienta `Read` y todas las citas
   `archivo:línea` de este reporte están tomadas de ahí o de `grep -n`, nunca de `cat`.**
2. **`git log --oneline -1` a través del hook devolvió un commit que no es HEAD.** Dio `e2f8d71`
   mientras `git rev-parse HEAD` daba `10a6eb1…`. Usé `rtk proxy "git log -1 --format=…"` para
   confirmar. Si alguien cita un commit desde la salida filtrada, cita otro commit.
3. **`rtk proxy "cmd | tail -N"` rompe el pipe**: `tail -40` llegó a vitest como argumento y explotó
   con `` CACError: Unknown option `-0` ``. Redirigí a archivo y filtré después.
4. **No pude discriminar el caso `x-payment-chain: '   '`** (sólo espacios): `curl -H "X:   "` no
   deja distinguir si manda el header con valor vacío o no lo manda. La medición dio `402` (default)
   y **no la uso como evidencia de nada** — la descarto en vez de reportarla como hallazgo.

## 7. Límites de esta revisión

- **No tengo acceso a la consola de Vercel.** No pude verificar (a) que el cron
  `/api/cron/delegation-drift` quede efectivamente registrado en `wasiai-prod`, ni (b) **con qué
  `Host` invoca Vercel al cron**. Si ese `Host` no es exactamente uno de los declarados en
  `delegation-manifest.ts:60` / `:71`, el cron devolverá `UNDECLARED_HOST` ⇒ **500 diario** con
  `logger.error` + Sentry. Es una alarma falsa recurrente y por lo tanto una alarma que se aprende
  a ignorar. **Recomiendo medirlo en la primera corrida del cron post-deploy** (el body trae el
  `host` crudo, así que la primera respuesta contesta la pregunta).
- **No probé el comportamiento post-deploy de la rama**: en `app.wasiai.io` y en
  `wasiai-v2.vercel.app` el endpoint `/api/v1/status/delegation` da **404** hoy (la rama no está
  desplegada). Todo lo que digo sobre el estado "después del fix" viene de medir el **gateway
  directo**, que es el que va a recibir los headers.
- **No conté la población afectada** por `BLQ-MED-1`. Como dice el Story File, no se puede contar
  desde este repo. El punto de observación es A-4 (logs de Railway), fuera de mi alcance.
- No ejecuté nada que mueva fondos. Los 22 requests que disparé cortan todos en `400` o en el
  challenge `402`; ninguno llevó `x-payment` ni `payment-signature`.

---

## 8. Veredicto

**RECHAZADO.** Orden del fix-pack:

1. `BLQ-MED-1` — ampliar el disparador de reversa y la tabla de radio de impacto a las 6 familias
   de rechazo (las 4 de `CONTRACTING_*` faltan). **Antes de promover `wasiai-prod`.**
2. `BLQ-BAJO-1` — que los pasos 3 y 4 del smoke consulten `evaluateDisabled` antes de acusar a la
   lista blanca, y que el paso 2 diga `OMITIDO` como el 5.
3. `MNR-1` … `MNR-5` — el equipo decide si entran ahora o al backlog; **`MNR-3` conviene que entre
   con el fix-pack** porque el paso de smoke del slug inválido es barato y es lo que vuelve al
   paso 4 independiente de un campo que controla el upstream.

Lo que **no** es finding y quiero dejar escrito: el fix del camino del dinero está bien hecho,
está mutación-verificado en tres frentes, la asimetría `ausente ≠ vacío` está entendida y
respetada, y el hallazgo del falso verde del `requestId` que el Dev documentó en el auto-blindaje
**es real y su arreglo aguanta un mutante**. Es el hallazgo más valioso del F3 y sobrevivió al
ataque.

---

*AR generado por NexusAgil — Adversary · 2026-08-18*
