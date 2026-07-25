/**
 * Onboarding step 8 (email flow) — el creador que YA existe en auth.users se
 * resuelve aunque viva más allá de la primera página de `listUsers`.
 *
 * Bug original (route.ts): `listUsers({ perPage: 1000 })` en UNA sola llamada.
 * `listUsers` es paginado y no acepta filtro por email, así que con más de una
 * página de usuarios el email existente no aparecía en la respuesta y NO había
 * error → `existing` undefined → 500 'Failed to resolve existing account'.
 * Y era PERMANENTE: el retry vuelve a chocar contra el mismo createUser
 * email_exists + la misma página 1 sin el usuario, así que el creador recurrente
 * nunca podía terminar el wizard.
 *
 * Ahora el sitio delega en findAuthUserIdByEmail (helper paginado, ya cubierto
 * por sus propios unit tests); acá se fija el CABLEADO de la ruta: el id
 * resuelto es el que termina como owner de la key y creator del agente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc:               vi.fn(),
  sessionSingle:     vi.fn(),
  agentExistsSingle: vi.fn(),
  keyInsert:         vi.fn(),
  agentInsert:       vi.fn(),
  agentInsertArg:    vi.fn(),
  sessionUpdateEq:   vi.fn(),
  keyDeleteEq:       vi.fn(),
  createUser:        vi.fn(),
  listUsers:         vi.fn(),
  deleteUser:        vi.fn(),
}))

const SESSION_ID    = 'sess-step8'
const EMAIL         = 'returning-dev@example.com'
const EXISTING_ID   = 'user-on-page-2'
/** GoTrue tope de perPage — una página llena significa "hay más páginas". */
const PER_PAGE      = 1000

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    rpc: mocks.rpc,
    auth: {
      admin: {
        createUser: mocks.createUser,
        listUsers:  mocks.listUsers,
        deleteUser: mocks.deleteUser,
      },
    },
    from: (table: string) => {
      if (table === 'onboarding_sessions') {
        return {
          select: () => ({ eq: () => ({ gt: () => ({ single: mocks.sessionSingle }) }) }),
          update: () => ({ eq: mocks.sessionUpdateEq }),
        }
      }
      if (table === 'agents') {
        return {
          select: () => ({ eq: () => ({ single: mocks.agentExistsSingle }) }),
          insert: (payload: unknown) => {
            mocks.agentInsertArg(payload)
            return { select: () => ({ single: mocks.agentInsert }) }
          },
        }
      }
      if (table === 'agent_keys') {
        return {
          insert: mocks.keyInsert,
          delete: () => ({ eq: mocks.keyDeleteEq }),
        }
      }
      return {}
    },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrlAsync: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/agent-api/services/agent-keys.service', () => ({
  generateApiKey: vi.fn(() => ({ raw: 'sk_raw', hash: 'hash_xyz' })),
}))
vi.mock('@/lib/chain', () => ({ CHAIN_NAME: 'avalanche-testnet' }))
vi.mock('@/features/agents/utils/buildExampleFromSchema', () => ({
  buildExampleFromSchema: vi.fn(() => ({})),
}))
vi.mock('@/lib/schema-validator', () => ({
  metaValidateSchema: vi.fn(() => ({ valid: true })),
}))
vi.mock('@/lib/api/jsonError', () => ({
  jsonError: vi.fn(() => new Response('err', { status: 400 })),
}))

import { processOnboardStep } from '../route'

/** Sesión parada en el paso terminal 8 (flujo email). */
function step8Session() {
  return {
    data: {
      id: SESSION_ID,
      status: 'in_progress',
      current_step: 8,
      data: { name: 'My Agent', category: 'nlp', price_per_call: 1 },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    error: null,
  }
}

/** Página llena de usuarios que NO son el buscado (fuerza otra página). */
function fillerPage(page: number) {
  return Array.from({ length: PER_PAGE }, (_, i) => ({
    id:    `u-${page}-${i}`,
    email: `filler-${page}-${i}@example.com`,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sessionSingle.mockResolvedValue(step8Session())
  mocks.agentExistsSingle.mockResolvedValue({ data: null })
  mocks.keyInsert.mockResolvedValue({ error: null })
  mocks.agentInsert.mockResolvedValue({ data: { id: 'agent-1', slug: 'my-agent' }, error: null })
  mocks.sessionUpdateEq.mockResolvedValue({ error: null })
  mocks.keyDeleteEq.mockResolvedValue({ error: null })
  mocks.deleteUser.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({ data: true, error: null })
  // El email ya existe en auth.users → createUser rebota.
  mocks.createUser.mockResolvedValue({
    data:  null,
    error: { message: 'User already registered', code: 'email_exists', status: 422 },
  })
})

describe('onboard step 8 — resolución del usuario existente con listUsers paginado', () => {
  it('encuentra al usuario existente en la página 2 y le atribuye key + agente', async () => {
    mocks.listUsers.mockImplementation(async ({ page }: { page?: number } = {}) => {
      if (page === 1) return { data: { users: fillerPage(1) }, error: null }
      return { data: { users: [{ id: EXISTING_ID, email: EMAIL }] }, error: null }
    })

    const res = await processOnboardStep(SESSION_ID, EMAIL)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.completed).toBe(true)
    expect(body.agent_key).toBe('sk_raw')

    // Recorrió páginas: con la implementación vieja (1 sola llamada) esto era 500.
    expect(mocks.listUsers).toHaveBeenCalledTimes(2)
    expect(mocks.listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: PER_PAGE })
    expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: PER_PAGE })

    // El id resuelto es el owner de la key y el creator del agente.
    expect(mocks.keyInsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: EXISTING_ID }))
    expect(mocks.agentInsertArg).toHaveBeenCalledWith(expect.objectContaining({ creator_id: EXISTING_ID }))

    // Usuario preexistente ⇒ jamás se borra la cuenta.
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('si el email no está en ninguna página → 500 y libera el claim, sin side-effects', async () => {
    mocks.listUsers.mockImplementation(async ({ page }: { page?: number } = {}) => {
      if (page === 1) return { data: { users: fillerPage(1) }, error: null }
      return { data: { users: [] }, error: null }
    })

    const res = await processOnboardStep(SESSION_ID, EMAIL)

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to resolve existing account')
    expect(mocks.listUsers).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenCalledWith('release_onboard_step_claim', { p_session_id: SESSION_ID })
    expect(mocks.keyInsert).not.toHaveBeenCalled()
    expect(mocks.agentInsertArg).not.toHaveBeenCalled()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('cuando createUser tiene éxito no consulta listUsers', async () => {
    mocks.createUser.mockResolvedValue({ data: { user: { id: 'brand-new-user' } }, error: null })

    const res = await processOnboardStep(SESSION_ID, EMAIL)

    expect(res.status).toBe(200)
    expect(mocks.listUsers).not.toHaveBeenCalled()
    expect(mocks.keyInsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'brand-new-user' }))
  })
})
