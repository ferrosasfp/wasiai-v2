/**
 * findAuthUserIdByEmail — resolución de user id por email SIN truncamiento.
 *
 * Bug original (register/route.ts): `listUsers({ perPage: 1000 })` en una sola
 * llamada. `listUsers` es paginado y no acepta filtro por email, así que con más
 * de una página de usuarios el email existente NO aparecía en la respuesta (sin
 * error) → userId=null → el agente se registraba bajo la cuenta de sistema y sin
 * management key. Estos tests fijan el comportamiento paginado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findAuthUserIdByEmail, type AdminUsersClient } from '../adminUsers'

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const PER_PAGE = 1000

type AdminUser = { id: string; email?: string }
type ListUsers = AdminUsersClient['auth']['admin']['listUsers']

/** Página sintética llena de usuarios que NO son el buscado. */
function fillerPage(page: number, size = PER_PAGE): AdminUser[] {
  return Array.from({ length: size }, (_, i) => ({
    id:    `u-${page}-${i}`,
    email: `filler-${page}-${i}@example.com`,
  }))
}

function clientWith(listUsers: ListUsers): AdminUsersClient {
  return { auth: { admin: { listUsers } } }
}

let listUsers: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  listUsers = vi.fn()
})

describe('findAuthUserIdByEmail', () => {
  it('encuentra el usuario en la primera página con una sola llamada', async () => {
    listUsers.mockResolvedValue({
      data: { users: [{ id: 'u-1', email: 'other@example.com' }, { id: 'u-2', email: 'dev@example.com' }] },
      error: null,
    })

    const id = await findAuthUserIdByEmail(clientWith(listUsers as unknown as ListUsers), 'dev@example.com')

    expect(id).toBe('u-2')
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: PER_PAGE })
  })

  it('CASO DEL BUG: con >1000 usuarios encuentra el email en la página 3', async () => {
    listUsers.mockImplementation(async ({ page }: { page?: number } = {}) => {
      if (page === 3) {
        return { data: { users: [...fillerPage(3, 10), { id: 'u-target', email: 'dev@example.com' }] }, error: null }
      }
      return { data: { users: fillerPage(page ?? 1) }, error: null }
    })

    const id = await findAuthUserIdByEmail(clientWith(listUsers as unknown as ListUsers), 'dev@example.com')

    expect(id).toBe('u-target')
    expect(listUsers).toHaveBeenCalledTimes(3)
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: PER_PAGE })
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: PER_PAGE })
    expect(listUsers).toHaveBeenNthCalledWith(3, { page: 3, perPage: PER_PAGE })
  })

  it('devuelve null y deja de pedir páginas cuando la página está incompleta', async () => {
    listUsers.mockImplementation(async ({ page }: { page?: number } = {}) => {
      if (page === 1) return { data: { users: fillerPage(1) }, error: null }
      return { data: { users: fillerPage(2, 3) }, error: null }   // última página (parcial)
    })

    const id = await findAuthUserIdByEmail(clientWith(listUsers as unknown as ListUsers), 'nobody@example.com')

    expect(id).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(2)
  })

  it('devuelve null con lista vacía (una sola llamada)', async () => {
    listUsers.mockResolvedValue({ data: { users: [] }, error: null })

    expect(await findAuthUserIdByEmail(clientWith(listUsers as unknown as ListUsers), 'dev@example.com')).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(1)
  })

  it('devuelve null y corta al primer error del admin API', async () => {
    listUsers.mockResolvedValue({ data: null, error: { message: 'service unavailable' } })

    expect(await findAuthUserIdByEmail(clientWith(listUsers as unknown as ListUsers), 'dev@example.com')).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(1)
  })

  it('no hace loop infinito: corta en el tope de páginas si todas vienen llenas', async () => {
    listUsers.mockImplementation(async ({ page }: { page?: number } = {}) => ({
      data: { users: fillerPage(page ?? 1) },
      error: null,
    }))

    const id = await findAuthUserIdByEmail(clientWith(listUsers as unknown as ListUsers), 'nobody@example.com')

    expect(id).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(50)
  })
})
