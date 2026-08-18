/**
 * delegation-off.test.ts — WKH-361 W1 · T-10 (AC-10).
 *
 * La reversa: mientras `V2_DELEGATE_TO_A2A` esté vacío o ausente en un
 * ambiente, `/compose` y `/orchestrate` responden 503 en ESE ambiente, o sea
 * exactamente el comportamiento previo al cutover. Hasta hoy no existía
 * NINGÚN test del mundo no-delegado: el único mundo cubierto era el encendido.
 *
 * ARCHIVO PROPIO a propósito (DT-9): `DELEGATED` se congela en carga de módulo
 * (`forward-handler.ts`), y `vi.mock('@/lib/env')` es POR ARCHIVO. Un mock con
 * la delegación apagada no puede convivir en el mismo archivo con el mock que
 * la tiene encendida — el primer import gana y el test mediría el mundo
 * equivocado sin fallar.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mock env ANTES de importar las rutas: el helper congela el conjunto delegado
// al cargar el módulo. `V2_DELEGATE_TO_A2A: ''` = ambiente que NO delega.
vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: '',
    NODE_ENV: 'test',
  },
}))

import { POST as composePost } from '@/app/api/v1/compose/route'
import { POST as orchestratePost } from '@/app/api/v1/orchestrate/route'
import { listDelegatedEndpoints, isDelegated } from '../forward-handler'

function makePost(url: string, body: string): NextRequest {
  const init: RequestInit & { duplex?: string } = {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body,
    duplex: 'half',
  }
  return new NextRequest(url, init as RequestInit)
}

describe('T-10 (AC-10): ambiente con V2_DELEGATE_TO_A2A vacío', () => {
  it('no delega NINGÚN endpoint', () => {
    expect(listDelegatedEndpoints()).toEqual([])
    expect(isDelegated('compose')).toBe(false)
    expect(isDelegated('orchestrate')).toBe(false)
    expect(isDelegated('capabilities')).toBe(false)
    expect(isDelegated('mcp')).toBe(false)
  })

  it('POST /api/v1/compose responde 503 COMPOSE_DISABLED', async () => {
    const res = await composePost(
      makePost('http://v2.local/api/v1/compose', '{"steps":[]}'),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('COMPOSE_DISABLED')
  })

  it('POST /api/v1/orchestrate responde 503 ORCHESTRATE_DISABLED', async () => {
    const res = await orchestratePost(
      makePost('http://v2.local/api/v1/orchestrate', '{"goal":"x"}'),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('ORCHESTRATE_DISABLED')
  })

  it('el 503 se decide ANTES de tocar la red: fetch nunca se llama', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    await composePost(makePost('http://v2.local/api/v1/compose', '{"steps":[]}'))
    await orchestratePost(makePost('http://v2.local/api/v1/orchestrate', '{}'))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
