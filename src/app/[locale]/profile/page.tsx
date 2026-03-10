/**
 * /[locale]/profile — Página de perfil de usuario
 *
 * WAS-57: Destino real del tab Perfil en mobile bottom nav
 * WAS-59: Links a Agent Keys y Docs (inaccesibles en mobile sin drawer)
 * WAS-60: Language Switcher EN/ES
 * WAS-61: Wallet connect/disconnect
 * WAS-62: Login/Logout
 *
 * Esta página reemplaza el drawer hamburguesa eliminado en HU-MOBILE-NAV.
 * Accesible desde el tab "Perfil" en mobile — también funciona en desktop.
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ensureCreatorProfile } from '@/lib/ensureCreatorProfile'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { WalletConnectButton } from '@/features/payments/components/WalletConnectButton'
import { ProfileSignOut } from './_components/ProfileSignOut'
import { getTranslations } from 'next-intl/server'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('profile')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Para usuarios no autenticados mostramos la página igual
  // (con opciones de login en vez de logout)

  // HU-069: Ensure creator_profile exists
  if (user) await ensureCreatorProfile(supabase, user)

  // Obtener perfil del creator si existe
  let creatorProfile: { wallet_address: string | null; username: string | null } | null = null
  if (user) {
    const { data } = await supabase
      .from('creator_profiles')
      .select('wallet_address, username')
      .eq('id', user.id)
      .maybeSingle()
    creatorProfile = data ?? null
  }

  // Iniciales para el avatar
  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '?'

  // Determinar dashboard href según rol
  const isCreator = !!creatorProfile
  const dashboardHref = isCreator
    ? `/${locale}/creator/dashboard`
    : `/${locale}/dashboard`

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <div className="mx-auto max-w-lg px-4 py-8 space-y-5">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Avatar con iniciales */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#E84142] text-white text-xl font-bold select-none">
            {initials}
          </div>
          <div className="min-w-0">
            {user ? (
              <>
                <p className="truncate font-semibold text-gray-900">
                  {creatorProfile?.username ?? user.email?.split('@')[0] ?? '—'}
                </p>
                <p className="truncate text-sm text-gray-500">{user.email}</p>
              </>
            ) : (
              <p className="font-semibold text-gray-900">{t('guest')}</p>
            )}
          </div>
        </div>

        {/* ── Wallet (WAS-61) ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('wallet')}</h2>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <WalletConnectButton locale={locale} />
            {creatorProfile?.wallet_address && (
              <p className="text-xs text-gray-400 font-mono truncate">
                {creatorProfile.wallet_address.slice(0, 8)}…{creatorProfile.wallet_address.slice(-6)}
              </p>
            )}
          </div>
        </section>

        {/* ── Navegación (WAS-59) ─────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Navegación
          </h2>
          <nav className="divide-y divide-gray-50">
            {user && (
              <NavLink
                href={dashboardHref}
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                  </svg>
                }
                label="Dashboard"
              />
            )}
            <NavLink
              href={`/${locale}`}
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
              }
              label="Marketplace"
            />
            {user && (
              <NavLink
                href={`/${locale}/agent-keys`}
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
                  </svg>
                }
                label="Agent Keys"
                badge="API"
              />
            )}
            <NavLink
              href={`/${locale}/docs`}
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              }
              label="Documentación"
            />
            {user && isCreator && (
              <NavLink
                href={`/${locale}/publish`}
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                }
                label={t('publishAgent')}
              />
            )}
          </nav>
        </section>

        {/* ── Idioma (WAS-60) ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Idioma / Language</h2>
          <LanguageSwitcher />
        </section>

        {/* ── Auth (WAS-62) ───────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('account')}</h2>
          {user ? (
            <ProfileSignOut locale={locale} />
          ) : (
            <div className="flex flex-col gap-2">
              <Link
                href={`/${locale}/login`}
                className="flex items-center justify-center rounded-xl bg-[#E84142] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c73535] transition"
              >
                {t('signIn')}
              </Link>
              <Link
                href={`/${locale}/signup`}
                className="flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                {t('createAccount')}
              </Link>
            </div>
          )}
        </section>

      </div>
    </main>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function NavLink({
  href,
  icon,
  label,
  badge,
}: {
  href: string
  icon: React.ReactNode
  label: string
  badge?: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors"
    >
      <span className="text-gray-400 shrink-0">{icon}</span>
      <span className="flex-1 text-sm font-medium text-gray-800">{label}</span>
      {badge && (
        <span className="rounded-full bg-[#E84142]/10 px-2 py-0.5 text-[10px] font-semibold text-[#E84142]">
          {badge}
        </span>
      )}
      <svg className="h-4 w-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  )
}
