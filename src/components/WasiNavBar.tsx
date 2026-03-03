'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ApiKeyBalance } from '@/features/layout/components/ApiKeyBalance'
import { WalletConnectButton } from '@/features/payments/components/WalletConnectButton'

interface WasiNavBarProps {
  initialEmail?: string | null
}

export function WasiNavBar({ initialEmail = null }: WasiNavBarProps) {
  const pathname = usePathname()
  const locale = pathname.split('/')[1] || 'en'

  const tNav  = useTranslations('nav')
  const tAuth = useTranslations('auth')

  const [userEmail, setUserEmail] = useState<string | null>(initialEmail)
  const [loading, setLoading]     = useState(initialEmail === null)
  const [createOpen, setCreateOpen] = useState(false)
  const [meOpen, setMeOpen]         = useState(false)

  const createRef = useRef<HTMLDivElement>(null)
  const meRef     = useRef<HTMLDivElement>(null)

  const initialEmailRef = useRef(initialEmail)

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' && initialEmailRef.current !== null) {
        setLoading(false)
        return
      }
      setUserEmail(session?.user?.email ?? null)
      setLoading(false)
    })
    return () => subscription?.unsubscribe()
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false)
      }
      if (meRef.current && !meRef.current.contains(e.target as Node)) {
        setMeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSignout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = `/${locale}/login`
  }

  function isActive(path: string) {
    const href = `/${locale}${path}`
    if (path === '') return pathname === `/${locale}` || pathname === `/${locale}/`
    return pathname.startsWith(href)
  }

  const isLoggedIn = !!userEmail

  const primaryLinks = [
    { path: '',         label: tNav('marketplace') },
  ]

  const secondaryLinks = [
    { path: '/sandbox', label: tNav('sandbox')     },
    { path: '/docs',    label: tNav('docs')        },
  ]

  const createItems = [
    { icon: '📦', label: tNav('publishAgent'),  href: `/${locale}/publish`            },
    { icon: '📊', label: tNav('myDashboard'),   href: `/${locale}/creator/dashboard`  },
    { icon: '🔗', label: tNav('pipelines'),     href: `/${locale}/pipelines`          },
    { icon: '🔑', label: tNav('agentKeys'),     href: `/${locale}/agent-keys`         },
  ]

  return (
    <nav
      className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm"
      aria-label={tNav('mainNavLabel')}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">

          {/* Logo */}
          <Link
            href={`/${locale}`}
            aria-label={tNav('homeLabel')}
            className="flex items-center gap-2 shrink-0"
          >
            <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="48" height="48" rx="11" fill="#E84142"/>
              <path d="M5 27 L24 7 L43 27 L43 46 L5 46 Z" fill="white" fillOpacity="0.12" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
              <g stroke="white" strokeLinecap="round" opacity={0.5}>
                <line x1="24" y1="17" x2="14" y2="27" strokeWidth="1"/>
                <line x1="24" y1="17" x2="34" y2="27" strokeWidth="1"/>
                <line x1="14" y1="27" x2="34" y2="27" strokeWidth="1"/>
                <line x1="24" y1="17" x2="24" y2="39" strokeWidth="1"/>
                <line x1="14" y1="27" x2="15" y2="39" strokeWidth="1"/>
                <line x1="34" y1="27" x2="33" y2="39" strokeWidth="1"/>
                <line x1="15" y1="39" x2="33" y2="39" strokeWidth="1"/>
              </g>
              <circle cx="24" cy="17" r="3.2" fill="white"/>
              <circle cx="14" cy="27" r="2.2" fill="white" opacity={0.9}/>
              <circle cx="34" cy="27" r="2.2" fill="white" opacity={0.9}/>
              <circle cx="15" cy="39" r="1.7" fill="white" opacity={0.7}/>
              <circle cx="33" cy="39" r="1.7" fill="white" opacity={0.7}/>
              <circle cx="24" cy="39" r="1.4" fill="white" opacity={0.5}/>
            </svg>
            <span className="text-lg font-extrabold tracking-tight text-gray-900">
              Wasi<span className="text-avax-500">AI</span>
            </span>
          </Link>

          {/* Desktop nav — primary links */}
          <div className="hidden items-center gap-1 sm:flex flex-1" role="list">
            {primaryLinks.map(({ path, label }) => (
              <Link
                key={path}
                href={`/${locale}${path}`}
                role="listitem"
                aria-current={isActive(path) ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(path)
                    ? 'bg-avax-50 text-avax-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {label}
              </Link>
            ))}

            {/* Dropdown: Crear — justo después de Marketplace */}
            {isLoggedIn && (
              <div ref={createRef} className="relative">
                <button
                  type="button"
                  onClick={() => { setCreateOpen(o => !o); setMeOpen(false) }}
                  className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    createOpen ? 'bg-avax-50 text-avax-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {tNav('create')}
                  <svg className={`h-3.5 w-3.5 transition-transform ${createOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {createOpen && (
                  <div className="absolute left-0 top-full mt-1 w-52 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-50">
                    {createItems.map(item => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setCreateOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <span>{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Secondary links — Sandbox, Docs */}
            {secondaryLinks.map(({ path, label }) => (
              <Link
                key={path}
                href={`/${locale}${path}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(path)
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

          {/* ApiKeyBalance */}
          <div className="hidden sm:flex shrink-0">
            <ApiKeyBalance enabled={!!userEmail} locale={locale} />
          </div>

          {/* Wallet connect */}
          <div className="hidden sm:flex shrink-0">
            <WalletConnectButton locale={locale} />
          </div>

          {/* Auth section: Yo dropdown or login/signup */}
          <div className="hidden items-center gap-2 sm:flex shrink-0">
            {loading ? (
              <div className="h-4 w-24 animate-pulse rounded bg-gray-100" aria-label={tNav('loadingUser')} />
            ) : isLoggedIn ? (
              <div ref={meRef} className="relative">
                <button
                  type="button"
                  onClick={() => { setMeOpen(o => !o); setCreateOpen(false) }}
                  className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium transition-colors ${
                    meOpen ? 'bg-gray-50 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                  {tNav('me')}
                  <svg className={`h-3.5 w-3.5 transition-transform ${meOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {meOpen && (
                  <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-50">
                    {/* Email */}
                    <div className="border-b border-gray-100 px-4 py-2.5">
                      <p className="truncate text-xs text-gray-400" title={userEmail ?? ''}>{userEmail}</p>
                    </div>

                    <Link href={`/${locale}/profile`}    onClick={() => setMeOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"><span>👤</span>{tNav('profile')}</Link>
                    <Link href={`/${locale}/creator/dashboard`} onClick={() => setMeOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"><span>💰</span>{tNav('wallet')}</Link>
                    <Link href={`/${locale}/storage`}    onClick={() => setMeOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"><span>📦</span>{tNav('storage')}</Link>

                    {/* Language switcher inline */}
                    <div className="flex items-center gap-2.5 border-t border-gray-100 px-4 py-2.5">
                      <span>🌐</span>
                      <LanguageSwitcher />
                    </div>

                    {/* Sign out */}
                    <div className="border-t border-gray-100 px-4 py-2">
                      <button
                        type="button"
                        onClick={() => { setMeOpen(false); handleSignout() }}
                        aria-label={tNav('signOutLabel')}
                        className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        {tAuth('signout')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link href={`/${locale}/login`}  className="text-sm font-medium text-gray-600 hover:text-gray-900 transition">{tAuth('login')}</Link>
                <Link href={`/${locale}/signup`} className="rounded-lg bg-avax-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-avax-600 transition">{tAuth('signup')}</Link>
              </>
            )}
          </div>

          {/* Mobile: WalletConnectButton only */}
          <div className="flex items-center gap-2 sm:hidden">
            <WalletConnectButton locale={locale} />
          </div>

        </div>
      </div>
    </nav>
  )
}
