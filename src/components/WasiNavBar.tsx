'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV_PATHS = [
  { path: '',                   label: 'Marketplace' },
  { path: '/publish',           label: 'Publish'     },
  { path: '/creator/dashboard', label: 'Dashboard'   },
  { path: '/agent-keys',        label: 'Agent Keys'  },
]

interface WasiNavBarProps {
  initialEmail?: string | null
}

export function WasiNavBar({ initialEmail = null }: WasiNavBarProps) {
  const pathname = usePathname()
  // Extract locale from pathname (e.g. /en/publish → 'en')
  const locale = pathname.split('/')[1] || 'en'

  // P-08: Memoize NAV_LINKS — only recomputes when locale changes
  const NAV_LINKS = useMemo(
    () => NAV_PATHS.map(({ path, label }) => ({ href: `/${locale}${path}`, label })),
    [locale],
  )

  const [menuOpen,  setMenuOpen]  = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(initialEmail)
  // No loading state if we already have the email from the server
  const [loading,   setLoading]   = useState(initialEmail === null)

  useEffect(() => {
    const supabase = createClient()

    // Only subscribe to future auth changes (login/logout/token refresh)
    // Initial state already comes from the server via initialEmail prop
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null)
      setLoading(false)
    })

    // T-33: Guard against null subscription before unsubscribing
    return () => subscription?.unsubscribe()
  }, [])

  async function handleSignout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // T-18: Use locale-aware redirect instead of hardcoded /en/login
    window.location.href = `/${locale}/login`
  }

  function isActive(href: string) {
    if (href === `/${locale}`) return pathname === `/${locale}` || pathname === `/${locale}/`
    return pathname.startsWith(href)
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm"
      aria-label="Main navigation"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">

          {/* Logo */}
          {/* T-18: Use locale-aware path instead of hardcoded /en */}
          <Link
            href={`/${locale}`}
            aria-label="WasiAI — go to homepage"
            className="flex items-center gap-2 shrink-0"
          >
            {/* Icon mark — house with double gable (W = Wasi) + AI nodes */}
            <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="48" height="48" rx="12" fill="#E84142"/>
              <rect x="7" y="27" width="34" height="16" rx="1.5" fill="white"/>
              <rect x="19" y="31" width="10" height="12" rx="2" fill="#E84142"/>
              <polyline points="3,27 13,10 24,20 35,10 45,27" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="13" cy="10" r="2.8" fill="white"/>
              <circle cx="35" cy="10" r="2.8" fill="white"/>
              <circle cx="24" cy="20" r="2"   fill="rgba(255,255,255,0.7)"/>
              <circle cx="3"  cy="27" r="1.6" fill="rgba(255,255,255,0.45)"/>
              <circle cx="45" cy="27" r="1.6" fill="rgba(255,255,255,0.45)"/>
            </svg>
            {/* Wordmark */}
            <span className="text-lg font-extrabold tracking-tight text-gray-900">
              Wasi<span className="text-avax-500">AI</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-1 sm:flex flex-1" role="list">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                role="listitem"
                aria-current={isActive(href) ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-avax-50 text-avax-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Auth actions */}
          <div className="hidden items-center gap-3 sm:flex shrink-0">
            {loading ? (
              <div className="h-4 w-24 animate-pulse rounded bg-gray-100" aria-label="Loading user..." />
            ) : userEmail ? (
              <>
                <span className="max-w-[160px] truncate text-xs text-gray-500" title={userEmail}>{userEmail}</span>
                <button
                  onClick={handleSignout}
                  aria-label="Sign out of your account"
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                {/* T-18: Locale-aware login/signup links */}
                <Link
                  href={`/${locale}/login`}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 transition"
                >
                  Log in
                </Link>
                <Link
                  href={`/${locale}/signup`}
                  className="rounded-lg bg-avax-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-50 sm:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div id="mobile-menu" className="border-t border-gray-100 sm:hidden">
          <div className="space-y-1 px-4 py-3">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive(href) ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(href)
                    ? 'bg-avax-50 text-avax-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </Link>
            ))}
            <div className="mt-3 border-t border-gray-100 pt-3">
              {userEmail ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 truncate max-w-[200px]">{userEmail}</span>
                  <button
                    onClick={handleSignout}
                    aria-label="Sign out of your account"
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  {/* T-18: Locale-aware mobile login/signup links */}
                  <Link
                    href={`/${locale}/login`}
                    className="flex-1 rounded-lg border border-gray-200 py-2 text-center text-sm font-medium text-gray-700"
                  >
                    Log in
                  </Link>
                  <Link
                    href={`/${locale}/signup`}
                    className="flex-1 rounded-lg bg-avax-500 py-2 text-center text-sm font-semibold text-white"
                  >
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
