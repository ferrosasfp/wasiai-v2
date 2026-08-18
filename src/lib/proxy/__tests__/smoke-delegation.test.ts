/**
 * smoke-delegation.test.ts — WKH-361 W2 · T-08, T-08b (AC-8).
 *
 * ⚠️ UBICACIÓN A PROPÓSITO (CD-14). `vitest.config.ts:10` fija
 * `include: ['src/**\/*.test.{ts,tsx}']`: un test en `scripts/__tests__/` NO LO
 * LEVANTA NADIE y `npm test` queda verde igual — o sea, AC-8 tendría cobertura
 * CERO y nadie se enteraría. Es la misma enfermedad que cura esta HU, un piso
 * más abajo. Por eso el test vive bajo `src/` e importa el script por ruta
 * relativa.
 *
 * Este es el ÚNICO control automático de `scripts/smoke-delegation.mjs`:
 * `scripts/**` está fuera del typecheck (`tsconfig.json`) y fuera del lint
 * (`eslint.config.mjs`).
 *
 * No necesita mock de `@/lib/env`: el script es Node puro y no importa nada de
 * `src/`. Si algún día lo necesitara, sería la señal de que dejó de serlo.
 */
import { describe, it, expect, vi } from 'vitest'

// @ts-expect-error — .mjs sin tipos, a propósito: el script es Node puro y
// `scripts/**` está fuera del typecheck del repo.
import * as smoke from '../../../../scripts/smoke-delegation.mjs'

interface SmokeModule {
  USAGE: string
  EXIT_OK: number
  EXIT_FAIL: number
  EXIT_USAGE: number
  parseArgs: (argv: string[]) => {
    ok: boolean
    host?: string
    gateway?: string | null
    exitCode?: number
    error?: string
  }
  formatLine: (host: string, message: string) => string
  evaluateDisabled: (
    host: string,
    endpoint: string,
    status: number,
    body: string,
  ) => { host: string; endpoint: string; status: number; error: string; message: string } | null
  evaluateStepPrecondition: (
    host: string,
    step: number | string,
    endpoint: string,
    status: number,
    body: string,
  ) => string | null
  evaluateInvalidChainSlug: (host: string, status: number, body: string) => string | null
  GATEWAY_EXECUTED_STATUSES: readonly number[]
  STEP_CONTROL_LEG: (step: number | string) => string
  decideVerdict: (
    host: string,
    failureCount: number,
    inconclusiveCount: number,
    declaresDelegation: boolean,
  ) => { exitCode: number; isError: boolean; line: string }
  INVALID_CHAIN_SLUG: string
  evaluateContractingTerna: (host: string, a: string, b: string) => string | null
  evaluatePaymentChainTerna: (
    host: string,
    a: string,
    b: string,
    expectedNetwork: string,
  ) => string | null
  evaluateDelegationMatch: (
    host: string,
    match: string,
    vercelEnv: string | null,
  ) => { fail: boolean; message: string } | null
  runSmoke: (
    args: { host: string; gateway: string | null },
    deps: { fetchImpl: unknown; log: unknown; logError: unknown },
  ) => Promise<number>
  main: (
    argv: string[],
    deps: { fetchImpl: unknown; log: unknown; logError: unknown },
  ) => Promise<number>
}

const s = smoke as unknown as SmokeModule

const STATUS_OK = {
  environment: { host: 'app.wasiai.io', vercelEnv: 'production', declaredAs: 'wasiai-prod' },
  delegation: {
    runtime: ['capabilities', 'compose', 'orchestrate'],
    declared: ['capabilities', 'compose', 'orchestrate'],
    match: 'MATCH',
  },
}

describe('CD-15: el script no ejecuta nada al importarse', () => {
  it('exporta funciones puras y no disparó ninguna llamada de red al cargar', () => {
    // Si el archivo corriera el smoke al importarse, este archivo de test
    // saldría a internet en cada `npm test`.
    expect(typeof s.runSmoke).toBe('function')
    expect(typeof s.main).toBe('function')
    expect(typeof s.parseArgs).toBe('function')
    expect(s.EXIT_USAGE).toBe(2)
  })
})

describe('T-08b (AC-8): sin argumento de host', () => {
  it('⇒ exit 2 e imprime el uso', async () => {
    const logError = vi.fn()
    const fetchImpl = vi.fn()
    const code = await s.main([], { fetchImpl, log: vi.fn(), logError })
    expect(code).toBe(2)
    const printed = logError.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('Uso: node scripts/smoke-delegation.mjs <host>')
    expect(printed).toContain('falta el argumento <host>')
    // Sin host no se le pega a NADA: un smoke con host por defecto es el mismo
    // footgun que abrió esta HU.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('--gateway sin URL también sale 2', async () => {
    const logError = vi.fn()
    const code = await s.main(['app.wasiai.io', '--gateway'], {
      fetchImpl: vi.fn(),
      log: vi.fn(),
      logError,
    })
    expect(code).toBe(2)
  })

  it('parseArgs acepta host + --gateway y normaliza el esquema y la barra final', () => {
    const parsed = s.parseArgs([
      'https://app.wasiai.io/',
      '--gateway',
      'https://wasiai-a2a-production.up.railway.app/',
    ])
    expect(parsed.ok).toBe(true)
    expect(parsed.host).toBe('app.wasiai.io')
    expect(parsed.gateway).toBe('https://wasiai-a2a-production.up.railway.app')
  })
})

describe('T-08 (AC-8): un endpoint delegado que responde 503 *_DISABLED', () => {
  it('evaluateDisabled devuelve host, endpoint, status y error', () => {
    const out = s.evaluateDisabled(
      'app.wasiai.io',
      'compose',
      503,
      '{"error":"COMPOSE_DISABLED","detail":"Legacy compose handler removed in WKH-66."}',
    )
    expect(out).not.toBeNull()
    expect(out?.host).toBe('app.wasiai.io')
    expect(out?.endpoint).toBe('compose')
    expect(out?.status).toBe(503)
    expect(out?.error).toBe('COMPOSE_DISABLED')
    expect(out?.message).toContain('app.wasiai.io')
    expect(out?.message).toContain('compose')
    expect(out?.message).toContain('503')
    expect(out?.message).toContain('COMPOSE_DISABLED')
  })

  it('un 503 que NO es *_DISABLED no dispara AC-8', () => {
    expect(
      s.evaluateDisabled('app.wasiai.io', 'compose', 503, '{"error":"UPSTREAM_BUSY"}'),
    ).toBeNull()
    expect(s.evaluateDisabled('app.wasiai.io', 'compose', 200, '{}')).toBeNull()
  })

  it('runSmoke termina con código distinto de 0 e imprime los cuatro datos', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      // compose y orchestrate contestan 503 COMPOSE/ORCHESTRATE_DISABLED
      const which = String(url).includes('orchestrate') ? 'ORCHESTRATE' : 'COMPOSE'
      return new Response(JSON.stringify({ error: `${which}_DISABLED` }), { status: 503 })
    })

    const code = await s.runSmoke(
      { host: 'app.wasiai.io', gateway: null },
      { fetchImpl, log, logError },
    )
    expect(code).not.toBe(0)
    expect(code).toBe(1)

    const errors = logError.mock.calls.map((c) => String(c[0])).join('\n')
    expect(errors).toContain('app.wasiai.io')
    expect(errors).toContain('compose')
    expect(errors).toContain('503')
    expect(errors).toContain('COMPOSE_DISABLED')
    expect(errors).toContain('ORCHESTRATE_DISABLED')
  })

  it('cada línea de salida empieza por el host probado', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'COMPOSE_DISABLED' }), { status: 503 })
    })
    await s.runSmoke({ host: 'app.wasiai.io', gateway: null }, { fetchImpl, log, logError })
    const lines = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0]))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.startsWith('[app.wasiai.io] ')).toBe(true)
    }
  })
})

describe('las dos ternas — el discriminador que un 200 OK no da', () => {
  it('terna de contracting: dos respuestas idénticas ⇒ el header no llegó', () => {
    const same = '{"error":"Missing or empty steps array","code":"VALIDATION_ERROR"}'
    const problem = s.evaluateContractingTerna('app.wasiai.io', same, same)
    expect(problem).toContain('IDÉNTICA')
    expect(problem).toContain('app.wasiai.io')
  })

  it('terna de contracting: distintas y con CONTRACTING_DEPTH_EXCEEDED ⇒ OK', () => {
    expect(
      s.evaluateContractingTerna(
        'app.wasiai.io',
        '{"error_code":"CONTRACTING_DEPTH_EXCEEDED","requestId":"a"}',
        '{"code":"VALIDATION_ERROR","requestId":"b"}',
      ),
    ).toBeNull()
  })

  it('terna de contracting: distintas pero sin el error_code esperado ⇒ falla', () => {
    // Dos requestId distintos alcanzan para que los bodies difieran: si el
    // smoke sólo comparara "son distintos", esto pasaría en verde con el
    // header sin llegar.
    expect(
      s.evaluateContractingTerna(
        'app.wasiai.io',
        '{"code":"VALIDATION_ERROR","requestId":"aaa"}',
        '{"code":"VALIDATION_ERROR","requestId":"bbb"}',
      ),
    ).toContain('no contiene CONTRACTING_DEPTH_EXCEEDED')
  })

  it('terna de x-payment-chain: el defecto real medido el 2026-08-18 se detecta', () => {
    // accepts[0] byte-idéntico con y sin header = el bug de esta HU.
    const kite = JSON.stringify({
      accepts: [
        {
          network: 'eip155:2368',
          maxAmountRequired: '1010000000000000',
          asset: '0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9',
        },
      ],
    })
    const problem = s.evaluatePaymentChainTerna('app.wasiai.io', kite, kite, 'eip155:84532')
    expect(problem).toContain('IDÉNTICO')
  })

  it('terna de x-payment-chain: la cotización correcta de Base Sepolia pasa', () => {
    const base = JSON.stringify({
      accepts: [
        {
          network: 'eip155:84532',
          maxAmountRequired: '1010',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        },
      ],
    })
    const kite = JSON.stringify({
      accepts: [
        {
          network: 'eip155:2368',
          maxAmountRequired: '1010000000000000',
          asset: '0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9',
        },
      ],
    })
    expect(s.evaluatePaymentChainTerna('app.wasiai.io', base, kite, 'eip155:84532')).toBeNull()
  })

  it('terna de x-payment-chain: distintas pero con la red equivocada ⇒ falla', () => {
    // Compara accepts[0] COMPLETO: cambiar sólo el monto sin cambiar la red no
    // alcanza para dar verde.
    const wrongNetwork = JSON.stringify({
      accepts: [{ network: 'eip155:2368', maxAmountRequired: '999', asset: '0x8E04' }],
    })
    const kite = JSON.stringify({
      accepts: [{ network: 'eip155:2368', maxAmountRequired: '1010000000000000', asset: '0x8E04' }],
    })
    expect(
      s.evaluatePaymentChainTerna('app.wasiai.io', wrongNetwork, kite, 'eip155:84532'),
    ).toContain('se esperaba network eip155:84532')
  })
})

describe('fix-pack AR `BLQ-BAJO-1`: un ambiente que no delega da INCONCLUSO, no FALLA', () => {
  const DISABLED_BODY = JSON.stringify({
    error: 'COMPOSE_DISABLED',
    detail: 'Legacy compose handler removed in WKH-66.',
  })

  it('evaluateStepPrecondition reconoce el 503 *_DISABLED y nombra la causa real', () => {
    const msg = s.evaluateStepPrecondition('wasiai-v2.vercel.app', 3, 'compose', 503, DISABLED_BODY)
    expect(msg).toContain('INCONCLUSO')
    expect(msg).toContain('COMPOSE_DISABLED')
    expect(msg).toContain('no delega')
    // El mensaje tiene que DESMENTIR explícitamente la causa que acusaba antes.
    expect(msg).toContain('La causa NO es la lista blanca')
    expect(msg).not.toContain('FALLA')
  })

  it('evaluateStepPrecondition reconoce el 429 del borde', () => {
    const msg = s.evaluateStepPrecondition('app.wasiai.io', 4, 'compose', 429, 'Too Many Requests')
    expect(msg).toContain('INCONCLUSO')
    expect(msg).toContain('429')
    expect(msg).toContain('rate limit')
  })

  it('una respuesta medible NO se salta: 400, 402 y 403 devuelven null', () => {
    expect(
      s.evaluateStepPrecondition('app.wasiai.io', 3, 'compose', 402, '{"accepts":[]}'),
    ).toBeNull()
    expect(
      s.evaluateStepPrecondition('app.wasiai.io', 3, 'compose', 400, '{"error_code":"X"}'),
    ).toBeNull()
    // 403 INSUFFICIENT_BUDGET también prueba que el gateway ejecutó.
    expect(
      s.evaluateStepPrecondition(
        'app.wasiai.io',
        3,
        'compose',
        403,
        '{"error_code":"INSUFFICIENT_BUDGET"}',
      ),
    ).toBeNull()
  })

  it('runSmoke contra un host con la delegación apagada: 0 acusaciones a la lista blanca', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        // El manifiesto declara `delegated: []` para este ambiente (DT-2 B+),
        // así que runtime vacío es MATCH: no hay drift que reportar.
        return new Response(
          JSON.stringify({
            environment: { host: 'wasiai-v2.vercel.app', vercelEnv: 'production' },
            delegation: { runtime: [], declared: [], match: 'MATCH' },
          }),
          { status: 200 },
        )
      }
      return new Response(DISABLED_BODY, { status: 503 })
    })

    const code = await s.runSmoke(
      { host: 'wasiai-v2.vercel.app', gateway: null },
      { fetchImpl, log, logError },
    )

    const out = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0])).join('\n')
    // La acusación falsa que reportó el AR — textual — no puede volver a salir.
    expect(out).not.toContain('el header no atraviesa el proxy')
    expect(out).not.toContain('IDÉNTICA')
    expect(out).not.toContain('AC-1 FALLA')
    expect(out).not.toContain('AC-1b FALLA')
    // Los tres pasos que pegan a /compose salen inconclusos, con su causa.
    expect(out).toContain('paso 3 INCONCLUSO')
    expect(out).toContain('paso 4 INCONCLUSO')
    expect(out).toContain('paso 4b INCONCLUSO')
    expect(out).toContain('paso 2 OMITIDO')
    // Exit 0, pero el veredicto NO afirma que los headers atraviesen.
    expect(code).toBe(0)
    expect(out).toContain('3 paso(s) INCONCLUSO(s)')
    expect(out).toContain('NO se verificó que los headers atraviesen el proxy')
    expect(logError).not.toHaveBeenCalled()
  })

  it('el ambiente que SÍ debería delegar y no delega sigue saliendo exit 1 (AC-8 lo caza antes)', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      return new Response(DISABLED_BODY, { status: 503 })
    })
    const code = await s.runSmoke(
      { host: 'app.wasiai.io', gateway: null },
      { fetchImpl, log, logError },
    )
    // Esta es la calibración en la otra dirección: la guarda de INCONCLUSO no
    // puede tapar el caso que el smoke existe para cazar.
    expect(code).toBe(1)
    const errors = logError.mock.calls.map((c) => String(c[0])).join('\n')
    expect(errors).toContain('AC-8 FALLA')
    expect(errors).toContain('COMPOSE_DISABLED')
  })

  it('un 404 en el paso 1 nombra que la HU no está desplegada', async () => {
    const logError = vi.fn()
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }))
    await s.runSmoke(
      { host: 'wasiai-v2.vercel.app', gateway: null },
      { fetchImpl, log: vi.fn(), logError },
    )
    const errors = logError.mock.calls.map((c) => String(c[0])).join('\n')
    expect(errors).toContain('NO tiene desplegada la HU')
  })
})

describe('fix-pack AR it.2 `BLQ-BAJO-2`: el criterio es POSITIVO, no una lista de estados malos', () => {
  // La versión anterior de la guarda enumeraba `503 *_DISABLED` y `429` y el
  // docblock declaraba esa lista exhaustiva. El AR la rompió con las DOS
  // respuestas que el propio proxy genera sin tocar el gateway.
  const TIMEOUT_BODY = JSON.stringify({ error: 'GATEWAY_TIMEOUT' })
  const UPSTREAM_BODY = JSON.stringify({ error: 'UPSTREAM_ERROR', detail: 'upstream error' })
  /** La frase EXACTA que el AR reprodujo. Ninguna rama de INCONCLUSO puede emitirla. */
  const ACUSACION = 'el header no atraviesa el proxy'

  it('T-FP2-1: el 504 que genera el proxy por timeout ⇒ INCONCLUSO, no acusación', () => {
    const msg = s.evaluateStepPrecondition('app.wasiai.io', 3, 'compose', 504, TIMEOUT_BODY)
    expect(msg).toContain('INCONCLUSO')
    expect(msg).toContain('504')
    expect(msg).toContain('EL PROXY')
    expect(msg).toContain('no contesta a tiempo')
    expect(msg).not.toContain(ACUSACION)
    expect(msg).not.toContain('FALLA')
  })

  it('T-FP2-2: el 502 que genera el proxy (5xx upstream o conexión caída) ⇒ INCONCLUSO', () => {
    const msg = s.evaluateStepPrecondition('app.wasiai.io', 4, 'compose', 502, UPSTREAM_BODY)
    expect(msg).toContain('INCONCLUSO')
    expect(msg).toContain('502')
    expect(msg).toContain('La causa NO es la lista blanca')
    expect(msg).not.toContain(ACUSACION)
  })

  it('T-FP2-3: un status que NADIE enumeró ⇒ INCONCLUSO y sin causa inventada', () => {
    // El punto del criterio positivo: lo que no se conoce no se acusa. Si esto
    // volviera a `null`, el paso se correría y compararía dos bodies que no
    // significan nada.
    for (const status of [418, 500, 404, 503, 302]) {
      const msg = s.evaluateStepPrecondition('app.wasiai.io', '4b', 'compose', status, 'lo que sea')
      expect(msg, `status ${status} no salió INCONCLUSO`).toContain('INCONCLUSO')
      expect(msg).toContain(String(status))
      expect(msg).not.toContain(ACUSACION)
    }
  })

  it('T-FP2-4: `GATEWAY_EXECUTED_STATUSES` es el contrato, y son exactamente estos tres', () => {
    // El literal es el contrato: agregar un status acá es decir "esta respuesta
    // prueba que el gateway ejecutó", y eso hay que medirlo, no suponerlo.
    expect([...s.GATEWAY_EXECUTED_STATUSES].sort((a, b) => a - b)).toEqual([400, 402, 403])
  })

  it('T-FP2-5: con el gateway caído, el smoke NO acusa a la lista blanca (la reproducción del AR)', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    // Ambiente que SÍ delega, lista blanca PERFECTA, gateway con timeout: el
    // proxy contesta 504 con body estático en las dos patas de cada terna.
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      return new Response(TIMEOUT_BODY, { status: 504 })
    })

    await s.runSmoke({ host: 'app.wasiai.io', gateway: null }, { fetchImpl, log, logError })

    const out = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0])).join('\n')
    expect(out).not.toContain(ACUSACION)
    expect(out).not.toContain('IDÉNTICA')
    expect(out).not.toContain('AC-1 FALLA')
    expect(out).not.toContain('AC-1b FALLA')
    expect(out).toContain('paso 3 INCONCLUSO')
    expect(out).toContain('paso 4 INCONCLUSO')
    expect(out).toContain('paso 4b INCONCLUSO')
    expect(out).toContain('no contesta a tiempo')
  })
})

describe('fix-pack AR it.2 `BLQ-BAJO-3`: un ambiente que DECLARA delegar y no deja medir NO es un OK', () => {
  it('T-FP3-1: decideVerdict — las cuatro combinaciones', () => {
    // (a) hay fallas ⇒ 1, con el sufijo de inconclusos.
    const conFallas = s.decideVerdict('app.wasiai.io', 3, 2, true)
    expect(conFallas.exitCode).toBe(1)
    expect(conFallas.isError).toBe(true)
    expect(conFallas.line).toContain('SMOKE FALLA — 3 problema(s)')
    expect(conFallas.line).toContain('2 paso(s) INCONCLUSO(s)')

    // (b) 0 fallas + inconclusos + el ambiente DECLARA delegar ⇒ 1. Es el caso
    // que salía 0 y con "paso 2 OK" sobre un 429.
    const declara = s.decideVerdict('app.wasiai.io', 0, 3, true)
    expect(declara.exitCode).toBe(1)
    expect(declara.isError).toBe(true)
    expect(declara.line).toContain('DECLARA delegar')
    expect(declara.line).toContain('NO se midieron')

    // (c) 0 fallas + inconclusos + el ambiente NO declara delegar ⇒ 0. El AR
    // pidió explícitamente no tocar este caso: el manifiesto dice que no delega.
    const noDeclara = s.decideVerdict('wasiai-v2.vercel.app', 0, 3, false)
    expect(noDeclara.exitCode).toBe(0)
    expect(noDeclara.isError).toBe(false)
    expect(noDeclara.line).toContain('SMOKE OK — 3 paso(s) INCONCLUSO(s)')
    expect(noDeclara.line).toContain('NO se verificó que los headers atraviesen el proxy')

    // (d) nada que reportar ⇒ 0 y `SMOKE OK` a secas.
    const limpio = s.decideVerdict('app.wasiai.io', 0, 0, true)
    expect(limpio.exitCode).toBe(0)
    expect(limpio.line).toContain('SMOKE OK')
    expect(limpio.line).not.toContain('INCONCLUSO')
  })

  it('T-FP3-2: con 429 en todo, el paso 2 NO dice OK y el proceso sale 1', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    // El estado que dispara reintentar el smoke: rate limit del borde en cada
    // POST. Antes daba `paso 2 OK: /compose responde 429 (no *_DISABLED)`, los
    // tres headers del camino del dinero medidos cero veces, y EXIT 0.
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      return new Response('Too Many Requests', { status: 429 })
    })

    const code = await s.runSmoke(
      { host: 'app.wasiai.io', gateway: null },
      { fetchImpl, log, logError },
    )

    const out = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0])).join('\n')
    expect(out).not.toContain('paso 2 OK')
    expect(out).toContain('paso 2 INCONCLUSO')
    expect(out).toContain('rate limit')
    // Ni una acusación falsa: el 429 tampoco es "el header no atraviesa".
    expect(out).not.toContain('el header no atraviesa el proxy')
    expect(code).toBe(1)
    expect(out).toContain('DECLARA delegar')
  })

  it('T-FP3-3: con el gateway caído (504) en un ambiente que declara delegar, también sale 1', async () => {
    const log = vi.fn()
    const logError = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'GATEWAY_TIMEOUT' }), { status: 504 })
    })
    const code = await s.runSmoke(
      { host: 'app.wasiai.io', gateway: null },
      { fetchImpl, log, logError },
    )
    // Los dos hallazgos juntos: sin acusación falsa (BLQ-BAJO-2) Y sin exit 0
    // sobre una corrida que no midió nada (BLQ-BAJO-3).
    expect(code).toBe(1)
    const out = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0])).join('\n')
    expect(out).not.toContain('el header no atraviesa el proxy')
    expect(out).toContain('DECLARA delegar')
  })
})

describe('paso 4b — slug inválido ⇒ 400 CHAIN_NOT_SUPPORTED (`MNR-3` + it.2 `MNR-it2-1`)', () => {
  // ⚠️ El título decía `400 ⇒ sin problema` — la MISMA afirmación vieja de
  // `MNR-CR-2`, dicha en cuatro palabras. La cazó enumerar los títulos del
  // archivo, que es la mitigación que reemplazó al `grep` de la frase.
  it('400 CON el error_code de la red ⇒ sin problema', () => {
    expect(
      s.evaluateInvalidChainSlug('app.wasiai.io', 400, '{"error_code":"CHAIN_NOT_SUPPORTED"}'),
    ).toBeNull()
  })

  it('el defecto real medido el 2026-08-18 (402 con la red por defecto) se detecta', () => {
    const problem = s.evaluateInvalidChainSlug(
      'app.wasiai.io',
      402,
      '{"accepts":[{"network":"eip155:2368","maxAmountRequired":"1010000000000000"}]}',
    )
    expect(problem).toContain('AC-1b FALLA')
    expect(problem).toContain('402')
    expect(problem).toContain('red por defecto')
  })

  it('exige el status 400 Y el error_code: otro 400 del gateway NO pasa, y sin campos volátiles', () => {
    // ⚠️ El título de este test decía "decide SOLO por el status: un 400 con
    // cualquier body pasa" — la conducta que `MNR-it2-1` ELIMINÓ, dejada viva en
    // la línea que sale por la terminal en cada `npm test` (`MNR-CR-2`).
    //
    // Lo que el test mide HOY: un 400 que no trae `CHAIN_NOT_SUPPORTED` FALLA.
    // Lo que sigue siendo cierto de `MNR-3`: no se compara `accepts[0]` ni
    // ningún campo volátil, así que si el upstream le agrega un nonce al
    // challenge, este paso sigue midiendo.
    const otro400 = s.evaluateInvalidChainSlug(
      'app.wasiai.io',
      400,
      '{"error":"Missing or empty steps array","code":"VALIDATION_ERROR","requestId":"b2ee2f9e"}',
    )
    expect(otro400).toContain('NO es el')
    expect(otro400).toContain('CHAIN_NOT_SUPPORTED')
    expect(s.evaluateInvalidChainSlug('app.wasiai.io', 400, 'texto que no es JSON')).toContain(
      'AC-1b FALLA',
    )
  })

  it('un 200 lo rechaza la función pura — pero `runSmoke` no la alcanza: antes corta la guarda', () => {
    // `MNR-CR-2`, segunda mitad. La aserción del 200 documenta el contrato de la
    // FUNCIÓN, no una garantía del sistema compuesto: desde `BLQ-BAJO-2` el 200
    // no está en `GATEWAY_EXECUTED_STATUSES`, así que en una corrida real el paso
    // 4b sale INCONCLUSO y `evaluateInvalidChainSlug` nunca se llama. Las dos
    // mitades van juntas y ejecutadas para que no se pueda leer una sin la otra.
    expect(
      s.evaluateInvalidChainSlug('app.wasiai.io', 200, '{"error_code":"CHAIN_NOT_SUPPORTED"}'),
    ).not.toBeNull()
    expect(s.GATEWAY_EXECUTED_STATUSES).not.toContain(200)
    const guarda = s.evaluateStepPrecondition(
      'app.wasiai.io',
      '4b',
      'compose',
      200,
      '{"error_code":"CHAIN_NOT_SUPPORTED"}',
    )
    expect(guarda).toContain('paso 4b INCONCLUSO')
    expect(guarda).toContain('NO prueba que la petición se haya ejecutado')
  })

  it('el slug es el literal de la Evidencia exigida del SDD', () => {
    expect(s.INVALID_CHAIN_SLUG).toBe('nonexistent-chain-xyz')
  })

  it('runSmoke manda el slug inválido como x-payment-chain en un POST propio', async () => {
    const seen: Array<{ url: string; chain: string | null }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit)
      seen.push({ url: String(url), chain: headers.get('x-payment-chain') })
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      if (headers.get('x-payment-chain') === 'nonexistent-chain-xyz') {
        return new Response('{"error_code":"CHAIN_NOT_SUPPORTED"}', { status: 400 })
      }
      return new Response('{"accepts":[{"network":"eip155:84532"}]}', { status: 402 })
    })
    const log = vi.fn()
    await s.runSmoke({ host: 'app.wasiai.io', gateway: null }, { fetchImpl, log, logError: vi.fn() })
    expect(seen.filter((r) => r.chain === 'nonexistent-chain-xyz')).toHaveLength(1)
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('paso 4b OK')
  })
})

describe('paso 6: delegation.match', () => {
  it('MATCH ⇒ sin problema', () => {
    expect(s.evaluateDelegationMatch('app.wasiai.io', 'MATCH', 'production')).toBeNull()
  })

  it('DRIFT fuera de preview ⇒ falla', () => {
    const out = s.evaluateDelegationMatch('app.wasiai.io', 'DRIFT', 'production')
    expect(out?.fail).toBe(true)
    expect(out?.message).toContain('DRIFT')
  })

  it('UNDECLARED_HOST en un preview ⇒ imprime PREVIEW_NOT_DECLARED y NO falla', () => {
    const out = s.evaluateDelegationMatch('algo.vercel.app', 'UNDECLARED_HOST', 'preview')
    expect(out?.fail).toBe(false)
    expect(out?.message).toContain('PREVIEW_NOT_DECLARED')
  })
})

describe('fix-pack CR `MNR-CR-1`: la guarda cubre las DOS patas, no sólo la primera', () => {
  /**
   * El defecto que cerró este fix-pack: `evaluateStepPrecondition` se aplicaba
   * sólo a la petición CON el header. La pata SIN el header —el discriminador de
   * la terna, la que decide si "las dos son iguales"— se comparaba sin mirar su
   * status. Con las primeras patas medibles y las de control en `429`, el smoke
   * imprimía `paso 3 OK` + `paso 4 OK` + `SMOKE OK` y salía **0**.
   *
   * Estos tests son el candado. Los tres primeros mueren si se le saca la guarda
   * a la 2ª pata; el cuarto es la calibración en la otra dirección (que la guarda
   * nueva no convierta en INCONCLUSO una terna que sí se puede medir).
   */

  /** Terna: 1ª pata medible; 2ª pata (sin header) con el status que se le pase. */
  function fetchConPataDeControl(statusControl: number, bodyControl: string) {
    let contractingSinHeader = 0
    return vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit)
      if (String(url).includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      const esPago = String(init?.body ?? '').includes('wasi-chainlink-price')
      if (headers.get('x-a2a-contracting-depth') === '99') {
        return new Response('{"error":"CONTRACTING_DEPTH_EXCEEDED"}', { status: 400 })
      }
      if (headers.get('x-payment-chain') === 'base-sepolia') {
        return new Response('{"accepts":[{"network":"eip155:84532","maxAmountRequired":"1"}]}', {
          status: 402,
        })
      }
      if (headers.get('x-payment-chain') === s.INVALID_CHAIN_SLUG) {
        return new Response('{"error_code":"CHAIN_NOT_SUPPORTED"}', { status: 400 })
      }
      // Pata SIN header del paso 4.
      if (esPago) return new Response(bodyControl, { status: statusControl })
      // Los 2 POST del paso 2 son medibles; el 3.º es la pata sin header del paso 3.
      contractingSinHeader += 1
      if (contractingSinHeader <= 2) {
        return new Response('{"code":"VALIDATION_ERROR","requestId":"aaa"}', { status: 400 })
      }
      return new Response(bodyControl, { status: statusControl })
    })
  }

  async function correr(statusControl: number, bodyControl: string) {
    const log = vi.fn()
    const logError = vi.fn()
    const code = await s.runSmoke(
      { host: 'app.wasiai.io', gateway: null },
      { fetchImpl: fetchConPataDeControl(statusControl, bodyControl), log, logError },
    )
    const out = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0])).join('\n')
    return { code, out }
  }

  it('T-CR1-1: primeras patas medibles + patas de control en 429 ⇒ NI `paso 3 OK` NI `paso 4 OK`', async () => {
    const { out } = await correr(429, '{"error":"rate limited"}')
    // Las dos líneas EXACTAS que el CR reprodujo. Son la regresión.
    expect(out).not.toContain('paso 3 OK')
    expect(out).not.toContain('paso 4 OK')
    expect(out).toContain('paso 3 (pata de control, sin el header) INCONCLUSO')
    expect(out).toContain('paso 4 (pata de control, sin el header) INCONCLUSO')
    // Y con la causa nombrada, no inventada.
    expect(out).toContain('429 (rate limit)')
  })

  it('T-CR1-2: y el veredicto ya no puede decir `SMOKE OK` con exit 0', async () => {
    const { code, out } = await correr(429, '{"error":"rate limited"}')
    expect(code).toBe(1)
    // Antes del fix esta línea salía textual, con EXIT=0.
    expect(out).not.toContain('[app.wasiai.io] SMOKE OK')
    expect(out).toContain('2 paso(s) INCONCLUSO(s)')
  })

  it('T-CR1-3: el 502/504 que genera EL PROXY en la 2ª pata tampoco da OK', async () => {
    // La otra mitad de `BLQ-BAJO-2`: el proxy fabrica estos dos bodies sin que el
    // gateway ejecute nada, y son IGUALES con y sin el header ⇒ comparar patas
    // acusaría a la lista blanca por un timeout.
    const { out } = await correr(504, '{"error":"GATEWAY_TIMEOUT"}')
    expect(out).not.toContain('paso 4 OK')
    expect(out).toContain('paso 4 (pata de control, sin el header) INCONCLUSO')
    expect(out).not.toContain('el header no atraviesa el proxy')
  })

  it('T-CR1-4 (calibración inversa): con las dos patas medibles el paso sigue dando OK y exit 0', async () => {
    // Sin este control, "arreglar" el hallazgo mandando todo a INCONCLUSO
    // pasaría los tres tests de arriba y dejaría el smoke sin capacidad de medir.
    const { code, out } = await correr(400, '{"code":"VALIDATION_ERROR","requestId":"bbb"}')
    expect(out).toContain('paso 3 OK: x-a2a-contracting-depth atraviesa el proxy')
    expect(out).toContain('paso 4 OK: x-payment-chain atraviesa el proxy')
    expect(out).not.toContain('INCONCLUSO')
    expect(code).toBe(0)
  })

  it('T-CR1-5: la etiqueta de la pata de control es UNA sola y dice cuál petición no se midió', () => {
    // Es una función y no dos literales para que las llamadas de los pasos 3 y 4
    // no puedan divergir; el test fija el texto que lee el operador.
    expect(s.STEP_CONTROL_LEG(3)).toBe('3 (pata de control, sin el header)')
    expect(s.STEP_CONTROL_LEG(4)).toBe('4 (pata de control, sin el header)')
    // Y el mensaje resultante distingue las dos causas, que se arreglan distinto.
    const msg = s.evaluateStepPrecondition(
      'app.wasiai.io',
      s.STEP_CONTROL_LEG(4),
      'compose',
      429,
      'Too Many Requests',
    )
    expect(msg).toContain('paso 4 (pata de control, sin el header) INCONCLUSO')
  })

  it('T-CR1-6: el `USAGE` que lee el operador y la etiqueta real no pueden divergir', () => {
    // El bloque de las 17:35 del auto-blindaje: la conducta escrita en dos
    // lugares (docblock + `USAGE`) y sólo uno actualizado. `USAGE` es una
    // constante de strings y hasta acá NINGÚN test la comparaba con la conducta.
    // Este candado ata la frase del `USAGE` al valor que produce el código: un
    // rename de `STEP_CONTROL_LEG` deja el `USAGE` viejo y pone esto rojo.
    expect(s.USAGE).toContain('pata de control, sin el header')
    expect(s.STEP_CONTROL_LEG(4)).toContain('pata de control, sin el header')
    // Y que el `USAGE` diga que los pasos de dos patas hacen DOS peticiones, que
    // es la premisa sin la cual la etiqueta no se entiende.
    expect(s.USAGE).toContain('DOS peticiones')
  })
})
describe('fix-pack F4 `F4-1`: el paso 5 (control contra el gateway) guarda sus DOS patas', () => {
  /**
   * El defecto que cierra este fix-pack. `MNR-CR-1` puso la guarda en los pasos
   * 3 y 4 y dejó afuera el 5, que era el ÚNICO paso sin `evaluateStepPrecondition`
   * en NINGUNA de sus dos patas. F4 lo midió con stubs y sin red contra
   * `349e9c8eb`:
   *
   *   1ª pata medible (402 con `eip155:84532`) + 2ª pata (el control, sin el
   *   header) en `429`  ⇒  `paso 5 OK: el gateway directo (…) discrimina la red`
   *                        + `SMOKE OK` + **exit 0**
   *
   * El mecanismo es idéntico al de `MNR-CR-1`: `extractFirstAccept` de un 429 da
   * `null`, así que "las dos patas difieren" se cumple VACUAMENTE — la diferencia
   * la fabrica el fallo, no la discriminación del gateway.
   *
   * Los tres primeros tests mueren si se le saca la guarda a cualquiera de las
   * dos patas del paso 5. Los dos siguientes son la calibración EN LA OTRA
   * DIRECCIÓN: que el arreglo no sea "mandar todo a INCONCLUSO", que dejaría el
   * control sin capacidad de medir ni de acusar.
   */

  const GW = 'https://gw.example'
  const ACCEPT_84532 = '{"accepts":[{"network":"eip155:84532","maxAmountRequired":"1010"}]}'
  const ACCEPT_2368 = '{"accepts":[{"network":"eip155:2368","maxAmountRequired":"1010000000000000"}]}'

  /**
   * Host COMPLETAMENTE medible (pasos 1/2/3/4/4b en OK) para que lo único que
   * cambie entre escenarios sea el gateway. Si el host también fallara, los
   * INCONCLUSOS del paso 5 quedarían tapados por los de los otros pasos y el test
   * no probaría nada del paso 5.
   */
  function fetchConGateway(
    gwWith: { status: number; body: string },
    gwWithout: { status: number; body: string },
  ) {
    const fn = vi.fn(async (url: string, init: RequestInit) => {
      const u = String(url)
      const headers = new Headers(init?.headers as HeadersInit)
      if (u.includes('/api/v1/status/delegation')) {
        return new Response(JSON.stringify(STATUS_OK), { status: 200 })
      }
      if (u.startsWith(GW)) {
        return headers.get('x-payment-chain') === 'base-sepolia'
          ? new Response(gwWith.body, { status: gwWith.status })
          : new Response(gwWithout.body, { status: gwWithout.status })
      }
      if (headers.get('x-a2a-contracting-depth') === '99') {
        return new Response('{"error":"CONTRACTING_DEPTH_EXCEEDED"}', { status: 400 })
      }
      if (headers.get('x-payment-chain') === 'base-sepolia') {
        return new Response(ACCEPT_84532, { status: 402 })
      }
      if (headers.get('x-payment-chain') === s.INVALID_CHAIN_SLUG) {
        return new Response('{"error_code":"CHAIN_NOT_SUPPORTED"}', { status: 400 })
      }
      return new Response('{"code":"VALIDATION_ERROR","requestId":"bbb"}', { status: 400 })
    })
    return fn
  }

  async function correr(
    gwWith: { status: number; body: string },
    gwWithout: { status: number; body: string },
  ) {
    const log = vi.fn()
    const logError = vi.fn()
    const fetchImpl = fetchConGateway(gwWith, gwWithout)
    const code = await s.runSmoke(
      { host: 'app.wasiai.io', gateway: GW },
      { fetchImpl, log, logError },
    )
    const out = [...log.mock.calls, ...logError.mock.calls].map((c) => String(c[0])).join('\n')
    const gwCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).startsWith(GW)).length
    return { code, out, gwCalls }
  }

  const MEDIBLE = { status: 402, body: ACCEPT_84532 }
  const RATE_LIMIT = { status: 429, body: '{"error":"rate limited"}' }

  it('T-F41-1: 1ª pata medible + control del gateway en 429 ⇒ NO dice `paso 5 OK`', async () => {
    // La línea EXACTA que F4 reprodujo. Es la regresión.
    const { out } = await correr(MEDIBLE, RATE_LIMIT)
    expect(out).not.toContain('paso 5 OK')
    expect(out).toContain(
      `paso 5 (control, gateway ${GW}) (pata de control, sin el header) INCONCLUSO`,
    )
    // Con la causa nombrada, no inventada.
    expect(out).toContain('429 (rate limit)')
    // Y los otros pasos siguen midiendo: el escenario aísla el paso 5.
    expect(out).toContain('paso 3 OK')
    expect(out).toContain('paso 4 OK')
  })

  it('T-F41-2: y el veredicto ya no puede decir `SMOKE OK` a secas con exit 0', async () => {
    const { code, out } = await correr(MEDIBLE, RATE_LIMIT)
    // Antes del fix estas dos salían textuales: `SMOKE OK` con EXIT=0.
    expect(out).not.toContain('[app.wasiai.io] SMOKE OK\n')
    expect(out).not.toMatch(/SMOKE OK$/)
    expect(out).toContain('1 paso(s) INCONCLUSO(s)')
    // `app.wasiai.io` DECLARA delegar (STATUS_OK) ⇒ un paso sin medir sale 1.
    expect(code).toBe(1)
  })

  it('T-F41-3: la 1ª pata del gateway tampoco se compara sin guarda, y ahorra la 2ª petición', async () => {
    const { out, gwCalls } = await correr(RATE_LIMIT, RATE_LIMIT)
    expect(out).toContain(`paso 5 (control, gateway ${GW}) INCONCLUSO`)
    expect(out).not.toContain('paso 5 OK')
    // Si la 1ª no es medible, la 2ª tampoco lo sería: no se pide. Una sola
    // petición al gateway, no dos. (Antes de la guarda eran siempre dos.)
    expect(gwCalls).toBe(1)
  })

  it('T-F41-4 (calibración inversa A): con las dos patas medibles el paso sigue dando OK y exit 0', async () => {
    // Sin este control, "arreglar" el hallazgo mandando todo a INCONCLUSO pasaría
    // los tres tests de arriba y dejaría el paso 5 sin capacidad de medir.
    const { code, out, gwCalls } = await correr(MEDIBLE, {
      status: 402,
      body: ACCEPT_2368,
    })
    expect(out).toContain(`paso 5 OK: el gateway directo (${GW}) discrimina la red`)
    expect(out).not.toContain('INCONCLUSO')
    expect(gwCalls).toBe(2)
    expect(code).toBe(0)
  })

  it('T-F41-5 (calibración inversa B): un gateway que NO discrimina sigue siendo INSTRUMENTO ROTO y sale 1', async () => {
    // La otra mitad de la calibración: el paso 5 tiene que poder ACUSAR. Si las
    // dos patas del gateway dan el mismo accepts[0], el control no discrimina y
    // eso es una FALLA (instrumento), no un INCONCLUSO.
    const { code, out } = await correr(MEDIBLE, { status: 402, body: ACCEPT_84532 })
    expect(out).toContain(`paso 5 (control, gateway ${GW}) ⇒ INSTRUMENTO ROTO`)
    expect(out).toContain('IDÉNTICO')
    expect(code).toBe(1)
  })

  it('T-F41-6: la etiqueta del paso 5 dice CUÁL petición y contra QUÉ host no se midió', () => {
    // El paso 5 pega contra el `--gateway`, no contra el host del smoke: sin el
    // gateway en la etiqueta, el operador reintenta el lado equivocado.
    const etiqueta = `5 (control, gateway ${GW})`
    expect(s.STEP_CONTROL_LEG(etiqueta)).toBe(
      `5 (control, gateway ${GW}) (pata de control, sin el header)`,
    )
    // Y es la MISMA función que usan los pasos 3 y 4: una sola etiqueta, tres
    // llamadas que no pueden divergir.
    expect(s.STEP_CONTROL_LEG(3)).toBe('3 (pata de control, sin el header)')
    // El `USAGE` que lee el operador nombra los tres pasos de dos patas.
    expect(s.USAGE).toContain('Los pasos 3, 4 y 5 hacen DOS peticiones')
    expect(s.USAGE).toContain('5 (control, gateway <url>)')
  })
})
