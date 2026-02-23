/**
 * api.types.ts — Shared API response types + helpers
 *
 * T-10: Provides consistent ApiSuccess<T>/ApiError types and ok()/fail()
 *       factory functions to replace ad-hoc NextResponse.json() patterns.
 *
 * Usage in API routes:
 *   import { ok, fail } from '@/types/api.types'
 *   return NextResponse.json(ok({ user }), { status: 200 })
 *   return NextResponse.json(fail('Unauthorized'), { status: 401 })
 */

// ── Response envelopes ────────────────────────────────────────────────────────

export interface ApiSuccess<T = unknown> {
  ok: true
  data: T
}

export interface ApiError {
  ok: false
  error: string
  code?: string
  details?: unknown
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Creates a success response envelope.
 * @example return NextResponse.json(ok({ items, total }))
 */
export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data }
}

/**
 * Creates an error response envelope.
 * @example return NextResponse.json(fail('Unauthorized', 'auth_required'), { status: 401 })
 */
export function fail(error: string, code?: string, details?: unknown): ApiError {
  return {
    ok: false,
    error,
    ...(code    !== undefined ? { code }    : {}),
    ...(details !== undefined ? { details } : {}),
  }
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasNext: boolean
  hasPrev: boolean
}

export function paginated<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResponse<T> {
  return {
    items,
    total,
    limit,
    offset,
    hasNext: offset + limit < total,
    hasPrev: offset > 0,
  }
}
