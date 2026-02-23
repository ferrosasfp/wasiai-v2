import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * Auth-aware client for Server Components / RSC.
 * Uses anon key + cookie-based session → RLS applies based on user session.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // T-06: Empty catch is intentional — setAll throws in Server Components
            // (read-only cookie store), but cookies set in middleware still work.
            // See: https://supabase.com/docs/guides/auth/server-side/nextjs
          }
        },
      },
    }
  )
}

/**
 * Service-role client for API routes that need to bypass RLS.
 * Use for: logging calls, writing agent stats, server-side writes.
 * Never expose to the client.
 */
export function createServiceClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service client')
  }
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
  )
}
