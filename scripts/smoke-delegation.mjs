#!/usr/bin/env node

/**
 * smoke-delegation.mjs — WKH-361 W2 · AC-8 + las dos ternas de regresión.
 *
 * Smoke post-deploy del proxy hacia `wasiai-a2a`. Contesta cuatro cosas que un
 * `200 OK` NO contesta:
 *   - si un endpoint declarado como delegado está en realidad devolviendo
 *     `503 *_DISABLED` (AC-8);
 *   - si los headers de contracting atraviesan el proxy (terna §2.2);
 *   - si `x-payment-chain` atraviesa el proxy (terna §2.1) — el que cuesta plata;
 *   - si un slug de red inválido corta en `400 CHAIN_NOT_SUPPORTED` en vez de
 *     cobrar la red por defecto (paso 4b, la pata de AC-1b que no depende de
 *     ningún campo volátil).
 *
 * POR QUÉ UNA TERNA Y NO UN STATUS CODE: un `200 OK` se ve igual con el header
 * llegando y sin llegar; un `402` bien formado, también. Por eso cada prueba
 * compara TRES patas: gateway directo (control) / host con el header / host sin
 * el header. Si las dos últimas son iguales, el header no llegó.
 *
 * ⚠️ TRES VALORES, NO DOS (fix-pack AR · `BLQ-BAJO-1`). Cada paso puede salir
 * OK / FALLA / **INCONCLUSO**. El tercero existe porque las ternas comparan
 * BODIES, y una comparación de bodies sólo significa algo si la petición LLEGÓ
 * A EJECUTARSE EN EL GATEWAY. Reportar lo que no se pudo medir como "AC-1
 * FALLA: el header no atraviesa el proxy" es NOMBRAR LA CAUSA EQUIVOCADA, que
 * es exactamente el error que abrió esta HU un piso más arriba.
 *
 * ⚠️ EL CRITERIO ES POSITIVO, NO UNA LISTA DE ESTADOS MALOS (fix-pack AR it.2 ·
 * `BLQ-BAJO-2`). La primera versión de esta guarda enumeraba los dos estados que
 * había visto —`503 *_DISABLED` y `429`— y este docblock los declaraba
 * exhaustivos ("hay dos estados"). No lo eran: el propio proxy GENERA otras dos
 * respuestas sin que el gateway ejecute nada —`504 {"error":"GATEWAY_TIMEOUT"}`
 * (`src/lib/proxy/forward-handler.ts:186-190`, body estático) y `502
 * {"error":"UPSTREAM_ERROR",…}` (`:168-179` cuando el gateway devuelve 5xx,
 * `:198-201` cuando falla la conexión)— y con cualquiera de las dos las patas
 * salen iguales y el smoke acusaba a la lista blanca **con la misma frase,
 * palabra por palabra**. Es el escenario MÁS probable del cutover, no el menos:
 * el paso 5 del runbook corre este smoke inmediatamente después del redeploy,
 * con la lambda fría y el gateway arrancando en frío.
 *
 * Por eso la guarda ya no pregunta "¿es uno de los estados malos?" sino "¿esta
 * respuesta PRUEBA que se ejecutó en el gateway?" (`GATEWAY_EXECUTED_STATUSES`).
 * Todo lo demás sale INCONCLUSO —con la causa nombrada cuando se la conoce, y
 * sin inventar ninguna cuando no—, incluidos los estados que todavía no vimos.
 * El default dejó de ser "acusar" y pasó a ser "no se pudo medir": un estado
 * nuevo del borde, de Vercel o del gateway ya no puede fabricar una acusación
 * falsa. Los dos estados conocidos siguen documentados:
 *   - `503 *_DISABLED` — el ambiente no delega ese endpoint (es el estado
 *     declarado de `wasiai-v2` / `wasiai-v2.vercel.app`, DT-2 B+);
 *   - `429` — rate limit del borde; medido el 2026-08-18 contra `app.wasiai.io`:
 *     los 10 primeros POST seguidos a `/compose` pasaron y el 11.º ya devolvió
 *     `429`. Una corrida completa del smoke hace **hasta 7 POST al host** (6 a
 *     `/compose` —1 del paso 2, 2 del 3, 2 del 4, 1 del 4b— y 1 a
 *     `/orchestrate`), así que UNA corrida entra debajo del límite y **dos
 *     encadenadas no**.
 * Un paso inconcluso NO suma a `failures`.
 *
 * ⚠️ LA GUARDA SE APLICA A LAS DOS PATAS, NO A LA PRIMERA (fix-pack CR ·
 * `MNR-CR-1`). Durante el fix-pack AR it.2 la guarda cubría sólo la petición CON
 * el header, con esta justificación escrita al lado: "si la 1ª no es medible, la
 * 2ª tampoco lo es". Eso es cierto en esa dirección y **falso al revés**: una
 * corrida puede medir bien la 1ª pata y comerse un `429` en la 2ª, que es
 * justamente el DISCRIMINADOR (*"Si las dos últimas son iguales, el header no
 * llegó"*). Medido antes del fix, con stub y sin red: primeras patas medibles +
 * patas de control en `429` ⇒ `paso 3 OK` + `paso 4 OK` + `SMOKE OK`, **exit 0**,
 * sin una sola línea diciendo que 2 de las 4 respuestas comparadas nunca llegaron
 * al gateway. Y con el defecto presente —el día que el default del gateway sea
 * `base-sepolia`, único escenario donde la diferencia entre patas es el único
 * testigo— la misma terna imprimía `paso 4 OK` sobre el camino del dinero.
 * Ahora la 2ª pata pasa por `evaluateStepPrecondition` con la etiqueta
 * `STEP_CONTROL_LEG`, y un control no medible hace el paso **INCONCLUSO** en vez
 * de OK. El número de peticiones no cambia: la guarda corre sobre una respuesta
 * que ya se pidió.
 *
 * CUÁNDO UN INCONCLUSO CAMBIA EL EXIT CODE (fix-pack AR it.2 · `BLQ-BAJO-3`).
 * La versión anterior decía que ningún inconcluso lo cambia, y lo justificaba
 * así: el caso "este ambiente debería delegar y no delega" lo cazan antes —con
 * exit 1— el paso 2 (AC-8) o el paso 6 (AC-7, `DRIFT`). **Ese argumento no
 * aplicaba a la rama que el propio fix-pack agregó**: con un `429` el paso 2 no
 * caza nada (su aserción es "no es `*_DISABLED`", que un 429 satisface
 * VACUAMENTE) y el paso 6 sólo lee datos del endpoint de estado. Resultado
 * medido: `paso 2 OK` sobre un 429, pasos 3/4/4b inconclusos, **los tres headers
 * del camino del dinero medidos CERO veces y el proceso saliendo 0** — y
 * reintentar el smoke, la reacción más natural ante un resultado dudoso, es
 * justo lo que dispara el 429.
 *
 * La regla, ahora, tiene dos mitades:
 *   1. El paso 2 distingue "no es `*_DISABLED`" de "no se pudo medir": pasa por
 *      la misma guarda positiva que los pasos 3/4/4b, así que ya no puede decir
 *      OK sobre un 429/502/504/500/404.
 *   2. El exit code lo decide `decideVerdict`: si el ambiente **declara**
 *      delegar (`delegation.runtime` trae `compose` u `orchestrate`) y quedó
 *      algún paso sin medir, sale **1**. Lo declarado es la vara: un ambiente
 *      que dice delegar y no deja medir NO es un OK.
 * El caso del ambiente que el manifiesto declara como NO delegante
 * (`wasiai-v2` / `wasiai-v2.vercel.app`, `503 *_DISABLED`, DT-2 B+) sigue
 * saliendo **0**: ahí no hay nada que medir, y una alarma que suena siempre es
 * una alarma apagada.
 * En los dos casos la última línea NUNCA dice `SMOKE OK` a secas cuando hubo
 * inconclusos: dice cuántos, y que los headers NO se verificaron acá.
 *
 * NINGUNO DE LOS 7 PASOS MUEVE FONDOS. Los pasos 3-5 cortan en 400/402: el 402
 * es el challenge x402 ("esto es lo que tendrías que pagar") y el 400 es un
 * rechazo. El propio gateway lo dice en el body del 400 de contracting: "La
 * peticion se rechaza sin cobrar."
 *
 * Uso:
 *   node scripts/smoke-delegation.mjs <host> [--gateway <url>]
 *   npm run smoke:delegation -- app.wasiai.io
 *
 * SIN <host> SALE CON CÓDIGO 2. No hay host por defecto a propósito: un smoke
 * con host por defecto es el mismo footgun que abrió esta HU (dar por probado
 * un ambiente que no es el que se probó). Cada línea de salida empieza por el
 * host probado, por la misma razón.
 *
 * ⚠️ Este archivo NO EJECUTA NADA AL IMPORTARSE (main-guard al final). Su test
 * vive en `src/lib/proxy/__tests__/smoke-delegation.test.ts` y lo importa: sin
 * el guard, `npm test` dispararía el smoke contra la red. Importa además
 * porque `scripts/**` está fuera del typecheck (`tsconfig.json`) y fuera del
 * lint (`eslint.config.mjs`): ese test es el único control automático de este
 * archivo.
 *
 * Sin dependencias: sólo builtins de Node y `fetch` (Node >= 20).
 */

import { pathToFileURL } from 'url'

export const USAGE = [
  'Uso: node scripts/smoke-delegation.mjs <host> [--gateway <url>]',
  '',
  '  <host>            host a probar, SIN esquema. Obligatorio, sin default.',
  '                    ej: app.wasiai.io | wasiai-v2.vercel.app',
  '  --gateway <url>   URL del gateway wasiai-a2a para la pata de control.',
  '                    ej: https://wasiai-a2a-production.up.railway.app',
  '',
  'Salidas: 0 = todo bien | 1 = fallo de smoke | 2 = uso incorrecto',
  '',
  'Un paso puede salir OK, FALLA o INCONCLUSO. Un INCONCLUSO sale 1 si el ambiente',
  'DECLARA delegar (delegation.runtime trae compose u orchestrate) y 0 si no: un',
  'ambiente que no delega NO se reporta como si la lista blanca estuviera rota, y',
  'uno que sí delega NO se reporta OK sin haber medido nada. La última línea dice',
  'siempre cuántos inconclusos hubo.',
  '',
  'Los pasos 3 y 4 hacen DOS peticiones cada uno y las comparan. Un INCONCLUSO dice',
  'CUÁL de las dos no se pudo medir: sin aclaración es la que lleva el header, y',
  '"(pata de control, sin el header)" es la otra. Se arreglan distinto: un 503 en la',
  'primera = este ambiente no delega; un 429 en la segunda = reintentar más tarde.',
].join('\n')

export const EXIT_OK = 0
export const EXIT_FAIL = 1
export const EXIT_USAGE = 2

/** Body mínimo de la terna de contracting: corta en validación, no cobra. */
export const CONTRACTING_BODY = JSON.stringify({ steps: [] })
/** Body de la terna de x-payment-chain: corta en el challenge 402, no cobra. */
export const PAYMENT_CHAIN_BODY = JSON.stringify({
  steps: [{ agent: 'wasi-chainlink-price' }],
})
/**
 * Slug de red que el gateway NO reconoce (paso 4b, AC-1b · fix-pack AR `MNR-3`).
 * Es el mismo literal que la *Evidencia exigida* del SDD (`sdd.md:491-492`).
 */
export const INVALID_CHAIN_SLUG = 'nonexistent-chain-xyz'

/**
 * Parsea argv. Devuelve `{ ok: false, exitCode: 2 }` si falta el host.
 * @param {string[]} argv - normalmente `process.argv.slice(2)`
 */
export function parseArgs(argv) {
  const args = [...argv]
  let gateway = null

  const gwIndex = args.indexOf('--gateway')
  if (gwIndex !== -1) {
    const value = args[gwIndex + 1]
    if (!value || value.startsWith('--')) {
      return { ok: false, exitCode: EXIT_USAGE, error: '--gateway requiere una URL' }
    }
    gateway = value.replace(/\/+$/, '')
    args.splice(gwIndex, 2)
  }

  const host = args.find((a) => !a.startsWith('--'))
  if (!host || host.trim().length === 0) {
    return { ok: false, exitCode: EXIT_USAGE, error: 'falta el argumento <host>' }
  }

  const clean = host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return { ok: true, host: clean, gateway }
}

/** Toda línea de salida empieza por el host probado. */
export function formatLine(host, message) {
  return `[${host}] ${message}`
}

/**
 * AC-8: un endpoint declarado como delegado que contesta `503 *_DISABLED`.
 * Devuelve `null` si está bien, o un descriptor de fallo con host, endpoint,
 * status y el `error` recibido — los cuatro, porque un mensaje que sólo dice
 * "falló" obliga a ir a mirar, y ese viaje es el que nadie hace.
 */
export function evaluateDisabled(host, endpoint, status, bodyText) {
  if (status !== 503) return null
  let errorCode = bodyText
  try {
    const parsed = JSON.parse(bodyText)
    if (parsed && typeof parsed.error === 'string') errorCode = parsed.error
  } catch {
    // body no-JSON: se reporta crudo, recortado
    errorCode = String(bodyText).slice(0, 200)
  }
  if (!String(errorCode).includes('_DISABLED')) return null
  return {
    host,
    endpoint,
    status,
    error: errorCode,
    message: formatLine(
      host,
      `AC-8 FALLA: /${endpoint} figura como delegado pero responde ${status} ${errorCode}`,
    ),
  }
}

/**
 * Los ÚNICOS status en los que comparar bodies significa algo, porque son los
 * únicos que PRUEBAN que la petición se ejecutó EN EL GATEWAY. Medidos el
 * 2026-08-18 contra `wasiai-a2a` @ `10a6eb1` con los dos bodies de este smoke:
 *
 *   - `400` — rechazo del gateway: validación de body, contracting
 *     (`contracting-guard.ts:116`) o `CHAIN_NOT_SUPPORTED` (`a2a-key.ts:366-370`);
 *   - `402` — challenge x402, el caso normal de `PAYMENT_CHAIN_BODY`;
 *   - `403` — `INSUFFICIENT_BUDGET` (`a2a-key.ts:1264-1275`).
 *
 * El proxy reenvía el status del gateway tal cual **salvo** `5xx → 502` y
 * `Abort → 504` (`src/lib/proxy/forward-handler.ts:168-201`), y devuelve
 * `503 *_DISABLED` sin salir a la red cuando la delegación está apagada. O sea:
 * ninguno de estos tres se puede fabricar sin haber hablado con el gateway, y
 * ésa es exactamente la propiedad que la guarda necesita.
 *
 * `200` NO está en la lista a propósito: con `{"steps":[]}` el gateway corta en
 * 400 y con el agente pago corta en 402, así que un 200 sería un cambio de
 * contrato upstream. Ante eso lo correcto es INCONCLUSO y re-medir esta lista,
 * no comparar bodies de algo que ya no entendemos.
 */
export const GATEWAY_EXECUTED_STATUSES = Object.freeze([400, 402, 403])

/**
 * Etiqueta del paso cuando la guarda se aplica a la **2ª pata** de una terna —
 * la que va SIN el header, o sea el discriminador (fix-pack CR · `MNR-CR-1`).
 *
 * Existe para que el operador no lea `paso 4 INCONCLUSO` sin saber CUÁL de las
 * dos peticiones no se pudo medir: son dos causas distintas y se arreglan
 * distinto (la 1ª pata en 503 = el ambiente no delega; la 2ª en 429 = reintentar
 * más tarde). Es una función y no un literal para que las dos llamadas no puedan
 * divergir.
 */
export const STEP_CONTROL_LEG = (step) => `${step} (pata de control, sin el header)`

/**
 * GUARDA DE ENTRADA de los pasos 2, 3, 4 y 4b — fix-pack AR `BLQ-BAJO-1`,
 * invertida a precondición positiva en el fix-pack AR it.2 (`BLQ-BAJO-2`).
 *
 * Los pasos comparan BODIES (o afirman AC-8) para decidir si el header atravesó
 * el proxy. Esa comparación sólo significa algo si la petición llegó a
 * ejecutarse en el gateway. La guarda NO enumera estados malos —esa lista se
 * quedó corta y produjo la acusación falsa que el AR reprodujo textual—: exige
 * que el status esté en `GATEWAY_EXECUTED_STATUSES` y manda todo lo demás a
 * INCONCLUSO.
 *
 * Cuando la causa se conoce, se nombra (y en los dos casos históricos se
 * DESMIENTE explícitamente la lista blanca). Cuando no se conoce, se dice que no
 * se pudo medir y **no se inventa una causa**: es la diferencia entre los tres
 * valores y los dos.
 *
 * `503 *_DISABLED` se reconoce reutilizando `evaluateDisabled` a propósito: es
 * el único lugar que sabe reconocer `*_DISABLED`, y tenerlo dos veces serían dos
 * criterios que divergen.
 *
 * Devuelve `null` si la respuesta es medible (el paso se corre normalmente).
 */
export function evaluateStepPrecondition(host, step, endpoint, status, bodyText) {
  if (GATEWAY_EXECUTED_STATUSES.includes(status)) return null

  const inconclusive = (cause) => formatLine(host, `paso ${step} INCONCLUSO: ${cause}`)

  const disabled = evaluateDisabled(host, endpoint, status, bodyText)
  if (disabled) {
    return inconclusive(
      `/${endpoint} responde ${status} ${disabled.error} en este ambiente (no delega) ⇒ ` +
        'NO se puede medir si el header atraviesa el proxy. La causa NO es la lista blanca',
    )
  }
  if (status === 429) {
    return inconclusive(
      `/${endpoint} responde 429 (rate limit) ⇒ las dos patas serían iguales por el ` +
        'límite, no por la lista blanca. Reintentar más tarde',
    )
  }
  if (status === 504) {
    return inconclusive(
      `/${endpoint} responde 504 ⇒ el body lo genera EL PROXY cuando el gateway no ` +
        'contesta a tiempo (forward-handler.ts:186-190) y es el mismo con y sin el ' +
        'header: las dos patas serían iguales por el timeout, no por la lista blanca. ' +
        'Reintentar cuando el gateway esté caliente',
    )
  }
  if (status === 502) {
    return inconclusive(
      `/${endpoint} responde 502 ⇒ el body lo genera EL PROXY cuando el gateway ` +
        'devuelve 5xx o no se pudo conectar (forward-handler.ts:168-179 / :198-201): ' +
        'la petición NO se ejecutó en el gateway. La causa NO es la lista blanca',
    )
  }
  return inconclusive(
    `/${endpoint} responde ${status}, que NO prueba que la petición se haya ejecutado ` +
      `en el gateway (los medibles son ${GATEWAY_EXECUTED_STATUSES.join('/')}) ⇒ no se ` +
      `puede concluir nada sobre la lista blanca. Recibido: ${String(bodyText).slice(0, 160)}`,
  )
}

/**
 * `error_code` que el gateway devuelve cuando el slug de red no existe
 * (`wasiai-a2a/src/middleware/a2a-key.ts:366-370`). NO es un campo volátil: el
 * body de ese 400 es `{error_code, error}` y nada más.
 */
export const INVALID_CHAIN_ERROR_CODE = 'CHAIN_NOT_SUPPORTED'

/**
 * Paso 4b (AC-1b · fix-pack AR `MNR-3`) — la pata SIN campos volátiles.
 *
 * No compara bodies ni `accepts[0]`, así que —a diferencia del paso 4— no
 * depende de que el upstream mantenga `accepts[0]` determinista entre dos
 * llamadas. Si el gateway algún día le agrega un `nonce` o un `validBefore`,
 * este paso sigue discriminando y el 4 no.
 *
 * ⚠️ EXIGE EL `error_code`, NO SÓLO EL 400 (fix-pack AR it.2 · `MNR-it2-1`). La
 * versión anterior daba OK ante CUALQUIER 400, y el gateway tiene varios que no
 * son éste. Medido el 2026-08-18 contra el gateway con el mismo body:
 *   - sin `x-wasiai-forward-key` válida ⇒ `401 INVALID_FORWARD_KEY`
 *   - `{"steps":[]}` ⇒ `400 {"code":"VALIDATION_ERROR","requestId":"…"}`
 *   - `x-payment-chain: nonexistent-chain-xyz` ⇒ `400 CHAIN_NOT_SUPPORTED`
 * O sea: un cambio de schema del body volvería este paso VERDE sin que el header
 * hubiera atravesado nada. Mirar el `error_code` no reintroduce la volatilidad
 * que `MNR-3` sacó: el campo volátil de esos bodies es `requestId`, no
 * `error_code` — y `requestId` no aparece en el 400 que este paso espera.
 *
 * El body recibido se imprime SÓLO en el mensaje de falla, para diagnosticar.
 */
export function evaluateInvalidChainSlug(host, status, bodyText) {
  if (status !== 400) {
    return formatLine(
      host,
      `AC-1b FALLA: con x-payment-chain: ${INVALID_CHAIN_SLUG} se esperaba 400 ` +
        `(${INVALID_CHAIN_ERROR_CODE}) y llegó ${status} ⇒ el header no atraviesa el proxy ` +
        `y se aplicó la red por defecto. Recibido: ${String(bodyText).slice(0, 200)}`,
    )
  }
  if (!String(bodyText).includes(INVALID_CHAIN_ERROR_CODE)) {
    return formatLine(
      host,
      `AC-1b FALLA: con x-payment-chain: ${INVALID_CHAIN_SLUG} llegó un 400, pero NO es el ` +
        `de la red: el body no contiene ${INVALID_CHAIN_ERROR_CODE} ⇒ el 400 lo produjo otra ` +
        `cosa (p. ej. validación de body) y este paso NO probó que el header atraviese el ` +
        `proxy. Recibido: ${String(bodyText).slice(0, 200)}`,
    )
  }
  return null
}

/**
 * Terna de contracting (§2.2). `withHeader` es la respuesta con
 * `x-a2a-contracting-depth: 99`; `without` la misma sin el header.
 * Falla si son iguales, o si la del header no trae CONTRACTING_DEPTH_EXCEEDED.
 */
export function evaluateContractingTerna(host, withHeader, without) {
  if (withHeader === without) {
    return formatLine(
      host,
      'AC-1 FALLA: la respuesta con x-a2a-contracting-depth:99 es IDÉNTICA a la ' +
        'respuesta sin el header ⇒ el header no atraviesa el proxy',
    )
  }
  if (!withHeader.includes('CONTRACTING_DEPTH_EXCEEDED')) {
    return formatLine(
      host,
      'AC-1 FALLA: con x-a2a-contracting-depth:99 la respuesta no contiene ' +
        `CONTRACTING_DEPTH_EXCEEDED. Recibido: ${withHeader.slice(0, 200)}`,
    )
  }
  return null
}

/**
 * Extrae `accepts[0]` de un challenge x402, como string canónico comparable.
 * Devuelve `null` si el body no tiene esa forma.
 */
export function extractFirstAccept(bodyText) {
  try {
    const parsed = JSON.parse(bodyText)
    const accepts = parsed?.accepts
    if (!Array.isArray(accepts) || accepts.length === 0) return null
    return JSON.stringify(accepts[0])
  } catch {
    return null
  }
}

/**
 * Terna de `x-payment-chain` (§2.1) — el que cuesta plata.
 * Se comparan los `accepts[0]` COMPLETOS, no un campo suelto: tres campos
 * discriminan (`network`, `maxAmountRequired` y `asset`), y mirar uno solo
 * puede dar verde con la cotización equivocada.
 */
export function evaluatePaymentChainTerna(host, withHeaderBody, withoutBody, expectedNetwork) {
  const withAccept = extractFirstAccept(withHeaderBody)
  const withoutAccept = extractFirstAccept(withoutBody)

  if (withAccept === null) {
    return formatLine(
      host,
      'AC-1b FALLA: la respuesta con x-payment-chain no trae un bloque accepts[0]. ' +
        `Recibido: ${withHeaderBody.slice(0, 200)}`,
    )
  }
  if (withAccept === withoutAccept) {
    return formatLine(
      host,
      'AC-1b FALLA: accepts[0] con x-payment-chain es IDÉNTICO al de sin header ⇒ ' +
        'el header no atraviesa el proxy y se está cotizando la red por defecto',
    )
  }
  if (!withAccept.includes(expectedNetwork)) {
    return formatLine(
      host,
      `AC-1b FALLA: con x-payment-chain se esperaba network ${expectedNetwork} y ` +
        `llegó accepts[0]=${withAccept.slice(0, 300)}`,
    )
  }
  return null
}

/**
 * Paso 6: veredicto de `delegation.match`. Un Preview no declarado NO falla —
 * imprime `PREVIEW_NOT_DECLARED` — porque un preview efímero no puede estar en
 * un manifiesto versionado, y una alarma que suena en cada preview es una
 * alarma apagada.
 */
export function evaluateDelegationMatch(host, match, vercelEnv) {
  if (match === 'MATCH') return null
  if (vercelEnv === 'preview') {
    return { fail: false, message: formatLine(host, `PREVIEW_NOT_DECLARED (match=${match})`) }
  }
  return {
    fail: true,
    message: formatLine(host, `AC-7 FALLA: delegation.match=${match} (esperado MATCH)`),
  }
}

/**
 * Veredicto final: exit code + la línea que lo explica — fix-pack AR it.2
 * (`BLQ-BAJO-3`). Función pura y exportada para que las cuatro combinaciones se
 * puedan medir sin red: es la que decide si una corrida que no midió nada sale 0.
 *
 * `declaresDelegation` = el endpoint de estado declaró `compose` u `orchestrate`
 * en `delegation.runtime`. Un ambiente que DECLARA delegar y no deja medir los
 * headers del camino del dinero **no es un OK**; uno que declara no delegar, sí.
 */
export function decideVerdict(host, failureCount, inconclusiveCount, declaresDelegation) {
  const suffix = inconclusiveCount > 0 ? ` + ${inconclusiveCount} paso(s) INCONCLUSO(s)` : ''
  if (failureCount > 0) {
    return {
      exitCode: EXIT_FAIL,
      isError: true,
      line: formatLine(host, `SMOKE FALLA — ${failureCount} problema(s)${suffix}`),
    }
  }
  if (inconclusiveCount > 0 && declaresDelegation) {
    return {
      exitCode: EXIT_FAIL,
      isError: true,
      line: formatLine(
        host,
        `SMOKE FALLA — 0 problema(s)${suffix}: este ambiente DECLARA delegar ` +
          '(delegation.runtime) y los headers del camino del dinero NO se midieron ' +
          'ninguna vez. Resolver la causa de cada INCONCLUSO y volver a correrlo',
      ),
    }
  }
  // Sin fallas pero con pasos que no se pudieron medir, el veredicto NO puede
  // ser `SMOKE OK` a secas: sería afirmar que los headers atraviesan el proxy en
  // un ambiente donde no se midió.
  if (inconclusiveCount > 0) {
    return {
      exitCode: EXIT_OK,
      isError: false,
      line: formatLine(
        host,
        `SMOKE OK — ${inconclusiveCount} paso(s) INCONCLUSO(s): en este ambiente NO se ` +
          'verificó que los headers atraviesen el proxy',
      ),
    }
  }
  return { exitCode: EXIT_OK, isError: false, line: formatLine(host, 'SMOKE OK') }
}

const DEFAULT_DEPS = {
  fetchImpl: (...args) => fetch(...args),
  log: (line) => console.log(line),
  logError: (line) => console.error(line),
}

async function readResponse(fetchImpl, url, init) {
  const res = await fetchImpl(url, init)
  return { status: res.status, text: await res.text() }
}

/**
 * Corre los 7 pasos (1, 2, 3, 4, 4b, 5, 6) y devuelve el código de salida. No
 * llama a `process.exit`:
 * eso lo hace el main-guard, así el test puede correrlo sin matar al runner.
 *
 * @param {{host: string, gateway: string|null}} args
 * @param {{fetchImpl: Function, log: Function, logError: Function}} [deps]
 */
export async function runSmoke(args, deps = DEFAULT_DEPS) {
  const { host, gateway } = args
  const { fetchImpl, log, logError } = { ...DEFAULT_DEPS, ...deps }
  const base = `https://${host}`
  const failures = []
  /** Pasos que NO se pudieron medir. No suman a `failures` (ver docblock). */
  const inconclusive = []

  const jsonHeaders = { 'content-type': 'application/json' }

  // ── Paso 1: el endpoint de estado ────────────────────────────────────────
  let status
  try {
    const res = await readResponse(fetchImpl, `${base}/api/v1/status/delegation`, {
      method: 'GET',
    })
    if (res.status !== 200) {
      // Un `404` acá tiene UNA causa concreta y vale nombrarla: el endpoint lo
      // estrena esta HU, así que un ambiente sin la HU desplegada (o después de
      // la reversa) contesta 404. Sigue siendo FALLA — post-deploy el endpoint
      // tiene que existir — pero con la causa correcta y no "el smoke rompió".
      failures.push(
        formatLine(
          host,
          `paso 1 FALLA: GET /api/v1/status/delegation ⇒ ${res.status}` +
            (res.status === 404
              ? ' ⇒ este ambiente NO tiene desplegada la HU (o se ejecutó la reversa)'
              : ''),
        ),
      )
      status = null
    } else {
      status = JSON.parse(res.text)
      log(formatLine(host, `environment = ${JSON.stringify(status.environment)}`))
      log(formatLine(host, `delegation  = ${JSON.stringify(status.delegation)}`))
    }
  } catch (err) {
    failures.push(formatLine(host, `paso 1 FALLA: ${String(err)}`))
    status = null
  }

  // ── Paso 2 (AC-8): ningún endpoint delegado contesta 503 *_DISABLED ───────
  const delegatedRuntime = Array.isArray(status?.delegation?.runtime)
    ? status.delegation.runtime
    : []
  const ac8Targets = delegatedRuntime.filter((e) => e === 'compose' || e === 'orchestrate')
  // fix-pack AR it.2 `BLQ-BAJO-3`: lo que el ambiente DECLARA es la vara con la
  // que se decide el exit code ante pasos sin medir. Se toma del endpoint de
  // estado, no de una lista local: si el paso 1 falló, no hay declaración y los
  // inconclusos no cambian el código (el paso 1 ya sale con 1 por su cuenta).
  const declaresDelegation = ac8Targets.length > 0
  // fix-pack AR `BLQ-BAJO-1`: el paso 2 imprime su OMITIDO como el 5. Antes, sin
  // endpoints que mirar, no imprimía NADA y su silencio se leía como un OK.
  if (ac8Targets.length === 0) {
    log(
      formatLine(
        host,
        status === null
          ? 'paso 2 OMITIDO: sin /api/v1/status/delegation no se sabe qué delega este ambiente'
          : 'paso 2 OMITIDO: delegation.runtime no incluye compose ni orchestrate ⇒ AC-8 no ' +
              'aplica en este ambiente',
      ),
    )
  }
  for (const endpoint of ac8Targets) {
    try {
      const res = await readResponse(fetchImpl, `${base}/api/v1/${endpoint}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: CONTRACTING_BODY,
      })
      const disabled = evaluateDisabled(host, endpoint, res.status, res.text)
      if (disabled) {
        failures.push(disabled.message)
      } else {
        // fix-pack AR it.2 `BLQ-BAJO-3`: "no es *_DISABLED" no es lo mismo que
        // "lo medí". Sin esta guarda, un 429/502/504/500/404 imprimía
        // `paso 2 OK` y AC-8 quedaba sin medir con el proceso saliendo 0.
        const skip = evaluateStepPrecondition(host, 2, endpoint, res.status, res.text)
        if (skip) {
          inconclusive.push(skip)
          log(skip)
        } else {
          log(formatLine(host, `paso 2 OK: /${endpoint} responde ${res.status} (no *_DISABLED)`))
        }
      }
    } catch (err) {
      failures.push(formatLine(host, `paso 2 FALLA: /${endpoint} ${String(err)}`))
    }
  }

  // ── Paso 3: terna de contracting (§2.2) ──────────────────────────────────
  try {
    const withHeader = await readResponse(fetchImpl, `${base}/api/v1/compose`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-a2a-contracting-depth': '99' },
      body: CONTRACTING_BODY,
    })
    // La guarda corre ANTES de pedir la 2ª pata: si la 1ª no es medible, la 2ª
    // tampoco lo es y sería una petición al pedo. Pero la implicación NO vale al
    // revés (fix-pack CR · `MNR-CR-1`): la 1ª pata puede ser medible y la 2ª no,
    // y la 2ª es justamente el DISCRIMINADOR de la terna. Por eso pasa por la
    // MISMA guarda antes de compararla.
    const skip = evaluateStepPrecondition(host, 3, 'compose', withHeader.status, withHeader.text)
    if (skip) {
      inconclusive.push(skip)
      log(skip)
    } else {
      const without = await readResponse(fetchImpl, `${base}/api/v1/compose`, {
        method: 'POST',
        headers: jsonHeaders,
        body: CONTRACTING_BODY,
      })
      const skipControl = evaluateStepPrecondition(
        host,
        STEP_CONTROL_LEG(3),
        'compose',
        without.status,
        without.text,
      )
      if (skipControl) {
        inconclusive.push(skipControl)
        log(skipControl)
      } else {
        const problem = evaluateContractingTerna(host, withHeader.text, without.text)
        if (problem) failures.push(problem)
        else log(formatLine(host, 'paso 3 OK: x-a2a-contracting-depth atraviesa el proxy'))
      }
    }
  } catch (err) {
    failures.push(formatLine(host, `paso 3 FALLA: ${String(err)}`))
  }

  // ── Paso 4: terna de x-payment-chain (§2.1) ──────────────────────────────
  try {
    const withHeader = await readResponse(fetchImpl, `${base}/api/v1/compose`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-payment-chain': 'base-sepolia' },
      body: PAYMENT_CHAIN_BODY,
    })
    const skip = evaluateStepPrecondition(host, 4, 'compose', withHeader.status, withHeader.text)
    if (skip) {
      inconclusive.push(skip)
      log(skip)
    } else {
      const without = await readResponse(fetchImpl, `${base}/api/v1/compose`, {
        method: 'POST',
        headers: jsonHeaders,
        body: PAYMENT_CHAIN_BODY,
      })
      // fix-pack CR `MNR-CR-1` — ver el comentario del paso 3. Acá pesa más: el
      // día que el default del gateway sea `base-sepolia`, la ÚNICA cosa que
      // distingue "el header atravesó" de "no atravesó" es esta 2ª pata.
      const skipControl = evaluateStepPrecondition(
        host,
        STEP_CONTROL_LEG(4),
        'compose',
        without.status,
        without.text,
      )
      if (skipControl) {
        inconclusive.push(skipControl)
        log(skipControl)
      } else {
        const problem = evaluatePaymentChainTerna(
          host,
          withHeader.text,
          without.text,
          'eip155:84532',
        )
        if (problem) failures.push(problem)
        else log(formatLine(host, 'paso 4 OK: x-payment-chain atraviesa el proxy'))
      }
    }
  } catch (err) {
    failures.push(formatLine(host, `paso 4 FALLA: ${String(err)}`))
  }

  // ── Paso 4b: slug de red inválido ⇒ 400 (AC-1b, sin campos volátiles) ─────
  try {
    const res = await readResponse(fetchImpl, `${base}/api/v1/compose`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-payment-chain': INVALID_CHAIN_SLUG },
      body: PAYMENT_CHAIN_BODY,
    })
    const skip = evaluateStepPrecondition(host, '4b', 'compose', res.status, res.text)
    if (skip) {
      inconclusive.push(skip)
      log(skip)
    } else {
      const problem = evaluateInvalidChainSlug(host, res.status, res.text)
      if (problem) failures.push(problem)
      else
        log(formatLine(host, 'paso 4b OK: un slug de red inválido corta en 400 CHAIN_NOT_SUPPORTED'))
    }
  } catch (err) {
    failures.push(formatLine(host, `paso 4b FALLA: ${String(err)}`))
  }

  // ── Paso 5: pata de control contra el gateway directo ─────────────────────
  if (gateway) {
    try {
      const withHeader = await readResponse(fetchImpl, `${gateway}/compose`, {
        method: 'POST',
        headers: { ...jsonHeaders, 'x-payment-chain': 'base-sepolia' },
        body: PAYMENT_CHAIN_BODY,
      })
      const without = await readResponse(fetchImpl, `${gateway}/compose`, {
        method: 'POST',
        headers: jsonHeaders,
        body: PAYMENT_CHAIN_BODY,
      })
      const problem = evaluatePaymentChainTerna(
        host,
        withHeader.text,
        without.text,
        'eip155:84532',
      )
      if (problem) {
        // Si la pata de control falla, el roto es el INSTRUMENTO, no el sistema.
        failures.push(
          formatLine(host, `paso 5 (control, gateway ${gateway}) ⇒ INSTRUMENTO ROTO: ${problem}`),
        )
      } else {
        log(formatLine(host, `paso 5 OK: el gateway directo (${gateway}) discrimina la red`))
      }
    } catch (err) {
      failures.push(formatLine(host, `paso 5 FALLA (control): ${String(err)}`))
    }
  } else {
    log(formatLine(host, 'paso 5 OMITIDO: sin --gateway no hay pata de control'))
  }

  // ── Paso 6: delegation.match ─────────────────────────────────────────────
  if (status) {
    const verdict = evaluateDelegationMatch(
      host,
      status.delegation?.match,
      status.environment?.vercelEnv,
    )
    if (verdict === null) log(formatLine(host, 'paso 6 OK: delegation.match=MATCH'))
    else if (verdict.fail) failures.push(verdict.message)
    else log(verdict.message)
  }

  for (const f of failures) logError(f)
  const verdict = decideVerdict(host, failures.length, inconclusive.length, declaresDelegation)
  if (verdict.isError) logError(verdict.line)
  else log(verdict.line)
  return verdict.exitCode
}

/**
 * Entrada CLI. Separada de `runSmoke` para que el test pueda ejercitar el
 * parseo de argumentos sin red.
 */
export async function main(argv, deps = DEFAULT_DEPS) {
  const { logError } = { ...DEFAULT_DEPS, ...deps }
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    logError(`ERROR: ${parsed.error}`)
    logError(USAGE)
    return parsed.exitCode
  }
  return runSmoke({ host: parsed.host, gateway: parsed.gateway }, deps)
}

// CD-15 — main-guard: sin esto, importar este archivo desde el test dispararía
// el smoke contra la red durante `npm test`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code)
  })
}
