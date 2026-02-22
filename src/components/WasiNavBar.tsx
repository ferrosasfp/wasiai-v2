'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV_PATHS = [
  { path: '',                   label: 'Marketplace' },
  { path: '/publish',           label: 'Publish'     },
  { path: '/creator/dashboard', label: 'Dashboard'   },
  { path: '/agent-keys',        label: 'Agent Keys'  },
]

export function WasiNavBar() {
  const pathname = usePathname()
  // Extract locale from pathname (e.g. /en/publish → 'en')
  const locale = pathname.split('/')[1] || 'en'
  const NAV_LINKS = NAV_PATHS.map(({ path, label }) => ({
    href: `/${locale}${path}`,
    label,
  }))
  const [menuOpen,  setMenuOpen]  = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null)
      setLoading(false)
    })
  }, [])

  async function handleSignout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/en/login'
  }

  function isActive(href: string) {
    if (href === `/${locale}`) return pathname === `/${locale}` || pathname === `/${locale}/`
    return pathname.startsWith(href)
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">

          {/* Logo */}
          <Link
            href="/en"
            className="flex items-center gap-2 text-lg font-extrabold text-gray-900 shrink-0"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">W</span>
            WasiAI
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-1 sm:flex flex-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-indigo-50 text-indigo-600'
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
              <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
            ) : userEmail ? (
              <>
                <span className="max-w-[160px] truncate text-xs text-gray-500">{userEmail}</span>
                <button
                  onClick={handleSignout}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/en/login"
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 transition"
                >
                  Log in
                </Link>
                <Link
                  href="/en/signup"
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
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
            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-50 sm:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-gray-100 sm:hidden">
          <div className="space-y-1 px-4 py-3">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(href)
                    ? 'bg-indigo-50 text-indigo-600'
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
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <Link
                    href="/en/login"
                    className="flex-1 rounded-lg border border-gray-200 py-2 text-center text-sm font-medium text-gray-700"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/en/signup"
                    className="flex-1 rounded-lg bg-indigo-600 py-2 text-center text-sm font-semibold text-white"
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
