// src/components/MobileBottomNav.tsx
// HU-MOBILE-NAV: Bottom navigation bar — visible solo en mobile (< 640px)
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useEffect } from 'react'
import type { UserRole } from '@/hooks/useUserRole'

interface MobileBottomNavProps {
  locale: string
  userRole: UserRole  // viene del server layout — sin fetch en cliente
}

export function MobileBottomNav({ locale, userRole }: MobileBottomNavProps) {
  const pathname = usePathname()
  const t = useTranslations('mobileNav')

  // WAS-54/WAS-65: Track hash client-only — never read during SSR to avoid hydration mismatch
  const [mountedHash, setMountedHash] = useState<{ ready: boolean; value: string }>({ ready: false, value: '' })

  useEffect(() => {
    const update = () => setMountedHash({ ready: true, value: window.location.hash })
    update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  const mounted = mountedHash.ready
  const hash = mountedHash.value

  // Destinos condicionales por rol (prop desde SSR — sin flash)
  const dashboardHref =
    userRole === 'creator'  ? `/${locale}/creator/dashboard` :
    userRole === 'consumer' ? `/${locale}/dashboard` :
                              `/${locale}/login`

  // WAS-57: profileHref → /profile (página dedicada con wallet, agent keys, docs, idioma, auth)
  // Ya no es un alias del dashboard — tiene su propio destino real
  const profileHref = `/${locale}/profile`

  const isExploreHash = hash === '#agents'

  // Tab activo por pathname + hash
  function isActive(href: string): boolean {
    // WAS-65: antes del mount, ningún tab de hash está activo — evita hydration mismatch
    if (!mounted) {
      if (href.includes('#agents')) return false
      if (href === `/${locale}` || href === `/${locale}/`) {
        return pathname === `/${locale}` || pathname === `/${locale}/`
      }
      return pathname.startsWith(href.split('?')[0].split('#')[0])
    }
    if (href.includes('#agents')) {
      // WAS-54: Explorar activo cuando el hash es #agents
      return pathname === `/${locale}` && isExploreHash
    }
    if (href === `/${locale}` || href === `/${locale}/`) {
      // WAS-54: Home activo solo cuando en / SIN el hash #agents
      return (pathname === `/${locale}` || pathname === `/${locale}/`) && !isExploreHash
    }
    return pathname.startsWith(href.split('?')[0].split('#')[0])
  }

  // WAS-new: limpiar hash al navegar a Home para que isActive() no confunda Home con Explorar
  function handleHomeClick() {
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname)
      setMountedHash({ ready: true, value: '' })
    }
  }

  const tabs = [
    {
      key: 'home',
      label: t('home'),
      href: `/${locale}`,
      isFAB: false,
      onClick: handleHomeClick,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
    },
    {
      key: 'explore',
      onClick: undefined,
      label: t('explore'),
      href: `/${locale}#agents`,
      isFAB: false,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      ),
    },
    {
      key: 'publish',
      onClick: undefined,
      label: t('publish'),
      href: `/${locale}/publish`,
      isFAB: true,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      ),
    },
    {
      key: 'dashboard',
      onClick: undefined,
      label: t('dashboard'),
      href: dashboardHref,
      isFAB: false,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
    },
    {
      key: 'profile',
      onClick: undefined,
      label: t('profile'),
      href: profileHref,
      isFAB: false,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      ),
    },
  ]

  return (
    // sm:hidden → invisible en desktop ≥ 640px
    // fixed bottom-0 → anclado al borde inferior
    // z-50 → sobre el contenido principal
    // paddingBottom → env(safe-area-inset-bottom) para notch iOS
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800"
      aria-label="Navegación principal mobile"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-end justify-around px-2 pt-1 pb-1">
        {tabs.map((tab) => {
          const active = isActive(tab.href)
          const color  = active ? 'text-[#E84142]' : 'text-gray-500 dark:text-gray-400'

          if (tab.isFAB) {
            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-label={tab.label}
                className="relative -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#E84142] shadow-lg text-white z-50 shrink-0"
              >
                {tab.icon}
              </Link>
            )
          }

          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-label={tab.label}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 min-w-0 ${color} transition-colors`}
              onClick={tab.onClick}
            >
              {tab.icon}
              <span className="text-[10px] font-medium truncate">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
