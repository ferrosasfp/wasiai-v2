/**
 * route.test.ts — WKH-361 W2 · T-07, T-07b (AC-7), T-09, T-09b (AC-11 / CD-10).
 *
 * `DELEGATED` se congela en carga de módulo (`forward-handler.ts`), así que
 * para probar dos mundos de delegación distintos en un mismo archivo hay que
 * volver a cargar el grafo: `vi.resetModules()` + `await import('../route')`.
 * El mock de `@/lib/env` expone `V2_DELEGATE_TO_A2A` como GETTER sobre un
 * objeto de `vi.hoisted`, para que la recarga lea el valor vigente y no el que
 * la factory capturó la primera vez.
 *
 * El mock de `@/lib/env` es obligatorio igual: `src/lib/env.ts` hace
 * `import 'server-only'`, que bajo vitest lanza al colectar (auto-blindaje 076).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ delegate: 'compose,orchestrate,capabilities' }))
const mocks = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    get V2_DELEGATE_TO_A2A() {
      return state.delegate
    },
    NODE_ENV: 'test',
  },
}))
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage: mocks.captureMessage }))

const CRON_SECRET = 'test-cron-secret'

/** El card que `wasiai-a2a` publica hoy (medido 2026-08-18 @ 10a6eb1). */
const CARD_TODAY = {
  name: 'wasiai-a2a',
  contracting: {
    depthMax: 2,
    chainHeader: 'x-a2a-contracting-chain',
    depthHeader: 'x-a2a-contracting-depth',
    bestEffortNote: '…',
  },
}

interface DriftBody {
  environment: {
    host: string | null
    declaredAs: string | null
    vercelProject: string | null
    vercelEnv: string | null
  }
  delegation: {
    verdict: string
    runtime: string[]
    declared: string[] | null
    missing: string[]
    unexpected: string[]
  }
  agentCard: {
    verdict: string
    reachable: boolean
    declaredHeaders: string[]
    missing: string[]
    reason: string | null
  }
  checkedAt: string
}

type Handler = (req: Request) => Promise<Response>

/** Recarga la ruta con el conjunto delegado pedido. */
async function loadRoute(delegate: string): Promise<Handler> {
  state.delegate = delegate
  vi.resetModules()
  const mod = (await import('../route')) as { GET: Handler }
  return mod.GET
}

function makeRequest(opts: { auth?: string | undefined; host?: string }): Request {
  const headers: Record<string, string> = {}
  if (opts.auth !== undefined) headers.authorization = opts.auth
  if (opts.host !== undefined) headers.host = opts.host
  return new Request('http://v2.local/api/cron/delegation-drift', {
    method: 'GET',
    headers,
  })
}

function mockCard(card: unknown): void {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

describe('delegation-drift cron — auth', () => {
  it('401 cuando CRON_SECRET no coincide', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    const fetchSpy = vi.spyOn(global, 'fetch')
    const res = await GET(makeRequest({ auth: 'Bearer wrong', host: 'app.wasiai.io' }))
    expect(res.status).toBe(401)
    // La auth corta ANTES de salir a la red por el agent card.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('401 sin header de authorization', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    const res = await GET(makeRequest({ host: 'app.wasiai.io' }))
    expect(res.status).toBe(401)
  })

  it('500 cuando CRON_SECRET no está configurado', async () => {
    delete process.env.CRON_SECRET
    const GET = await loadRoute('compose,orchestrate,capabilities')
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(500)
  })
})

describe('T-07 (AC-7): drift entre lo declarado y lo que el runtime delega', () => {
  it('manifiesto [capabilities,compose,orchestrate] vs runtime [compose] ⇒ 500 nombrando ambiente y endpoints', async () => {
    const GET = await loadRoute('compose')
    mockCard(CARD_TODAY)
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as DriftBody

    expect(body.delegation.verdict).toBe('DELEGATION_DRIFT')
    expect(body.delegation.missing).toEqual(['capabilities', 'orchestrate'])
    expect(body.delegation.unexpected).toEqual([])
    expect(body.delegation.runtime).toEqual(['compose'])
    // AC-7 exige nombrar EL AMBIENTE, no sólo que hay drift.
    expect(body.environment.declaredAs).toBe('wasiai-prod')
    expect(body.environment.vercelProject).toBe('wasiai-prod')
    expect(body.environment.host).toBe('app.wasiai.io')

    // Canal 2 (log) y canal 3 (Sentry, best-effort) además del 500.
    expect(mocks.loggerError).toHaveBeenCalled()
    expect(mocks.captureMessage).toHaveBeenCalled()
  })

  it('runtime con un endpoint que el manifiesto NO declara ⇒ unexpected, también 500', async () => {
    const GET = await loadRoute('compose')
    mockCard(CARD_TODAY)
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'wasiai-v2.vercel.app' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as DriftBody
    expect(body.delegation.verdict).toBe('DELEGATION_DRIFT')
    expect(body.delegation.declared).toEqual([])
    expect(body.delegation.unexpected).toEqual(['compose'])
    expect(body.delegation.missing).toEqual([])
    expect(body.environment.declaredAs).toBe('wasiai-v2')
  })

  it('runtime == declarado ⇒ MATCH y 200 (el orden no importa, se compara como conjunto)', async () => {
    // CD-16: el flag viene en otro orden que el manifiesto a propósito.
    const GET = await loadRoute('orchestrate,capabilities,compose')
    mockCard(CARD_TODAY)
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as DriftBody
    expect(body.delegation.verdict).toBe('MATCH')
    expect(body.agentCard.verdict).toBe('MATCH')
    expect(mocks.loggerError).not.toHaveBeenCalled()
    expect(mocks.captureMessage).not.toHaveBeenCalled()
  })
})

describe('T-07b (AC-7): host no declarado', () => {
  it('⇒ 500 UNDECLARED_HOST con el host crudo en el body', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    mockCard(CARD_TODAY)
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'preview-xyz-123.vercel.app' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as DriftBody
    expect(body.delegation.verdict).toBe('UNDECLARED_HOST')
    expect(body.environment.host).toBe('preview-xyz-123.vercel.app')
    expect(body.environment.declaredAs).toBeNull()
    expect(body.delegation.declared).toBeNull()
    expect(mocks.loggerError).toHaveBeenCalled()
  })
})

describe('T-09 (AC-11): el card declara un header que la lista blanca no tiene', () => {
  it('⇒ 500 HEADER_WHITELIST_DRIFT nombrando ese header, con la delegación en MATCH', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    mockCard({
      contracting: {
        chainHeader: 'x-a2a-brand-new-header',
        depthHeader: 'x-a2a-contracting-depth',
      },
    })
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as DriftBody
    // La delegación está bien: el 500 viene SÓLO del card-diff. Si esta línea
    // fallara, el test no estaría midiendo AC-11 sino AC-7.
    expect(body.delegation.verdict).toBe('MATCH')
    expect(body.agentCard.verdict).toBe('HEADER_WHITELIST_DRIFT')
    expect(body.agentCard.reachable).toBe(true)
    expect(body.agentCard.missing).toEqual(['x-a2a-brand-new-header'])
    expect(mocks.loggerError).toHaveBeenCalled()
  })

  it('los dos headers que el card declara HOY ya están en la lista blanca ⇒ MATCH', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    mockCard(CARD_TODAY)
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as DriftBody
    expect(body.agentCard.declaredHeaders).toEqual([
      'x-a2a-contracting-chain',
      'x-a2a-contracting-depth',
    ])
    expect(body.agentCard.missing).toEqual([])
    expect(body.agentCard.verdict).toBe('MATCH')
  })
})

describe('T-09b (AC-11 / CD-10): gateway caído NO es divergencia de lista blanca', () => {
  it('el fetch del card rechaza ⇒ reachable:false + WARN + 200', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as DriftBody
    expect(body.agentCard.reachable).toBe(false)
    expect(body.agentCard.verdict).toBe('WARN')
    expect(body.agentCard.verdict).not.toBe('HEADER_WHITELIST_DRIFT')
    expect(body.agentCard.missing).toEqual([])
    expect(body.agentCard.reason).toContain('ECONNREFUSED')
    // Se informa, no se disfraza de alarma.
    expect(mocks.loggerWarn).toHaveBeenCalled()
    expect(mocks.loggerError).not.toHaveBeenCalled()
    expect(mocks.captureMessage).not.toHaveBeenCalled()
  })

  it('card que responde 503 ⇒ WARN + 200', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('nope', { status: 503 }) as unknown as Response,
    )
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as DriftBody
    expect(body.agentCard.verdict).toBe('WARN')
    expect(body.agentCard.reason).toContain('503')
  })

  it('card SIN bloque contracting ⇒ WARN + 200', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    mockCard({ name: 'wasiai-a2a', skills: [] })
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as DriftBody
    expect(body.agentCard.verdict).toBe('WARN')
    expect(body.agentCard.declaredHeaders).toEqual([])
  })

  it('card con los campos de header NO-string ⇒ WARN + 200 (no se inventa un header)', async () => {
    const GET = await loadRoute('compose,orchestrate,capabilities')
    mockCard({ contracting: { chainHeader: 42, depthHeader: null, depthMax: 2 } })
    const res = await GET(
      makeRequest({ auth: `Bearer ${CRON_SECRET}`, host: 'app.wasiai.io' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as DriftBody
    expect(body.agentCard.verdict).toBe('WARN')
    expect(body.agentCard.declaredHeaders).toEqual([])
    expect(body.agentCard.missing).toEqual([])
  })
})
