/**
 * proxy-headers.test.ts — WKH-361 fix-pack AR · `MNR-5`.
 *
 * EL ESLABÓN QUE NADIE MEDÍA. `route.ts:60-69` **reconstruye** el `NextRequest`
 * (el body de `NextRequest` es single-shot, así que se lee y se arma uno nuevo)
 * antes de llamar a `forwardRequest`. El otro test de esta ruta
 * (`proxy.test.ts:24`) **mockea `forwardRequest`**, y los tests de la lista
 * blanca (`forward-handler.test.ts`) miden `forwardRequest` AISLADO. O sea que
 * la cadena real —header del caller → `new NextRequest(...)` → `forwardRequest`
 * → `fetch`— no la ejercitaba ningún test: un cambio en cómo se reconstruye el
 * request podía matar el fix del camino del dinero con todo en verde.
 *
 * Por eso acá NO se mockea `forward-handler`: se mockea `@/lib/env` (para fijar
 * la delegación y la forward key) y se espía `fetch`, que es el borde real.
 * Archivo propio porque `proxy.test.ts` mockea el módulo a nivel de archivo y
 * los dos mundos no conviven — mismo motivo que DT-9 para `delegation-off`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    // `compose` delegado: sin esto la ruta corta en 503 y no se mide nada.
    V2_DELEGATE_TO_A2A: 'compose',
    NODE_ENV: 'test',
  },
}))

import { POST } from '../route'

function makePost(headers: Record<string, string>, body = '{"steps":[]}'): NextRequest {
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body,
    duplex: 'half',
  }
  return new NextRequest('http://v2.local/api/v1/compose', init as RequestInit)
}

/** Los headers con que se llamó a `fetch`, en minúsculas. */
function sentHeaders(spy: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = spy.mock.calls[0][1] as { headers: Record<string, string> }
  return Object.fromEntries(
    Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  )
}

let fetchSpy: ReturnType<typeof vi.fn>
const realFetch = globalThis.fetch

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
  globalThis.fetch = fetchSpy as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('MNR-5: la reconstrucción del NextRequest no pierde los headers del camino del dinero', () => {
  it('los 3 headers de WKH-361 llegan al fetch upstream con el valor SIN modificar', async () => {
    const res = await POST(
      makePost({
        'x-payment-chain': 'base-sepolia',
        'x-a2a-contracting-chain': 'a.example,b.example',
        'x-a2a-contracting-depth': '1',
      }),
    )
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://a2a.local/compose')

    const h = sentHeaders(fetchSpy)
    expect(h['x-payment-chain']).toBe('base-sepolia')
    expect(h['x-a2a-contracting-chain']).toBe('a.example,b.example')
    expect(h['x-a2a-contracting-depth']).toBe('1')
    // La inyección de la forward key sobrevive la reconstrucción.
    expect(h['x-wasiai-forward-key']).toBe('test-forward-key-1234567890abcd')
    expect(h['x-wasiai-source']).toBe('v2-proxy')
  })

  it('el body leído para el pre-check de AC-11 se reenvía intacto', async () => {
    // La reconstrucción existe justamente porque el body ya se consumió: si se
    // rompiera, el upstream recibiría vacío y el caller vería un error de
    // validación en vez de su pipeline.
    const body = JSON.stringify({ steps: [{ agent: 'wasi-chainlink-price' }] })
    await POST(makePost({ 'x-payment-chain': 'base-sepolia' }, body))
    const init = fetchSpy.mock.calls[0][1] as { body?: string }
    expect(init.body).toBe(body)
  })

  it('AC-3: la cookie de sesión NO cruza el borde', async () => {
    await POST(
      makePost({
        cookie: 'sb-access-token=super-secreto; sb-refresh-token=otro',
        referer: 'https://app.wasiai.io/demo',
        'x-vercel-id': 'iad1::iad1::traza',
        'x-payment-chain': 'base-sepolia',
      }),
    )
    const h = sentHeaders(fetchSpy)
    expect(h['cookie']).toBeUndefined()
    expect(h['referer']).toBeUndefined()
    expect(h['x-vercel-id']).toBeUndefined()
    expect(JSON.stringify(h)).not.toContain('super-secreto')
    // …y el que sí tiene que pasar, pasa: la ausencia de cookie no es porque no
    // se haya copiado nada.
    expect(h['x-payment-chain']).toBe('base-sepolia')
  })

  it('AC-2: el header que el caller NO manda no se emite upstream, ni vacío', async () => {
    await POST(makePost({ 'x-payment-chain': 'base-sepolia' }))
    const h = sentHeaders(fetchSpy)
    expect('x-a2a-contracting-chain' in h).toBe(false)
    expect('x-a2a-contracting-depth' in h).toBe(false)
  })

  it('un valor de sólo espacios NO se reenvía — el proxy es más permisivo que el gateway, a propósito', async () => {
    // Medido el 2026-08-18 contra el gateway: `x-payment-chain: '   '` llega
    // como valor vacío (el parseo de HTTP recorta el OWS) y el gateway responde
    // 400 CHAIN_NOT_SUPPORTED. A través del proxy NO pasa eso: la guarda `if (v)`
    // de `forward-handler.ts:136` lo descarta y el caller recibe la cotización
    // de la red por defecto, igual que hoy.
    //   Esto cierra la medición que el AR declaró indecidible con curl (§6.4):
    //   con curl no se distingue "header vacío" de "header ausente"; acá se ve
    //   qué recibe el código, que es la pregunta que importaba.
    await POST(makePost({ 'x-payment-chain': '   ', 'x-a2a-contracting-depth': '  ' }))
    const h = sentHeaders(fetchSpy)
    expect('x-payment-chain' in h).toBe(false)
    expect('x-a2a-contracting-depth' in h).toBe(false)
  })

  it('el pre-check de retry corta ANTES de salir a la red', async () => {
    const res = await POST(
      makePost({ 'x-payment-chain': 'base-sepolia' }, '{"steps":[],"start_from_step":2}'),
    )
    expect(res.status).toBe(422)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
