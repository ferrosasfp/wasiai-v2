/**
 * total-unknown.test.ts — `GET /api/v1/capabilities` cuando a2a NO sabe el total.
 *
 * ─── QUÉ CAMBIÓ AGUAS ARRIBA ────────────────────────────────────────────────
 * `wasiai-a2a` 9faff4f (HU-323): `total` pasó de ser siempre un número a ser
 * `number | 'unknown'`. Cuando el catálogo llegó incompleto publica
 * `total: 'unknown'` + `totalAtLeast: <cota inferior>` en vez del conteo
 * recortado, que era ambiguo. Contrato espejado en
 * `src/lib/api/a2a-discover-contract.ts`.
 *
 * ─── QUÉ MIDE ESTE ARCHIVO ──────────────────────────────────────────────────
 * Que este repo NO interpreta ese campo: lo reenvía tal cual por los dos
 * caminos, y calcula lo suyo (`has_more` / `next_offset`) sin mirarlo.
 *
 * Los tests entran por `GET` — el handler real — con el doble de a2a
 * devolviendo un body con la forma real. NINGUNO re-implementa la condición al
 * lado: lo que se afirma es lo que sale por la respuesta HTTP.
 *
 * ─── LOS TRES VALORES QUE NO PUEDEN SALIR, Y CÓMO SE VEN ────────────────────
 * Las tres formas de "normalizar" `total`, y qué llega al cliente con cada una:
 *
 *   total ?? 0          -> `'unknown'`. `'unknown'` no es nullish, así que el
 *                          `??` no hace NADA. Es el que sobrevive a un test
 *                          descuidado y por eso el que peor tranquiliza.
 *   Number(total)       -> `NaN`, y `JSON.stringify(NaN)` es `null`: al cliente
 *                          le llega `"total": null`, un campo que se lee como
 *                          "no vino". Por eso se afirma contra `null` y no
 *                          contra el texto "NaN", que NUNCA aparece en un JSON.
 *   Number(total) || 0  -> `0`, "no hay agentes", al lado de una página llena de
 *                          agentes. Número plausible y falso: el peor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  A2A_TOTAL_UNKNOWN,
  type A2ADiscoverBody,
} from '@/lib/api/a2a-discover-contract'

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
/** 7 slugs, escritos en un orden que NO es el de salida. */
const CATALOG_SLUGS = [
  'zeta-oracle',
  'alpha-bridge',
  'mid-router',
  'beta-vault',
  'delta-lens',
  'charlie-swap',
  'echo-relay',
] as const

/** El orden de salida esperado, escrito a mano. Sin `.sort()` en este archivo. */
const EXPECTED_TRAVERSAL_ORDER = [
  'alpha-bridge',
  'beta-vault',
  'charlie-swap',
  'delta-lens',
  'echo-relay',
  'mid-router',
  'zeta-oracle',
]

/** Cuántos agentes sirve el doble. Literal, no `CATALOG_SLUGS.length`. */
const SERVED_ROWS = 7

/**
 * La COTA INFERIOR que declara a2a en el caso `'unknown'`. Distinta de
 * `SERVED_ROWS` a propósito: si fueran iguales, un test no podría distinguir
 * "reenvió `totalAtLeast`" de "contó los agentes de la página".
 */
const TOTAL_AT_LEAST = 100

/**
 * Body con la forma real de a2a. Tipado contra el contrato para que quede a la
 * vista de quién es la forma.
 *
 * ⚠️ Este tipado NO es una prueba: `tsconfig.json` excluye `__tests__`, así que
 * `tsc --noEmit` no mira este archivo. Las guardas que SÍ se compilan viven en
 * `a2a-discover-contract.ts` (`AssertTotalIsNotAssignableToNumber`).
 */
function upstreamBody(
  total: A2ADiscoverBody['total'],
  extra: Partial<A2ADiscoverBody> = {},
): A2ADiscoverBody {
  return {
    agents: CATALOG_SLUGS.map((slug, i) => ({
      slug,
      id: `id-${slug}`,
      name: slug,
      priceUsdc: i % 3 === 0 ? 0.01 : 0.02,
      verified: false,
    })),
    total,
    totalAtLeast: typeof total === 'number' ? total : TOTAL_AT_LEAST,
    registries: ['WasiAI'],
    sources: [{ name: 'WasiAI', state: 'ok', rows: SERVED_ROWS }],
    catalogStatus: typeof total === 'number' ? 'complete' : 'truncated',
    excluded: { scope: 0, reputation: 0 },
    ...extra,
  }
}

function respondWith(body: A2ADiscoverBody): void {
  mockForwardRequest.mockImplementation(
    () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
}

function makeGet(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'GET', headers: new Headers(headers) })
}

const BASE = 'http://v2.local/api/v1/capabilities'

describe('GET /api/v1/capabilities — `total` que a2a no sabe', () => {
  beforeEach(() => {
    mockForwardRequest.mockReset()
    mockIsDelegated.mockReset()
    mockIsDelegated.mockReturnValue(true)
  })

  // ── El caso de hoy: a2a sí sabe el total ───────────────────────────────────
  describe('a2a devuelve un `total` numérico (lo de hoy)', () => {
    beforeEach(() => respondWith(upstreamBody(SERVED_ROWS)))

    it('el camino paginado lo reenvía sin tocarlo', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(SERVED_ROWS)
      expect(body.totalAtLeast).toBe(SERVED_ROWS)
      expect(body.catalogStatus).toBe('complete')
    })

    it('el camino por defecto sigue siendo el mismo objeto del proxy', async () => {
      const passthrough = new Response(JSON.stringify(upstreamBody(SERVED_ROWS)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      mockForwardRequest.mockReset()
      mockForwardRequest.mockReturnValue(passthrough)

      const res = await GET(makeGet(BASE))
      expect(res).toBe(passthrough)
      expect((await res.json()).total).toBe(SERVED_ROWS)
    })
  })

  // ── El caso nuevo: a2a NO sabe el total ────────────────────────────────────
  describe("a2a devuelve `total: 'unknown'` + `totalAtLeast`", () => {
    beforeEach(() => respondWith(upstreamBody(A2A_TOTAL_UNKNOWN)))

    it('no rompe: sigue contestando 200 con la página pedida', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agents.map((a: { slug: string }) => a.slug)).toEqual([
        'alpha-bridge',
        'beta-vault',
        'charlie-swap',
      ])
    })

    it("reenvía el literal `'unknown'` tal cual, sin convertirlo", async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      const body = await res.json()
      expect(body.total).toBe(A2A_TOTAL_UNKNOWN)
    })

    it('NO publica 0 ni null como total al lado de una página llena de agentes', async () => {
      // Éste es el que mata las dos "normalizaciones" plausibles:
      //   Number(total)      -> NaN -> serializa `null`
      //   Number(total) || 0 -> 0, que se lee como "no hay agentes"
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      const body = await res.json()
      expect(body.agents.length).toBeGreaterThan(0)
      expect(body.total).not.toBe(0)
      expect(body.total).not.toBeNull()
      expect(body.total).not.toBeUndefined()
    })

    it('no se inventa un total a partir de la página ni de la cota', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      const body = await res.json()
      // Ni el tamaño de la página, ni las filas servidas, ni la cota inferior
      // pueden aparecer con nombre de `total`.
      expect(body.total).not.toBe(3)
      expect(body.total).not.toBe(SERVED_ROWS)
      expect(body.total).not.toBe(TOTAL_AT_LEAST)
    })

    it('deja pasar `totalAtLeast` y `catalogStatus`, que son las señales que quedan', async () => {
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      const body = await res.json()
      expect(body.totalAtLeast).toBe(TOTAL_AT_LEAST)
      expect(body.catalogStatus).toBe('truncated')
    })

    it('`has_more` / `next_offset` salen del arreglo recibido, no de `total`', async () => {
      // 7 filas de a 3: la primera página tiene más, la tercera no.
      const first = await (await GET(makeGet(`${BASE}?offset=0&limit=3`))).json()
      expect(first.has_more).toBe(true)
      expect(first.next_offset).toBe(3)

      const last = await (await GET(makeGet(`${BASE}?offset=6&limit=3`))).json()
      expect(last.agents).toHaveLength(1)
      expect(last.has_more).toBe(false)
      expect(last.next_offset).toBeNull()
    })

    it('el recorrido completo junta todo el conjunto igual que con un total numérico', async () => {
      const collected: string[] = []
      let offset: number | null = 0
      let guard = 0
      while (offset !== null) {
        if (++guard > 50) throw new Error('la paginación no termina')
        const res = await GET(makeGet(`${BASE}?offset=${offset}&limit=2`))
        expect(res.status).toBe(200)
        const body = await res.json()
        // El total desconocido no puede cortar ni alargar el recorrido.
        expect(body.total).toBe(A2A_TOTAL_UNKNOWN)
        for (const a of body.agents) collected.push(a.slug)
        offset = body.next_offset
      }
      expect(collected).toEqual(EXPECTED_TRAVERSAL_ORDER)
      expect(collected).toHaveLength(SERVED_ROWS)
      expect(new Set(collected).size).toBe(SERVED_ROWS)
    })

    it('el camino por defecto lo devuelve byte por byte, sin parsear nada', async () => {
      const raw = JSON.stringify(upstreamBody(A2A_TOTAL_UNKNOWN))
      const passthrough = new Response(raw, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      mockForwardRequest.mockReset()
      mockForwardRequest.mockReturnValue(passthrough)

      const res = await GET(makeGet(BASE))
      // Identidad: es el MISMO objeto del proxy. Si algún día el default
      // parsea el body para "normalizar" `total`, esto se pone rojo.
      expect(res).toBe(passthrough)
      expect(await res.text()).toBe(raw)
    })
  })

  // ── El otro disparador de `'unknown'`, el que sí es alcanzable hoy ─────────
  describe("`catalogStatus: 'partial'` (una fuente no se pudo consultar)", () => {
    it('se trata igual: `partial` también trae `total: unknown`', async () => {
      // No depende del tamaño del catálogo — pasa el día que un registry se
      // cae. Con 7 filas servidas y una fuente `failed`, a2a igual dice que no
      // sabe el total (`resolveReportedTotal`, wasiai-a2a).
      respondWith(
        upstreamBody(A2A_TOTAL_UNKNOWN, {
          catalogStatus: 'partial',
          sources: [
            { name: 'WasiAI', state: 'ok', rows: SERVED_ROWS },
            { name: 'Caido', state: 'failed', rows: null },
          ],
        }),
      )
      const res = await GET(makeGet(`${BASE}?offset=0&limit=3`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(A2A_TOTAL_UNKNOWN)
      expect(body.total).not.toBe(0)
      expect(body.catalogStatus).toBe('partial')
      expect(body.agents).toHaveLength(3)
    })
  })
})
