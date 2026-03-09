/**
 * constants.ts — ARCH-002: Shared constants to avoid duplication across API routes
 */

/** Public site URL, used in all API routes for building absolute URLs */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io').trim().replace(/\/$/, '')
