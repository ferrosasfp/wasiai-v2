/**
 * adminUsers.ts — Supabase Auth admin helpers that survive >1 page of users.
 *
 * GoTrue's `auth.admin.listUsers()` is PAGINATED and exposes no server-side
 * email filter (`PageParams` = `{ page, perPage }` only, perPage capped at 1000).
 * A single `listUsers({ perPage: 1000 })` call therefore truncates SILENTLY:
 * once the project has more than one page of users, an existing email that lives
 * on page 2+ is simply absent from the response, with no error — the caller then
 * concludes "this email does not exist", which is wrong.
 *
 * This helper walks the pages until the user is found or the list is exhausted,
 * with a hard page cap so a misbehaving API can never spin an infinite loop.
 */
import { logger } from '@/lib/logger'

/** GoTrue caps `perPage` at 1000 — use the max to minimise round-trips. */
const PER_PAGE = 1000

/** Defensive stop: 50 pages × 1000 = 500k users scanned, then give up. */
const MAX_PAGES = 50

/**
 * Minimal structural shape of the Supabase client bits this helper touches.
 * Keeps the module free of `server-only` imports (so it is unit-testable) and
 * lets tests pass a plain object instead of a full SupabaseClient.
 */
export type AdminUsersClient = {
  auth: {
    admin: {
      listUsers(params?: { page?: number; perPage?: number }): Promise<{
        data: { users: { id: string; email?: string }[] } | null
        error: { message: string } | null
      }>
    }
  }
}

/**
 * Resolve the auth user id for an email, paging through `listUsers`.
 *
 * @returns the user id, or `null` if the email is not present in any page
 *          (or the admin API errored).
 */
export async function findAuthUserIdByEmail(
  client: AdminUsersClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PER_PAGE })

    if (error) {
      logger.warn('[adminUsers] listUsers failed', { page, err: error.message })
      return null
    }

    const users = data?.users ?? []
    const match = users.find((u) => u.email === email)
    if (match) return match.id

    // Short page (or empty page) → that was the last one. Also guarantees
    // termination when the API keeps returning the same partial page.
    if (users.length < PER_PAGE) return null
  }

  logger.warn('[adminUsers] listUsers page cap reached, email not resolved', { maxPages: MAX_PAGES })
  return null
}
