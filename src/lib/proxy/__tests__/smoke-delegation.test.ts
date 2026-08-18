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
