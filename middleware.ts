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
  const { pathname } = request.nextUrl

  // NG-010: Security headers para todas las API routes (sin interferir con su auth propia)
  if (pathname.startsWith('/api/') || pathname.startsWith('/trpc/')) {
    const apiResponse = NextResponse.next()
    apiResponse.headers.set('X-Content-Type-Options', 'nosniff')
    apiResponse.headers.set('X-Frame-Options', 'DENY')
    apiResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    apiResponse.headers.set('X-DNS-Prefetch-Control', 'off')
    apiResponse.headers.delete('X-Powered-By')
    return apiResponse
  }

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

  const routePathname = request.nextUrl.pathname
  const locale = extractLocaleFromPath(routePathname) ?? routing.defaultLocale
  const pathWithoutLocale = stripLocale(routePathname, locale)

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
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''} https://embedded-wallet.thirdweb.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://api.avax.network https://api.avax-test.network https://facilitator.ultravioletadao.xyz wss://*.supabase.co https://*.thirdweb.com wss://*.thirdweb.com",
    "frame-src 'self' https://*.thirdweb.com",
    "frame-ancestors 'none'",
  ].join('; ')

  response.headers.set('x-nonce', nonce)
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    // NG-010: Incluir api/ y trpc/ para aplicar security headers (excluir solo _next y archivos estáticos)
    '/((?!_next|_vercel|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
