import createIntlMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { routing } from '@/i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

function extractLocaleFromPath(pathname: string): string | null {
  const segments = pathname.split('/')
  const possibleLocale = segments[1]
  if (routing.locales.includes(possibleLocale as typeof routing.locales[number])) {
    return possibleLocale
  }
  return null
}

function stripLocale(pathname: string, locale: string): string {
  return pathname.replace(`/${locale}`, '') || '/'
}

export async function middleware(request: NextRequest) {
  // Step 1: Run next-intl middleware (handles locale detection + redirect)
  const intlResponse = intlMiddleware(request)

  // If intlMiddleware redirected (e.g., / → /en), return immediately
  if (intlResponse.status === 307 || intlResponse.status === 308) {
    return intlResponse
  }

  // Step 2: Run Supabase auth check on the intl response
  const response = intlResponse

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Must update BOTH request and response so token refresh propagates
          // through subsequent server reads in the same request cycle
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const locale = extractLocaleFromPath(pathname) ?? routing.defaultLocale
  const pathWithoutLocale = stripLocale(pathname, locale)

  // WAS-139: /creator/[username] es público — solo proteger rutas de gestión
  const isProtectedRoute =
    pathWithoutLocale.startsWith('/creator/dashboard') ||
    pathWithoutLocale.startsWith('/creator/agents') ||
    pathWithoutLocale.startsWith('/publish') ||
    pathWithoutLocale.startsWith('/agent-keys')

  const isAuthRoute = pathWithoutLocale.startsWith('/login') ||
    pathWithoutLocale.startsWith('/signup')

  if (isProtectedRoute && !user) {
    const redirectUrl = new URL(`/${locale}/login`, request.url)
    const redirectResponse = NextResponse.redirect(redirectUrl)

    response.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value, c)
    })

    return redirectResponse
  }

  if (isAuthRoute && user) {
    const redirectUrl = new URL(`/${locale}/creator/dashboard`, request.url)
    const redirectResponse = NextResponse.redirect(redirectUrl)

    response.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value, c)
    })

    return redirectResponse
  }

  // SEC-CSP: Generar nonce por request para CSP sin unsafe-inline
  // Usa Web Crypto API (disponible en Edge Runtime — no depende de Node.js crypto)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = btoa(String.fromCharCode(...Array.from(nonceBytes)))
  const isDev = process.env.NODE_ENV === 'development'

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://api.avax.network https://api.avax-test.network https://facilitator.ultravioletadao.xyz wss://*.supabase.co",
    "frame-ancestors 'none'",
  ].join('; ')

  response.headers.set('x-nonce', nonce)
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    '/((?!api|trpc|_next|_vercel|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
