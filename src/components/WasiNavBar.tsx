'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ApiKeyBalance } from '@/features/layout/components/ApiKeyBalance'
import { WalletConnectButton } from '@/features/payments/components/WalletConnectButton'

const NAV_PATHS = [
  { path: '',                   tKey: 'marketplace' as const },
  { path: '/publish',           tKey: 'publish' as const,     label: undefined     },
  { path: '/creator/dashboard', tKey: 'dashboard' as const   },
  { path: '/agent-keys',        tKey: 'agentKeys' as const,   label: undefined     },
  { path: '/docs',              tKey: 'docs' as const        },
]

interface WasiNavBarProps {
  initialEmail?: string | null
}

export function WasiNavBar({ initialEmail = null }: WasiNavBarProps) {
  const pathname = usePathname()
  // Extract locale from pathname (e.g. /en/publish → 'en')
  const locale = pathname.split('/')[1] || 'en'

  const tNav  = useTranslations('nav')
  const tAuth = useTranslations('auth')

  // P-08: Memoize NAV_LINKS — only recomputes when locale changes
  // tNav is stable per locale (next-intl guarantees it), so [locale] is the correct dep.
  const NAV_LINKS = useMemo(() =>
    NAV_PATHS.map(({ path, tKey, label }) => ({
      href: `/${locale}${path}`,
      label: tKey ? tNav(tKey) : (label ?? ''),
    })),
    [locale, tNav]
  )

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
      aria-label={tNav('mainNavLabel')}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">

          {/* Logo */}
          {/* T-18: Use locale-aware path instead of hardcoded /en */}
          <Link
            href={`/${locale}`}
            aria-label={tNav('homeLabel')}
            className="flex items-center gap-2 shrink-0"
          >
            {/* Icon mark — outer house (territory) + inner agent network (house within house) */}
            <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="48" height="48" rx="11" fill="#E84142"/>
              {/* Outer house — the home/territory */}
              <path d="M5 27 L24 7 L43 27 L43 46 L5 46 Z" fill="white" fillOpacity="0.12" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
              {/* Network lines — agents connecting */}
              <g stroke="white" strokeLinecap="round" opacity={0.5}>
                <line x1="24" y1="17" x2="14" y2="27" strokeWidth="1"/>
                <line x1="24" y1="17" x2="34" y2="27" strokeWidth="1"/>
                <line x1="14" y1="27" x2="34" y2="27" strokeWidth="1"/>
                <line x1="24" y1="17" x2="24" y2="39" strokeWidth="1"/>
                <line x1="14" y1="27" x2="15" y2="39" strokeWidth="1"/>
                <line x1="34" y1="27" x2="33" y2="39" strokeWidth="1"/>
                <line x1="15" y1="39" x2="33" y2="39" strokeWidth="1"/>
              </g>
              {/* Agent nodes */}
              <circle cx="24" cy="17" r="3.2" fill="white"/>
              <circle cx="14" cy="27" r="2.2" fill="white" opacity={0.9}/>
              <circle cx="34" cy="27" r="2.2" fill="white" opacity={0.9}/>
              <circle cx="15" cy="39" r="1.7" fill="white" opacity={0.7}/>
              <circle cx="33" cy="39" r="1.7" fill="white" opacity={0.7}/>
              <circle cx="24" cy="39" r="1.4" fill="white" opacity={0.5}/>
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

          {/* Language switcher — desktop */}
          <div className="hidden sm:flex shrink-0">
            <LanguageSwitcher />
          </div>

          {/* API Key Balance — solo si hay sesión (desktop) */}
          {userEmail && (
            <div className="hidden sm:flex shrink-0">
              <ApiKeyBalance enabled={!!userEmail} locale={locale} />
            </div>
          )}

          {/* Wallet connect — desktop */}
          <div className="hidden sm:flex shrink-0">
            <WalletConnectButton locale={locale} />
          </div>

          {/* Auth actions */}
          <div className="hidden items-center gap-3 sm:flex shrink-0">
            {loading ? (
              <div className="h-4 w-24 animate-pulse rounded bg-gray-100" aria-label={tNav('loadingUser')} />
            ) : userEmail ? (
              <>
                <span className="max-w-[160px] truncate text-xs text-gray-500" title={userEmail}>{userEmail}</span>
                <button
                  onClick={handleSignout}
                  aria-label={tNav('signOutLabel')}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                >
                  {tAuth('signout')}
                </button>
              </>
            ) : (
              <>
                {/* T-18: Locale-aware login/signup links */}
                <Link
                  href={`/${locale}/login`}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 transition"
                >
                  {tAuth('login')}
                </Link>
                <Link
                  href={`/${locale}/signup`}
                  className="rounded-lg bg-avax-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
                >
                  {tAuth('signup')}
                </Link>
              </>
            )}
          </div>

          {/* Mobile: WalletConnectButton — solo visible en mobile (sm:hidden) */}
          {/* HU-MOBILE-NAV: Header mobile muestra solo logo + WalletConnectButton */}
          <div className="flex items-center gap-2 sm:hidden">
            <WalletConnectButton locale={locale} />
          </div>


        </div>
      </div>


    </nav>
  )
}
