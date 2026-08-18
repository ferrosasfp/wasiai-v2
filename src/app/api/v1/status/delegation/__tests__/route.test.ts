/**
 * route.test.ts — WKH-361 W2 · T-05 (AC-5), T-06 (AC-6).
 *
 * El mock de `@/lib/env` es obligatorio: `src/lib/env.ts` hace
 * `import 'server-only'`, que bajo vitest LANZA AL COLECTAR (lección de
 * doc/sdd/076-…/auto-blindaje.md). Ningún test del repo mockea `server-only`
 * directamente; el patrón que funciona es mockear `@/lib/env`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `vi.mock` se HOISTEA por encima de las declaraciones del archivo: si la
// factory referencia un `const` de arriba, explota con "Cannot access X before
// initialization". Por eso los valores viajan por `vi.hoisted`.
const secrets = vi.hoisted(() => ({
  A2A_URL: 'http://a2a.local',
  FORWARD_KEY: 'test-forward-key-1234567890abcd',
}))
const A2A_URL = secrets.A2A_URL
const FORWARD_KEY = secrets.FORWARD_KEY

vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: secrets.A2A_URL,
    WASIAI_V2_FORWARD_KEY: secrets.FORWARD_KEY,
    V2_DELEGATE_TO_A2A: 'compose,orchestrate,capabilities',
    NODE_ENV: 'test',
  },
}))

import { GET } from '../route'

function makeReq(host?: string): Request {
  return new Request('http://v2.local/api/v1/status/delegation', {
    method: 'GET',
    headers: host === undefined ? {} : { host },
  })
}

interface DelegationStatusBody {
  environment: {
    host: string | null
    vercelEnv: string | null
    deploymentId: string | null
    commitSha: string | null
    declaredAs: string | null
  }
  delegation: {
    runtime: string[]
    declared: string[] | null
    match: string
  }
  config: { WASIAI_A2A_BASE_URL: boolean; WASIAI_V2_FORWARD_KEY: boolean }
  passthroughHeaders: string[]
  checkedAt: string
}

const ENV_KEYS = [
  'VERCEL_ENV',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_GIT_COMMIT_SHA',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('T-05 (AC-5): GET /api/v1/status/delegation', () => {
  it('200 con environment, delegation.runtime y los dos booleanos de config', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_test123'
    process.env.VERCEL_GIT_COMMIT_SHA = 'b558713deadbeef'

    const res = await GET(makeReq('app.wasiai.io'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as DelegationStatusBody

    expect(body.environment.host).toBe('app.wasiai.io')
    expect(body.environment.vercelEnv).toBe('production')
    expect(body.environment.deploymentId).toBe('dpl_test123')
    expect(body.environment.commitSha).toBe('b558713deadbeef')
    expect(body.environment.declaredAs).toBe('wasiai-prod')

    // CD-4: sale de listDelegatedEndpoints(), el mismo símbolo que usan las
    // rutas, ordenado alfabéticamente (CD-16).
    expect(body.delegation.runtime).toEqual(['capabilities', 'compose', 'orchestrate'])
    expect(body.delegation.declared).toEqual(['capabilities', 'compose', 'orchestrate'])
    expect(body.delegation.match).toBe('MATCH')

    expect(body.config.WASIAI_A2A_BASE_URL).toBe(true)
    expect(body.config.WASIAI_V2_FORWARD_KEY).toBe(true)
    expect(body.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('NO filtra el VALOR de WASIAI_A2A_BASE_URL ni de WASIAI_V2_FORWARD_KEY', async () => {
    const res = await GET(makeReq('app.wasiai.io'))
    const body = (await res.json()) as DelegationStatusBody
    const serialized = JSON.stringify(body)
    // Buscar el substring del valor mockeado: si el endpoint alguna vez
    // devuelve el valor (o un prefijo suyo), esto se pone rojo.
    expect(serialized).not.toContain(FORWARD_KEY)
    expect(serialized).not.toContain(A2A_URL)
    expect(serialized).not.toContain('a2a.local')
    expect(serialized).not.toContain('test-forward-key')
    // Tampoco la longitud, que también filtra (CD-11): los dos campos de
    // `config` son booleanos estrictos y nada más.
    //   (buscar el número de la longitud como substring sería un flake: la
    //    marca de tiempo ISO de `checkedAt` contiene dígitos arbitrarios)
    expect(typeof body.config.WASIAI_A2A_BASE_URL).toBe('boolean')
    expect(typeof body.config.WASIAI_V2_FORWARD_KEY).toBe('boolean')
    expect(Object.keys(body.config).sort()).toEqual([
      'WASIAI_A2A_BASE_URL',
      'WASIAI_V2_FORWARD_KEY',
    ])
  })

  it('publica los NOMBRES de header reenviados, incluidos los tres de WKH-361', async () => {
    const res = await GET(makeReq('app.wasiai.io'))
    const body = (await res.json()) as DelegationStatusBody
    expect(body.passthroughHeaders).toContain('x-payment-chain')
    expect(body.passthroughHeaders).toContain('x-a2a-contracting-chain')
    expect(body.passthroughHeaders).toContain('x-a2a-contracting-depth')
    expect(body.passthroughHeaders).toHaveLength(11)
  })

  it('sirve Cache-Control: no-store (CD-11)', async () => {
    const res = await GET(makeReq('app.wasiai.io'))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('los campos de Vercel ausentes salen null, no undefined ni string vacío', async () => {
    const res = await GET(makeReq('app.wasiai.io'))
    const body = (await res.json()) as DelegationStatusBody
    expect(body.environment.vercelEnv).toBeNull()
    expect(body.environment.deploymentId).toBeNull()
    expect(body.environment.commitSha).toBeNull()
  })
})

describe('T-06 (AC-6): dos ambientes distintos se distinguen entre sí', () => {
  it('app.wasiai.io y wasiai-v2.vercel.app devuelven environment y declaredAs distintos', async () => {
    const prodBody = (await (
      await GET(makeReq('app.wasiai.io'))
    ).json()) as DelegationStatusBody
    const stagingBody = (await (
      await GET(makeReq('wasiai-v2.vercel.app'))
    ).json()) as DelegationStatusBody

    expect(prodBody.environment.declaredAs).toBe('wasiai-prod')
    expect(stagingBody.environment.declaredAs).toBe('wasiai-v2')
    expect(prodBody.environment.declaredAs).not.toBe(stagingBody.environment.declaredAs)
    expect(prodBody.environment.host).not.toBe(stagingBody.environment.host)
    // Atrapa un endpoint que ignore el `Host` y conteste siempre lo mismo.
    expect(JSON.stringify(prodBody.environment)).not.toBe(
      JSON.stringify(stagingBody.environment),
    )
  })

  it('un host declarado con delegated distinto al runtime da DRIFT, no MATCH', async () => {
    // wasiai-v2 declara CERO endpoints (DT-2 B+) y este despliegue mockeado
    // delega tres ⇒ el veredicto tiene que ser DRIFT. Si diera MATCH, el
    // endpoint estaría comparando contra sí mismo.
    const body = (await (
      await GET(makeReq('wasiai-v2.vercel.app'))
    ).json()) as DelegationStatusBody
    expect(body.delegation.declared).toEqual([])
    expect(body.delegation.match).toBe('DRIFT')
  })

  it('host no declarado ⇒ declared null y match UNDECLARED_HOST', async () => {
    const body = (await (
      await GET(makeReq('un-preview-cualquiera.vercel.app'))
    ).json()) as DelegationStatusBody
    expect(body.environment.host).toBe('un-preview-cualquiera.vercel.app')
    expect(body.environment.declaredAs).toBeNull()
    expect(body.delegation.declared).toBeNull()
    expect(body.delegation.match).toBe('UNDECLARED_HOST')
    // El runtime se sigue informando aunque el host no esté declarado.
    expect(body.delegation.runtime).toEqual(['capabilities', 'compose', 'orchestrate'])
  })

  it('normaliza el Host: mayúsculas y puerto no cambian el ambiente resuelto', async () => {
    const body = (await (
      await GET(makeReq('APP.WASIAI.IO:443'))
    ).json()) as DelegationStatusBody
    expect(body.environment.host).toBe('app.wasiai.io')
    expect(body.environment.declaredAs).toBe('wasiai-prod')
  })
})
