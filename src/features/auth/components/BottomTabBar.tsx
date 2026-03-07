'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useEffect, useRef, startTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearWalletState } from '@/lib/wallet-cleanup'
import { ActionSheet } from '@/features/auth/components/ActionSheet'
import { Package, GitBranch, KeyRound, User, BookOpen, Globe, LogOut, Sparkles } from 'lucide-react'

interface BottomTabBarProps {
  locale: string
  initialEmail?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function BottomTabBar({ locale: _locale, initialEmail = null }: BottomTabBarProps) {
  const pathname = usePathname()
  // Deriva el locale actual del pathname para evitar stale prop tras navegación client-side
  const locale = pathname.startsWith('/es') ? 'es' : 'en'
  const t = useTranslations('nav')
  const tMobile = useTranslations('mobileNav')

  const [createOpen, setCreateOpen] = useState(false)
  const [meOpen, setMeOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(initialEmail)
  const prevInitialEmailRef = useRef(initialEmail)

  // Sincronizar prop → state en render (evita react-hooks/set-state-in-effect)
  if (initialEmail !== prevInitialEmailRef.current) {
    prevInitialEmailRef.current = initialEmail
    setUserEmail(initialEmail ?? null)
  }

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      startTransition(() => setUserEmail(session?.user?.email ?? null))
    })
    return () => subscription?.unsubscribe()
  }, [])

  async function handleSignout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    clearWalletState()
    window.location.href = `/${locale}/login`
  }

  const isLoggedIn = !!userEmail

  function isActive(pattern: string): boolean {
    if (pattern === 'explore') {
      return pathname === `/${locale}` || pathname === `/${locale}/`
    }
    if (pattern === 'sandbox') {
      return pathname.startsWith(`/${locale}/sandbox`)
    }
    return false
  }

  const currentLang = locale === 'en' ? 'ES' : 'EN'

  const createItems = isLoggedIn
    ? [
        { icon: <Package  size={18} />, label: t('publishAgent'), href: `/${locale}/publish` },
        { icon: <GitBranch size={18} />, label: t('pipelines'),   href: `/${locale}/pipelines` },
        { icon: <KeyRound  size={18} />, label: t('agentKeys'),   href: `/${locale}/agent-keys` },
      ]
    : [
        { icon: <KeyRound size={18} />, label: t('login'), href: `/${locale}/login` },
      ]

  const meItems = isLoggedIn
    ? [
        { icon: <User     size={18} />, label: t('profile'), href: `/${locale}/profile` },
        { icon: <BookOpen size={18} />, label: t('docs'),    href: `/${locale}/docs` },
        {
          icon: <Globe size={18} />,
          label: `${currentLang}`,
          href: `/${locale === 'en' ? 'es' : 'en'}${pathname.replace(new RegExp(`^/${locale}`), '')}`,
        },
        { icon: <LogOut size={18} />, label: t('signout'), onClick: handleSignout, danger: true },
      ]
    : [
        { icon: <KeyRound  size={18} />, label: t('login'),  href: `/${locale}/login` },
        { icon: <Sparkles  size={18} />, label: t('signup'), href: `/${locale}/signup` },
      ]

  return (
    <>
      <ActionSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        items={createItems}
        title={t('create')}
      />
      <ActionSheet
        open={meOpen}
        onClose={() => setMeOpen(false)}
        items={meItems}
        title={isLoggedIn ? (userEmail ?? undefined) : undefined}
      />

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 sm:hidden border-t border-gray-200 bg-white"
        aria-label="Navegación principal mobile"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch justify-around px-1 pt-1 pb-1">
          {/* Explore */}
          <Link
            href={`/${locale}`}
            className={`flex flex-col items-center gap-0.5 py-1.5 px-3 text-[10px] font-medium transition-colors ${
              isActive('explore') ? 'text-[#E84142]' : 'text-gray-500'
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            {tMobile('explore')}
          </Link>

          {/* Sandbox */}
          <Link
            href={`/${locale}/sandbox`}
            className={`flex flex-col items-center gap-0.5 py-1.5 px-3 text-[10px] font-medium transition-colors ${
              isActive('sandbox') ? 'text-[#E84142]' : 'text-gray-500'
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21a48.309 48.309 0 0 1-8.135-1.587c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            {tMobile('sandbox')}
          </Link>

          {/* Crear — FAB */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label={tMobile('create')}
            className="relative -mt-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#E84142] text-white shadow-lg"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>

          {/* Dashboard */}
          <Link
            href={`/${locale}/creator/dashboard`}
            className={`flex flex-col items-center gap-0.5 py-1.5 px-3 text-[10px] font-medium transition-colors ${
              pathname.startsWith(`/${locale}/creator/dashboard`) ? 'text-[#E84142]' : 'text-gray-500'
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
            {tMobile('dashboard')}
          </Link>

          {/* Yo */}
          <button
            type="button"
            onClick={() => setMeOpen(true)}
            aria-label={tMobile('me')}
            className="flex flex-col items-center gap-0.5 py-1.5 px-3 text-[10px] font-medium text-gray-500 transition-colors hover:text-[#E84142]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            {tMobile('me')}
          </button>
        </div>
      </nav>
    </>
  )
}
