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
  userRole: UserRole
}

export function MobileBottomNav({ locale, userRole }: MobileBottomNavProps) {
  const pathname = usePathname()
  const t = useTranslations('mobileNav')

  // Estado activo explícito — no depende del hash de la URL
  // 'home' | 'explore' | null (null = otro tab activo por pathname)
  const [homeSection, setHomeSection] = useState<'home' | 'explore' | null>(null)

  // Al montar: determinar sección inicial por hash actual
  useEffect(() => {
    const isHomePath = pathname === `/${locale}` || pathname === `/${locale}/`
    if (isHomePath) {
      setHomeSection(window.location.hash === '#agents' ? 'explore' : 'home')
    } else {
      setHomeSection(null)
    }
  }, [pathname, locale])

  const dashboardHref =
    userRole === 'creator'  ? `/${locale}/creator/dashboard` :
    userRole === 'consumer' ? `/${locale}/dashboard` :
                              `/${locale}/login`

  const profileHref = `/${locale}/profile`

  const isHomePath = pathname === `/${locale}` || pathname === `/${locale}/`

  function isActive(key: string): boolean {
    switch (key) {
      case 'home':
        // Activo si estamos en / Y la sección seleccionada es home
        return isHomePath && homeSection === 'home'
      case 'explore':
        // Activo si estamos en / Y la sección seleccionada es explore
        return isHomePath && homeSection === 'explore'
      case 'dashboard':
        return pathname.startsWith(`/${locale}/creator/dashboard`) ||
               pathname.startsWith(`/${locale}/dashboard`)
      case 'profile':
        return pathname.startsWith(`/${locale}/profile`)
      default:
        return false
    }
  }

  const tabs = [
    {
      key: 'home',
      label: t('home'),
      href: `/${locale}`,
      isFAB: false,
      onClick: () => {
        // Limpiar hash y marcar home como activo
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `/${locale}`)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
        setHomeSection('home')
      },
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
    },
    {
      key: 'explore',
      label: t('explore'),
      href: `/${locale}#agents`,
      isFAB: false,
      onClick: () => {
        setHomeSection('explore')
      },
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      ),
    },
    {
      key: 'publish',
      label: t('publish'),
      href: `/${locale}/publish`,
      isFAB: true,
      onClick: undefined,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      ),
    },
    {
      key: 'dashboard',
      label: t('dashboard'),
      href: dashboardHref,
      isFAB: false,
      onClick: () => setHomeSection(null),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
    },
    {
      key: 'profile',
      label: t('profile'),
      href: profileHref,
      isFAB: false,
      onClick: () => setHomeSection(null),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      ),
    },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800"
      aria-label="Navegación principal mobile"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-end justify-around px-2 pt-1 pb-1">
        {tabs.map((tab) => {
          const active = isActive(tab.key)
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
              onClick={tab.onClick}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 min-w-0 ${color} transition-colors`}
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
