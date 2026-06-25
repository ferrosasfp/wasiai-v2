/**
 * jsonError.ts — Consistent JSON error/ok responses for API routes
 *
 * V10 (audit 2026-06-25): Stop leaking raw Supabase `error.message` /
 * `String(err)` to clients. Those strings can expose internal column names,
 * constraint identifiers, DB hosts, and stack-ish detail. Instead:
 *
 *   - The CLIENT receives a GENERIC message + a stable machine `code`.
 *   - The raw detail is logged SERVER-SIDE only (via the project `logger`).
 *
 * Pattern reference: src/app/api/v1/agents/[slug]/invoke-agent/route.ts
 *
 * Usage:
 *   import { jsonError, jsonOk } from '@/lib/api/jsonError'
 *
 *   const { error } = await supabase.from('agents').update(...)
 *   if (error) {
 *     return jsonError('db_error', 'Failed to update agent', 500, { logDetail: error })
 *   }
 *
 *   return jsonOk(data, 201)
 */
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

interface JsonErrorOpts {
  /** Raw detail (Supabase error, caught exception, etc.) — logged server-side, never returned to the client. */
  logDetail?: unknown
  /** Extra response headers (e.g. CORS) to attach to the error response. */
  headers?: HeadersInit
}

/**
 * Build an error response with a client-safe generic `message` and a stable
 * machine-readable `code`. If `opts.logDetail` is provided, the raw detail is
 * logged server-side via `logger.error` (never sent to the client).
 */
export function jsonError(
  code: string,
  message: string,
  status: number,
  opts?: JsonErrorOpts,
): NextResponse {
  if (opts?.logDetail !== undefined) {
    logger.error(`[api] ${code}`, { detail: opts.logDetail, status })
  }
  return NextResponse.json(
    { error: message, code },
    { status, ...(opts?.headers ? { headers: opts.headers } : {}) },
  )
}

/**
 * Build a success response with a consistent shape. Optional, for routes that
 * want a uniform envelope; existing routes returning bare payloads are fine.
 */
export function jsonOk<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, ...(headers ? { headers } : {}) })
}
