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
 *   - si un slug de red inválido corta en `400` en vez de cobrar la red por
 *     defecto (paso 4b, la pata de AC-1b que no depende de ningún body).
 *
 * POR QUÉ UNA TERNA Y NO UN STATUS CODE: un `200 OK` se ve igual con el header
 * llegando y sin llegar; un `402` bien formado, también. Por eso cada prueba
 * compara TRES patas: gateway directo (control) / host con el header / host sin
 * el header. Si las dos últimas son iguales, el header no llegó.
 *
 * ⚠️ TRES VALORES, NO DOS (fix-pack AR · `BLQ-BAJO-1`). Cada paso puede salir
 * OK / FALLA / **INCONCLUSO**. El tercero existe porque las ternas comparan
 * BODIES, y hay dos estados del ambiente en los que las dos patas son iguales
 * por un motivo que NO es "el header no atraviesa el proxy":
 *   - `503 *_DISABLED` — el ambiente no delega ese endpoint (es el estado
 *     declarado de `wasiai-v2` / `wasiai-v2.vercel.app`, DT-2 B+);
 *   - `429` — rate limit del borde; medido el 2026-08-18 contra `app.wasiai.io`:
 *     los 10 primeros POST seguidos a `/compose` pasaron y el 11.º ya devolvió
 *     `429`. El smoke hace 5 POST a `/compose`, así que está por debajo — pero
 *     dos corridas encadenadas no.
 * Reportar esos dos como "AC-1 FALLA: el header no atraviesa el proxy" es
 * NOMBRAR LA CAUSA EQUIVOCADA, que es exactamente el error que abrió esta HU un
 * piso más arriba. Un paso inconcluso NO suma a `failures`.
 *
 * POR QUÉ UN INCONCLUSO NO CAMBIA EL EXIT CODE, Y POR QUÉ ESO NO AFLOJA NADA:
 * el caso "este ambiente debería delegar y no delega" NO llega nunca a los
 * pasos 3/4/4b como inconcluso — lo cazan antes, y con exit 1, el paso 2 (AC-8:
 * figura en `delegation.runtime` y contesta `503 *_DISABLED`) o el paso 6 (AC-7:
 * `runtime` vacío contra un manifiesto que declara endpoints ⇒ `DRIFT`). Los
 * inconclusos que quedan son los del ambiente que el manifiesto declara como no
 * delegante. Por eso la última línea NUNCA dice `SMOKE OK` a secas cuando hubo
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
  'Un paso puede salir OK, FALLA o INCONCLUSO. INCONCLUSO no cambia el exit code,',
  'y la última línea dice cuántos hubo: un ambiente que no delega NO se reporta',
  'como si la lista blanca estuviera rota.',
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
 * GUARDA DE ENTRADA de los pasos 3, 4 y 4b — fix-pack AR `BLQ-BAJO-1`.
 *
 * Los tres pasos comparan BODIES para decidir si el header atravesó el proxy.
 * Esa comparación sólo significa algo si la petición llegó a ejecutarse. Devuelve
 * el mensaje de INCONCLUSO (y el paso NO se corre) en los dos estados medidos en
 * que las patas salen iguales por un motivo ajeno a la lista blanca:
 *
 *   - `503 *_DISABLED` ⇒ el ambiente no delega ese endpoint. Se reutiliza
 *     `evaluateDisabled` a propósito: es el único lugar que sabe reconocer
 *     `*_DISABLED`, y tenerlo dos veces sería dos criterios que divergen.
 *   - `429` ⇒ rate limit del borde. Sin esta rama, el smoke acusa a la lista
 *     blanca por una respuesta que ni siquiera llegó al gateway.
 *
 * Devuelve `null` si la respuesta es medible (el paso se corre normalmente).
 */
export function evaluateStepPrecondition(host, step, endpoint, status, bodyText) {
  const disabled = evaluateDisabled(host, endpoint, status, bodyText)
  if (disabled) {
    return formatLine(
      host,
      `paso ${step} INCONCLUSO: /${endpoint} responde ${status} ${disabled.error} en este ` +
        'ambiente (no delega) ⇒ NO se puede medir si el header atraviesa el proxy. ' +
        'La causa NO es la lista blanca',
    )
  }
  if (status === 429) {
    return formatLine(
      host,
      `paso ${step} INCONCLUSO: /${endpoint} responde 429 (rate limit) ⇒ las dos patas ` +
        'serían iguales por el límite, no por la lista blanca. Reintentar más tarde',
    )
  }
  return null
}

/**
 * Paso 4b (AC-1b · fix-pack AR `MNR-3`) — la pata SIN campos volátiles.
 *
 * Discrimina por STATUS CODE y nada más: hoy `app.wasiai.io` devuelve `402`
 * (aplica la red por defecto porque descarta el header) y el gateway devuelve
 * `400 CHAIN_NOT_SUPPORTED`. No compara bodies ni `accepts[0]`, así que —a
 * diferencia del paso 4— no depende de que el upstream mantenga `accepts[0]`
 * determinista entre dos llamadas. Si el gateway algún día le agrega un `nonce`
 * o un `validBefore`, este paso sigue discriminando y el 4 no.
 *
 * El body recibido se imprime SÓLO en el mensaje de falla, para diagnosticar; la
 * decisión no lo mira.
 */
export function evaluateInvalidChainSlug(host, status, bodyText) {
  if (status === 400) return null
  return formatLine(
    host,
    `AC-1b FALLA: con x-payment-chain: ${INVALID_CHAIN_SLUG} se esperaba 400 ` +
      `(CHAIN_NOT_SUPPORTED) y llegó ${status} ⇒ el header no atraviesa el proxy y se ` +
      `aplicó la red por defecto. Recibido: ${String(bodyText).slice(0, 200)}`,
  )
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
      if (disabled) failures.push(disabled.message)
      else log(formatLine(host, `paso 2 OK: /${endpoint} responde ${res.status} (no *_DISABLED)`))
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
    // tampoco lo es y sería una petición al pedo.
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
      const problem = evaluateContractingTerna(host, withHeader.text, without.text)
      if (problem) failures.push(problem)
      else log(formatLine(host, 'paso 3 OK: x-a2a-contracting-depth atraviesa el proxy'))
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
      const problem = evaluatePaymentChainTerna(
        host,
        withHeader.text,
        without.text,
        'eip155:84532',
      )
      if (problem) failures.push(problem)
      else log(formatLine(host, 'paso 4 OK: x-payment-chain atraviesa el proxy'))
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
      else log(formatLine(host, 'paso 4b OK: un slug de red inválido corta en 400'))
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
  const inconclusiveSuffix =
    inconclusive.length > 0 ? ` + ${inconclusive.length} paso(s) INCONCLUSO(s)` : ''
  if (failures.length > 0) {
    logError(formatLine(host, `SMOKE FALLA — ${failures.length} problema(s)${inconclusiveSuffix}`))
    return EXIT_FAIL
  }
  // Sin fallas pero con pasos que no se pudieron medir, el veredicto NO puede
  // ser `SMOKE OK` a secas: sería afirmar que los headers atraviesan el proxy en
  // un ambiente donde no se midió.
  if (inconclusive.length > 0) {
    log(
      formatLine(
        host,
        `SMOKE OK — ${inconclusive.length} paso(s) INCONCLUSO(s): en este ambiente NO se ` +
          'verificó que los headers atraviesen el proxy',
      ),
    )
    return EXIT_OK
  }
  log(formatLine(host, 'SMOKE OK'))
  return EXIT_OK
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
