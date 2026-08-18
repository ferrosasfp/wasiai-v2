/**
 * forward-handler.test.ts — WKH-66 W1 unit tests.
 * Cubre AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-13.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock env BEFORE importing the helper (helper reads env at module load)
vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: 'compose,orchestrate,capabilities',
    NODE_ENV: 'test',
  },
}))

import {
  forwardRequest,
  isDelegated,
  parseDelegatedEndpoints,
  listDelegatedEndpoints,
  DELEGATED_ENDPOINT_VALUES,
  isForwardKeyConfigured,
  isA2aBaseUrlConfigured,
} from '../forward-handler'
import {
  PASSTHROUGH_HEADERS,
  PASSTHROUGH_HEADER_ENTRIES,
  REJECTION_FAMILIES,
  REVERSAL_WATCHLIST,
  UNATTRIBUTABLE_FAMILIES,
  WKH_361_NEW_HEADERS,
} from '../passthrough-headers'

describe('parseDelegatedEndpoints', () => {
  it('returns empty Set when raw is undefined or blank', () => {
    expect(parseDelegatedEndpoints(undefined).size).toBe(0)
    expect(parseDelegatedEndpoints('').size).toBe(0)
    expect(parseDelegatedEndpoints('   ').size).toBe(0)
  })

  it('trims and lowercases entries', () => {
    const out = parseDelegatedEndpoints('  Compose ,orchestrate  ')
    expect(out.has('compose')).toBe(true)
    expect(out.has('orchestrate')).toBe(true)
    expect(out.size).toBe(2)
  })

  it('drops empty tokens caused by trailing commas', () => {
    const out = parseDelegatedEndpoints('compose,,orchestrate,')
    expect(out.size).toBe(2)
  })
})

describe('isDelegated', () => {
  it('returns true for endpoints in flag', () => {
    expect(isDelegated('compose')).toBe(true)
    expect(isDelegated('orchestrate')).toBe(true)
    expect(isDelegated('capabilities')).toBe(true)
  })
  it('AC-13: returns false for endpoints not in flag (mcp omitted)', () => {
    expect(isDelegated('mcp')).toBe(false)
  })
})

describe('forwardRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeReq(
    method: 'GET' | 'POST',
    headers: Record<string, string> = {},
    body?: string,
    url = 'http://v2.local/api/v1/compose',
  ): NextRequest {
    const init: RequestInit & { duplex?: string } = {
      method,
      headers: new Headers(headers),
    }
    if (body !== undefined) {
      init.body = body
      init.duplex = 'half'
    }
    return new NextRequest(url, init as RequestInit)
  }

  it('AC-2: forwards POST to upstream with method preserved', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = makeReq('POST', { 'content-type': 'application/json' }, '{"a":1}')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://a2a.local/compose')
    expect((opts as RequestInit).method).toBe('POST')
  })

  it('AC-5: injects x-wasiai-forward-key + x-wasiai-source', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { 'content-type': 'application/json' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-wasiai-forward-key']).toBe('test-forward-key-1234567890abcd')
    expect(headers['x-wasiai-source']).toBe('v2-proxy')
  })

  it('AC-6: passes through whitelist headers when present', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', {
      'x-payment': 'sig-abc',
      'x-a2a-key': 'k-xyz',
      'authorization': 'Bearer foo',
    })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-payment']).toBe('sig-abc')
    expect(headers['x-a2a-key']).toBe('k-xyz')
    expect(headers['authorization']).toBe('Bearer foo')
  })

  // AR MNR-1 (TD-LIGHT): el lookup del whitelist usa NextRequest.headers.get
  // que es case-insensitive por la spec de Fetch Headers. Este test paramétrico
  // garantiza que cualquier casing del cliente se propaga al upstream con el
  // nombre canónico (lowercase) que la whitelist usa.
  it.each([
    ['lowercase', 'x-payment'],
    ['TitleCase', 'X-Payment'],
    ['UPPERCASE', 'X-PAYMENT'],
  ])('AR MNR-1: header casing %s — x-payment is forwarded regardless of casing', async (_label, headerName) => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { [headerName]: 'sig-from-client' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-payment']).toBe('sig-from-client')
  })

  // T-03 (WKH-361 / AC-3): extiende el AC-7 original de WKH-66 con las
  // exclusiones POR DEFINICIÓN del criterio de admisión (§5.1 cond. 2):
  // credenciales de wasiai-v2 e identidad del navegador nunca salen upstream.
  it('AC-7 / T-03: does NOT forward host/origin/cookie/set-cookie/referer/x-vercel-*/x-middleware-*', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', {
      host: 'attacker.com',
      origin: 'https://evil.test',
      cookie: 'sess=abc',
      'set-cookie': 'sess=abc; HttpOnly',
      referer: 'https://evil.test/page',
      'x-vercel-id': 'gru1::abcde-1234567890-deadbeef',
      'x-middleware-rewrite': '/somewhere-else',
    })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['host']).toBeUndefined()
    expect(headers['origin']).toBeUndefined()
    expect(headers['cookie']).toBeUndefined()
    expect(headers['set-cookie']).toBeUndefined()
    expect(headers['referer']).toBeUndefined()
    expect(headers['x-vercel-id']).toBeUndefined()
    expect(headers['x-middleware-rewrite']).toBeUndefined()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // WKH-361 — los tres headers que el gateway SÍ lee y el proxy descartaba.
  // ───────────────────────────────────────────────────────────────────────────

  it('T-01 (AC-1): forwards x-a2a-contracting-chain and -depth with the exact received value', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', {
      'x-a2a-contracting-chain': 'wasi-coordinator,wasi-translate',
      'x-a2a-contracting-depth': '99',
    })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-a2a-contracting-chain']).toBe('wasi-coordinator,wasi-translate')
    expect(headers['x-a2a-contracting-depth']).toBe('99')
  })

  it('T-01b (AC-1b): forwards x-payment-chain with the exact received value', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { 'x-payment-chain': 'base-sepolia' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    // El valor viaja SIN MODIFICAR: v2 no traduce slugs. Si `base-sepolia` se
    // normalizara acá, el 400 CHAIN_NOT_SUPPORTED del gateway dejaría de ser
    // alcanzable desde el marketplace y volvería el silencio.
    expect(headers['x-payment-chain']).toBe('base-sepolia')
  })

  it('T-02 (AC-2): headers absent upstream are undefined, NOT empty string', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { 'content-type': 'application/json' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    for (const h of ['x-a2a-contracting-chain', 'x-a2a-contracting-depth', 'x-payment-chain']) {
      expect(headers[h]).toBeUndefined()
      expect(headers[h]).not.toBe('')
    }
    expect(Object.keys(headers)).not.toContain('x-payment-chain')
  })

  // CD-3: ausente ≠ vacío, y NO es el mismo caso para los tres. Medido contra
  // wasiai-a2a @ 10a6eb1:
  //   x-a2a-contracting-depth: ''  -> 400 CONTRACTING_DEPTH_MALFORMED
  //                                   (contracting-chain.ts:822-825)
  //   x-payment-chain: ''          -> 400 CHAIN_NOT_SUPPORTED
  //                                   (chain-resolver.ts:422 + a2a-key.ts:365-370)
  //   x-a2a-contracting-chain: ''  -> se absorbe como AUSENTE, NO da malformed
  //                                   (contracting-chain.ts:792-795)
  // Los dos primeros convierten peticiones que hoy funcionan en 400. Por eso la
  // regla de no emitir vacío es la misma para los tres aunque la razón no lo sea.
  it('T-02b (AC-2 / CD-3): the 3 headers received as empty string are NOT emitted upstream', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', {
      'x-a2a-contracting-chain': '',
      'x-a2a-contracting-depth': '',
      'x-payment-chain': '',
    })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-a2a-contracting-chain']).toBeUndefined()
    expect(headers['x-a2a-contracting-depth']).toBeUndefined()
    expect(headers['x-payment-chain']).toBeUndefined()
  })

  it("T-02c (AC-2): x-a2a-contracting-depth '0' IS forwarded ('0' is truthy as a string)", async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { 'x-a2a-contracting-depth': '0' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    // Atrapa a quien "arregle" la guarda con Number(v) o v !== '': '0' es un
    // valor legítimo del techo de profundidad y tiene que llegar.
    expect(headers['x-a2a-contracting-depth']).toBe('0')
  })

  it('AC-8: 402 passthrough body intact', async () => {
    const upstreamBody = '{"x402":{"price":"0.10"}}'
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(upstreamBody, {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = makeReq('POST')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(402)
    expect(await res.text()).toBe(upstreamBody)
  })

  it('AC-9: 5xx upstream maps to 502 UPSTREAM_ERROR', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"error":"db down"}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = makeReq('POST')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe('UPSTREAM_ERROR')
    expect(body.detail).toBe('db down')
  })

  it('AC-10: timeout returns 504 GATEWAY_TIMEOUT and clearTimeout fires', async () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      return new Promise<Response>((_, reject) => {
        const sig = (init as RequestInit | undefined)?.signal
        sig?.addEventListener('abort', () => {
          const e = new DOMException('aborted', 'AbortError')
          reject(e)
        })
      })
    })

    const req = makeReq('POST')
    const promise = forwardRequest(req, 'http://a2a.local/compose', { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(150)
    const res = await promise
    expect(res.status).toBe(504)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('GATEWAY_TIMEOUT')
    expect(clearSpy).toHaveBeenCalled()
  })

  it('AC-4: GET capabilities forwards query params', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"agents":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = new NextRequest('http://v2.local/api/v1/capabilities?tag=defi&limit=5', {
      method: 'GET',
    })
    await forwardRequest(req, 'http://a2a.local/discover')
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('tag=defi')
    expect(url).toContain('limit=5')
  })

  it('non-AbortError exceptions still return 502 and clearTimeout fires', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeReq('POST')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe('UPSTREAM_ERROR')
    expect(clearSpy).toHaveBeenCalled()
  })

  // AR MNR-4 (TD-LIGHT): en NODE_ENV=test/dev exponemos String(err) para debug.
  // En production retornamos detail genérico. Como el módulo env se importa
  // una sola vez, mutamos el campo NODE_ENV del mock en runtime.
  it('AR MNR-4: in production NODE_ENV, error detail is generic (no leak)', async () => {
    const envMod = await import('@/lib/env')
    const original = envMod.env.NODE_ENV
    ;(envMod.env as { NODE_ENV: string }).NODE_ENV = 'production'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:6543'))
      const req = makeReq('POST')
      const res = await forwardRequest(req, 'http://a2a.local/compose')
      expect(res.status).toBe(502)
      const body = (await res.json()) as { error: string; detail: string }
      expect(body.error).toBe('UPSTREAM_ERROR')
      expect(body.detail).toBe('upstream connection failed')
      expect(body.detail).not.toContain('ECONNREFUSED')
      expect(body.detail).not.toContain('10.0.0.5')
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      ;(envMod.env as { NODE_ENV: string | undefined }).NODE_ENV = original
      consoleSpy.mockRestore()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WKH-361 — la lista blanca como contrato verificado (AC-4 / AC-4b).
// ─────────────────────────────────────────────────────────────────────────────

describe('PASSTHROUGH_HEADERS (WKH-361)', () => {
  it('T-04 (AC-4): is exactly the 11-name literal, in order', () => {
    // Este literal es el contrato. Cualquier alta o baja en
    // passthrough-headers.ts rompe la suite: es el punto, no un accidente.
    expect([...PASSTHROUGH_HEADERS]).toEqual([
      'x-payment',
      'payment-signature',
      'x-a2a-key',
      'x-api-key',
      'authorization',
      'content-type',
      'user-agent',
      'x-forwarded-for',
      'x-a2a-contracting-chain',
      'x-a2a-contracting-depth',
      'x-payment-chain',
    ])
  })

  it('T-04 (AC-4): PASSTHROUGH_HEADERS derives from PASSTHROUGH_HEADER_ENTRIES, same order', () => {
    expect([...PASSTHROUGH_HEADERS]).toEqual(PASSTHROUGH_HEADER_ENTRIES.map((e) => e.header))
  })

  it('T-04 (AC-4): every header name is lowercase and appears once', () => {
    for (const h of PASSTHROUGH_HEADERS) {
      expect(h).toBe(h.toLowerCase())
    }
    expect(new Set(PASSTHROUGH_HEADERS).size).toBe(PASSTHROUGH_HEADERS.length)
  })

  it('T-04b (AC-4b): every entry with consumer !== none cites its reader in wasiai-a2a', () => {
    for (const entry of PASSTHROUGH_HEADER_ENTRIES) {
      if (entry.consumer === 'none') continue
      expect(entry.citation, `${entry.header} sin cita de lector`).toBeTruthy()
      // La cita tiene que apuntar a wasiai-a2a con archivo:línea. Una cita a un
      // archivo de este repo no prueba que el gateway lea el header.
      expect(entry.citation).toMatch(/^wasiai-a2a\/src\/.+:\d+$/)
      expect(entry.why.trim().length).toBeGreaterThan(0)
    }
  })

  it('T-04b (AC-4b): x-api-key is the ONLY entry without a cited reader', () => {
    const orphans = PASSTHROUGH_HEADER_ENTRIES.filter(
      (e) => e.consumer === 'none' || e.citation === null,
    )
    expect(orphans.map((e) => e.header)).toEqual(['x-api-key'])
    // Alias muerto (CD-12): se conserva por regresión cero y se resuelve en A-5.
    expect(orphans[0]?.consumer).toBe('none')
    expect(orphans[0]?.citation).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WKH-361 fix-pack AR `BLQ-MED-1` — el radio de impacto no se puede subdeclarar.
// ─────────────────────────────────────────────────────────────────────────────

describe('REJECTION_FAMILIES: las 6 familias que habilita esta HU', () => {
  it('T-FP-1: son exactamente estos 6 códigos (el literal es el contrato)', () => {
    // Sacar una fila de acá pone rojo este test: es el punto. La primera versión
    // del radio de impacto declaraba 3 filas y vigilaba 2 códigos, y nada lo
    // desmintió porque vivía en prosa.
    expect([...REVERSAL_WATCHLIST].sort()).toEqual([
      'CHAIN_NOT_SUPPORTED',
      'CONTRACTING_CHAIN_MALFORMED',
      'CONTRACTING_DEPTH_EXCEEDED',
      'CONTRACTING_DEPTH_MALFORMED',
      'CONTRACTING_LOOP_DETECTED',
      'INSUFFICIENT_BUDGET',
    ])
    expect(new Set(REVERSAL_WATCHLIST).size).toBe(REJECTION_FAMILIES.length)
  })

  it('T-FP-2: CADA header nuevo de WKH-361 declara al menos una familia', () => {
    // El criterio que cierra el agujero hacia adelante: admitir un header sin
    // declarar qué rechazos habilita deja de ser posible en silencio.
    for (const header of WKH_361_NEW_HEADERS) {
      const families = REJECTION_FAMILIES.filter((f) => f.header === header)
      expect(families.length, `${header} no declara ninguna familia de rechazo`).toBeGreaterThan(0)
    }
  })

  it('T-FP-3: toda familia apunta a un header que el proxy realmente reenvía', () => {
    for (const f of REJECTION_FAMILIES) {
      expect(PASSTHROUGH_HEADERS, `${f.code} apunta a un header fuera de la lista`).toContain(
        f.header,
      )
    }
  })

  it('T-FP-4: el punto ciego está escrito ⇔ falta la línea de log O falta la atribución', () => {
    // Es la regla que el AR pidió: si una familia no se puede vigilar desde el
    // punto de observación declarado, se dice; no se deja afuera en silencio.
    // ⚠️ Fix-pack AR it.2: antes era un XOR contra `railwayLogLine` sola, y por
    // eso las 4 CONTRACTING_* podían llevar `blindSpot: null` —o sea, AFIRMAR
    // que no tienen punto ciego— mientras su rechazo era inatribuible al proxy.
    // El XOR viejo CERTIFICABA esa afirmación falsa. Son dos preguntas
    // distintas: "¿se ve el error_code?" y "¿se puede atribuir al proxy?".
    for (const f of REJECTION_FAMILIES) {
      const hasLog = typeof f.railwayLogLine === 'string' && f.railwayLogLine.length > 0
      const hasBlind = typeof f.blindSpot === 'string' && f.blindSpot.length > 0
      const attributable = f.proxyAttribution === 'reqId'
      expect(
        hasBlind,
        `${f.code}: log=${hasLog} attr=${f.proxyAttribution} blindSpot=${hasBlind}`,
      ).toBe(!hasLog || !attributable)
    }
  })

  it('T-FP-5: la única familia sin línea de log es CHAIN_NOT_SUPPORTED, y su punto ciego dice cómo suplirlo', () => {
    const blind = REJECTION_FAMILIES.filter((f) => f.railwayLogLine === null)
    expect(blind.map((f) => f.code)).toEqual(['CHAIN_NOT_SUPPORTED'])
    expect(blind[0]?.blindSpot).toContain('reqId')
    expect(blind[0]?.blindSpot).toContain('forward-key source')
  })

  it('T-FP-7: las 4 familias de contracting NO se pueden atribuir al proxy, y lo dicen', () => {
    // Medido con `app.inject` sobre la versión real del gateway:
    // `preHandlers ejecutados = ["contractingGuard"]` ⇒ `forwardKey` nunca corre
    // ⇒ no hay línea `forward-key source` que cruzar por reqId. El disparador de
    // reversa (`story-file.md` §13) exige justamente esa línea.
    expect([...UNATTRIBUTABLE_FAMILIES].sort()).toEqual([
      'CONTRACTING_CHAIN_MALFORMED',
      'CONTRACTING_DEPTH_EXCEEDED',
      'CONTRACTING_DEPTH_MALFORMED',
      'CONTRACTING_LOOP_DETECTED',
    ])
    for (const code of UNATTRIBUTABLE_FAMILIES) {
      const f = REJECTION_FAMILIES.find((x) => x.code === code)
      // No alcanza con marcarlas: el punto ciego tiene que decir POR QUÉ y CON
      // QUÉ se suple, o vuelve a ser un dato que nadie sabe usar.
      expect(f?.blindSpot, `${code} sin punto ciego escrito`).toBeTruthy()
      expect(f?.blindSpot).toContain('compose.ts:909')
      expect(f?.blindSpot).toContain('forward-key source')
      expect(f?.blindSpot).toContain('CERO')
      expect(f?.blindSpot).toContain('DELTA')
    }
  })

  it('T-FP-8: las 2 familias de a2a-key SÍ se atribuyen, y el reparto es exhaustivo', () => {
    // La calibración en la otra dirección: si TODO fuera inatribuible, la tabla
    // del runbook no tendría método y nadie lo notaría. `a2a-key` corre DESPUÉS
    // de `requireForwardKey()` en la cadena, así que estas dos sí tienen origen.
    const atribuibles = REJECTION_FAMILIES.filter((f) => f.proxyAttribution === 'reqId').map(
      (f) => f.code,
    )
    expect([...atribuibles].sort()).toEqual(['CHAIN_NOT_SUPPORTED', 'INSUFFICIENT_BUDGET'])
    expect(atribuibles.length + UNATTRIBUTABLE_FAMILIES.length).toBe(REJECTION_FAMILIES.length)
  })

  it('T-FP-6: cada familia cita su emisor en wasiai-a2a y trae el status medido', () => {
    for (const f of REJECTION_FAMILIES) {
      expect(f.citation).toMatch(/^wasiai-a2a\/src\/.+:\d+(-\d+)?$/)
      expect([400, 403]).toContain(f.status)
      expect(f.trigger.trim().length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WKH-361 — CD-4: el endpoint de estado y el cron leen el MISMO símbolo que
// usan las rutas. Nada recalcula la fórmula que vigila.
// ─────────────────────────────────────────────────────────────────────────────

describe('listDelegatedEndpoints / DELEGATED_ENDPOINT_VALUES (WKH-361)', () => {
  it('T-11 (CD-4): DELEGATED_ENDPOINT_VALUES has the 4 members of the union', () => {
    expect([...DELEGATED_ENDPOINT_VALUES].sort()).toEqual([
      'capabilities',
      'compose',
      'mcp',
      'orchestrate',
    ])
  })

  it('T-11 (CD-4): listDelegatedEndpoints returns the subset actually delegated', () => {
    // El mock de @/lib/env de este archivo declara compose,orchestrate,capabilities.
    expect([...listDelegatedEndpoints()].sort()).toEqual([
      'capabilities',
      'compose',
      'orchestrate',
    ])
    expect(listDelegatedEndpoints()).not.toContain('mcp')
  })

  it('T-11 (CD-4): listDelegatedEndpoints agrees with isDelegated for every member', () => {
    const listed = new Set(listDelegatedEndpoints())
    for (const e of DELEGATED_ENDPOINT_VALUES) {
      expect(listed.has(e)).toBe(isDelegated(e))
    }
  })

  it('T-11 (CD-4): both config predicates are true under this file mock', () => {
    expect(isForwardKeyConfigured()).toBe(true)
    expect(isA2aBaseUrlConfigured()).toBe(true)
  })
})
