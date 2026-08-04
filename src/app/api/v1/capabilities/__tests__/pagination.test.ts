/**
 * pagination.test.ts — recorrido completo del catálogo público
 * (`GET /api/v1/capabilities?offset=…&limit=…`).
 *
 * EL detalle del doble de upstream: **devuelve el catálogo en un orden distinto
 * en cada llamada**. No es paranoia de test, es lo que hace producción — cuatro
 * llamadas medidas a `?limit=100` el 2026-08-04 devolvieron los mismos 25 slugs
 * en cuatro órdenes distintos, porque el desempate del ranking de a2a es
 * `Math.random()` por request (`wasiai-a2a/src/lib/ranking-tiebreak.ts`).
 *
 * Un doble que devolviera siempre el mismo orden dejaría pasar una paginación
 * que se apoya en el orden upstream, que es justo la implementación que NO
 * funciona en producción. La barajada de acá es determinística (LCG con semilla
 * por llamada) para que una falla sea reproducible, no un flake.
 *
 * La expectativa viene DE AFUERA: `CATALOG_SLUGS` es la lista literal que el
 * doble sirve y `EXPECTED_TRAVERSAL_ORDER` es el orden esperado escrito a mano.
 * Ningún `.sort()` en este archivo — si el test derivara el orden con la misma
 * comparación que el código bajo prueba, mediría el código contra sí mismo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MAX_PAGE_SIZE, CATALOG_FETCH_LIMIT } from '@/lib/api/catalog-pagination'

vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: 'capabilities',
    NODE_ENV: 'test',
  },
}))

const mockForwardRequest = vi.fn()
const mockIsDelegated = vi.fn<(_e: 'compose' | 'orchestrate' | 'capabilities' | 'mcp') => boolean>()

vi.mock('@/lib/proxy/forward-handler', () => ({
  isDelegated: (e: 'compose' | 'orchestrate' | 'capabilities' | 'mcp') => mockIsDelegated(e),
  forwardRequest: (...args: unknown[]) => mockForwardRequest(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
      }),
    }),
  })),
}))
vi.mock('@/lib/contracts/WasiAIMarketplace', () => ({ getMarketplaceAddress: () => '0xabc' }))
vi.mock('@/lib/chain', () => ({ CHAIN_ID: 43113, CHAIN_NAME: 'avalanche-testnet' }))

import { GET } from '../route'

// ── El catálogo del doble ────────────────────────────────────────────────────
// 23 slugs, escritos en un orden que NO es el de salida (`mid-router` está en la
// posición 3 y sale entre `lima-price` y `mike-risk`).
const CATALOG_SLUGS = [
  'zeta-oracle',
  'alpha-bridge',
  'mid-router',
  'beta-vault',
  'yankee-signal',
  'charlie-swap',
  'delta-lens',
  'xray-audit',
  'echo-relay',
  'foxtrot-index',
  'golf-quote',
  'hotel-kyc',
  'india-payout',
  'juliet-fx',
  'kilo-scan',
  'lima-price',
  'mike-risk',
  'november-nft',
  'oscar-lend',
  'papa-stake',
  'quebec-mint',
  'romeo-feed',
  'sierra-trade',
] as const

/** Cuántos agentes tiene el catálogo. Número literal, no `CATALOG_SLUGS.length`. */
const CATALOG_SIZE = 23

/** El orden de salida esperado, escrito a mano. */
const EXPECTED_TRAVERSAL_ORDER = [
  'alpha-bridge',
  'beta-vault',
  'charlie-swap',
  'delta-lens',
  'echo-relay',
  'foxtrot-index',
  'golf-quote',
  'hotel-kyc',
  'india-payout',
  'juliet-fx',
  'kilo-scan',
  'lima-price',
  'mid-router',
  'mike-risk',
  'november-nft',
  'oscar-lend',
  'papa-stake',
  'quebec-mint',
  'romeo-feed',
  'sierra-trade',
  'xray-audit',
  'yankee-signal',
  'zeta-oracle',
]

/** Barajada determinística (Fisher-Yates con LCG) — distinta por semilla. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let state = seed * 2654435761 + 1
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x80000000
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

let upstreamCall = 0

/** Body con la forma real de a2a, con los agentes barajados distinto cada vez. */
function upstreamCatalogBody() {
  upstreamCall += 1
  const agents = shuffle(CATALOG_SLUGS, upstreamCall).map((slug, i) => ({
    slug,
    id: `id-${slug}`,
    name: slug,
    priceUsdc: i % 3 === 0 ? 0.01 : 0.02,
    verified: false,
  }))
  return {
    agents,
    total: CATALOG_SIZE,
    registries: ['WasiAI'],
    sources: [{ name: 'WasiAI', state: 'ok', rows: CATALOG_SIZE }],
    catalogStatus: 'complete',
    excluded: { scope: 0, reputation: 0 },
  }
}

function makeGet(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'GET', headers: new Headers(headers) })
}

const BASE = 'http://v2.local/api/v1/capabilities'

function forwardedUrl(callIndex = 0): URL {
  const req = mockForwardRequest.mock.calls[callIndex][0] as NextRequest
  return new URL(req.url)
}

describe('GET /api/v1/capabilities — paginación del catálogo', () => {
  beforeEach(() => {
    upstreamCall = 0
    mockForwardRequest.mockReset()
    mockForwardRequest.mockImplementation(
      () =>
        new Response(JSON.stringify(upstreamCatalogBody()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    mockIsDelegated.mockReset()
    mockIsDelegated.mockReturnValue(true)
  })

  describe('recorrido de punta a punta', () => {
    it('reúne EXACTAMENTE el catálogo completo: sin repetidos y sin faltantes', async () => {
      const PAGE = 5
      const collected: string[] = []
      const pageSizes: number[] = []
      let offset: number | null = 0
      let guard = 0

      while (offset !== null) {
        if (++guard > 50) throw new Error('la paginación no termina')
        const res = await GET(makeGet(`${BASE}?offset=${offset}&limit=${PAGE}`))
        expect(res.status).toBe(200)
        const body = await res.json()
        pageSizes.push(body.agents.length)
        for (const a of body.agents) collected.push(a.slug)
        expect(body.next_offset === null).toBe(body.has_more === false)
        offset = body.next_offset
      }

      // 1. Cantidad exacta, contra el número traído de afuera.
      expect(collected).toHaveLength(CATALOG_SIZE)
      // 2. Sin repetidos.
      expect(new Set(collected).size).toBe(CATALOG_SIZE)
      // 3. Sin faltantes ni extras, contra la lista literal del catálogo.
      for (const slug of CATALOG_SLUGS) expect(collected).toContain(slug)
      for (const slug of collected) expect(CATALOG_SLUGS).toContain(slug)
      // 4. Y en el orden esperado, escrito a mano.
      expect(collected).toEqual(EXPECTED_TRAVERSAL_ORDER)
      // 5. Páginas llenas hasta el resto: 23 = 5+5+5+5+3.
      expect(pageSizes).toEqual([5, 5, 5, 5, 3])
    })

    it('recorre igual con un tamaño de página que divide exacto al catálogo', async () => {
      // 23 no es múltiplo de nada útil, así que se recorre de a 1: 23 páginas,
      // la última con `has_more:false`. Cubre el borde `offset === total`.
      const collected: string[] = []
      let offset: number | null = 0
      let guard = 0
      while (offset !== null) {
        if (++guard > 100) throw new Error('la paginación no termina')
        const res = await GET(makeGet(`${BASE}?offset=${offset}&limit=1`))
        const body = await res.json()
        for (const a of body.agents) collected.push(a.slug)
        offset = body.next_offset
      }
      expect(collected).toEqual(EXPECTED_TRAVERSAL_ORDER)
      expect(guard).toBe(CATALOG_SIZE)
    })

    it('la última página señala que se terminó', async () => {
      const res = await GET(makeGet(`${BASE}?offset=20&limit=5`))
      const body = await res.json()
      expect(body.agents.map((a: { slug: string }) => a.slug)).toEqual([
        'xray-audit',
        'yankee-signal',
        'zeta-oracle',
      ])
      expect(body.has_more).toBe(false)
      expect(body.next_offset).toBeNull()
    })

    it('una página anterior a la última señala que hay más', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=5`))
      const body = await res.json()
      expect(body.has_more).toBe(true)
      expect(body.next_offset).toBe(5)
    })

    it('un offset más allá del final devuelve página vacía, no un error', async () => {
      const res = await GET(makeGet(`${BASE}?offset=999&limit=5`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agents).toEqual([])
      expect(body.has_more).toBe(false)
      expect(body.next_offset).toBeNull()
    })
  })

  describe('la llamada a a2a', () => {
    it('pide el catálogo COMPLETO, no el tamaño de página, y no reenvía offset', async () => {
      await GET(makeGet(`${BASE}?offset=10&limit=5`))
      const url = forwardedUrl()
      expect(url.searchParams.get('limit')).toBe(String(CATALOG_FETCH_LIMIT))
      expect(url.searchParams.has('offset')).toBe(false)
    })

    it('conserva los filtros ya traducidos junto con la paginación', async () => {
      await GET(makeGet(`${BASE}?tag=oracle&max_price=0.5&offset=5&limit=5&utm_source=twitter`))
      const url = forwardedUrl()
      expect(url.searchParams.get('capabilities')).toBe('oracle')
      expect(url.searchParams.get('maxPrice')).toBe('0.5')
      expect(url.searchParams.has('utm_source')).toBe(false)
      expect(url.searchParams.has('offset')).toBe(false)
    })

    it('devuelve el error de a2a sin tocarlo', async () => {
      mockForwardRequest.mockReset()
      mockForwardRequest.mockImplementation(
        () =>
          new Response(
            JSON.stringify({ error: "unknown parameter 'tagg'", code: 'UNKNOWN_DISCOVER_PARAM' }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      )
      const res = await GET(makeGet(`${BASE}?tagg=oracle&offset=0&limit=5`))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: "unknown parameter 'tagg'",
        code: 'UNKNOWN_DISCOVER_PARAM',
      })
    })

    it('un body upstream sin `agents` no se pagina en silencio: 502', async () => {
      mockForwardRequest.mockReset()
      mockForwardRequest.mockImplementation(
        () =>
          new Response(JSON.stringify({ nope: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      )
      const res = await GET(makeGet(`${BASE}?offset=0&limit=5`))
      expect(res.status).toBe(502)
      expect((await res.json()).code).toBe('UPSTREAM_MALFORMED')
    })
  })

  describe('compatibilidad: sin parámetros se comporta como antes', () => {
    it('devuelve el resultado del proxy TAL CUAL, sin campos nuevos', async () => {
      const passthrough = new Response(JSON.stringify(upstreamCatalogBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      mockForwardRequest.mockReset()
      mockForwardRequest.mockReturnValue(passthrough)

      const res = await GET(makeGet(BASE))
      // Identidad: el route devuelve el mismo objeto que el proxy, no una copia
      // reconstruida. Si algún día se pagina por default, esto se pone rojo.
      expect(res).toBe(passthrough)
      const body = await res.json()
      expect(body.agents).toHaveLength(CATALOG_SIZE)
      expect(body).not.toHaveProperty('has_more')
      expect(body).not.toHaveProperty('next_offset')
      expect(body).not.toHaveProperty('offset')
    })

    it('no le inventa un `limit` a a2a cuando el caller no mandó ninguno', async () => {
      await GET(makeGet(BASE))
      expect(forwardedUrl().searchParams.has('limit')).toBe(false)
    })

    it('`limit` sin `offset` sigue viajando tal cual (top-N de siempre)', async () => {
      await GET(makeGet(`${BASE}?limit=5`))
      expect(forwardedUrl().searchParams.get('limit')).toBe('5')
    })

    it('`limit` sin `offset` fuera del rango nuevo NO se rechaza acá (lo valida a2a)', async () => {
      // 101 > MAX_PAGE_SIZE. Sin `offset` no hay modo paginado, así que el
      // contrato de hoy manda: se reenvía y contesta el gateway. Rechazarlo acá
      // sería romper a un cliente actual.
      await GET(makeGet(`${BASE}?limit=101`))
      expect(mockForwardRequest).toHaveBeenCalledTimes(1)
      expect(forwardedUrl().searchParams.get('limit')).toBe('101')
    })
  })

  describe('`limit` fuera de rango en modo paginado', () => {
    const CASES: Array<[string, string]> = [
      ['cero', '0'],
      ['negativo', '-5'],
      ['no numérico', 'abc'],
      ['mayor al tope', String(MAX_PAGE_SIZE + 1)],
    ]

    for (const [label, value] of CASES) {
      it(`${label} (limit=${value}) → 400, sin llamar a a2a y sin devolver agentes`, async () => {
        const res = await GET(makeGet(`${BASE}?offset=0&limit=${value}`))
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.code).toBe('INVALID_LIMIT')
        expect(body).not.toHaveProperty('agents')
        expect(mockForwardRequest).not.toHaveBeenCalled()
      })
    }

    it('fraccionario y notación científica también (mismo agujero de clase)', async () => {
      for (const value of ['2.5', '1e21']) {
        const res = await GET(makeGet(`${BASE}?offset=0&limit=${value}`))
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('INVALID_LIMIT')
      }
      expect(mockForwardRequest).not.toHaveBeenCalled()
    })

    it('el tope es alcanzable: limit=MAX_PAGE_SIZE es válido', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=${MAX_PAGE_SIZE}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agents).toHaveLength(CATALOG_SIZE)
      expect(body.has_more).toBe(false)
    })

    it('`offset` sin `limit` usa el tamaño de página por defecto', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0`))
      const body = await res.json()
      expect(body.limit).toBe(20)
      expect(body.agents).toHaveLength(20)
      expect(body.has_more).toBe(true)
      expect(body.next_offset).toBe(20)
    })
  })

  describe('`offset` inválido', () => {
    for (const value of ['-1', 'abc', '1.5', '', '1e21']) {
      it(`offset=${JSON.stringify(value)} → 400 sin llamar a a2a`, async () => {
        const res = await GET(makeGet(`${BASE}?offset=${value}`))
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('INVALID_OFFSET')
        expect(mockForwardRequest).not.toHaveBeenCalled()
      })
    }
  })

  describe('caminos que no pueden honrar `offset`', () => {
    it('el callback del registry a2a lo rechaza en vez de ignorarlo', async () => {
      const res = await GET(
        makeGet(`${BASE}?offset=10&limit=5`, { 'x-agent-key': 'wasi_aaaa' }),
      )
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('PAGINATION_NOT_SUPPORTED')
      expect(mockForwardRequest).not.toHaveBeenCalled()
    })

    it('con la delegación apagada también lo rechaza', async () => {
      mockIsDelegated.mockReturnValue(false)
      const res = await GET(makeGet(`${BASE}?offset=10&limit=5`))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('PAGINATION_NOT_SUPPORTED')
    })

    it('sin `offset`, el callback del registry sigue yendo al handler legacy', async () => {
      const res = await GET(makeGet(`${BASE}?limit=20`, { 'x-agent-key': 'wasi_aaaa' }))
      expect(res.status).toBe(200)
      expect(mockForwardRequest).not.toHaveBeenCalled()
    })
  })
})
