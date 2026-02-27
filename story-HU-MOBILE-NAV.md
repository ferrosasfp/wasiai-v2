# Story — HU-MOBILE-NAV: Bottom Navigation Bar en Mobile
**Sprint:** 8 | 2026-03-07 → 2026-03-14
**Prioridad:** P0
**Estimación:** M — 3-5 horas
**Autor:** SM (Bob) — BMAD v6 — 2026-02-27

> **⚠️ Este archivo es 100% autocontenido. El Dev NO necesita leer ningún otro documento.**

---

## Historia de Usuario

> Como usuario de WasiAI navegando desde un teléfono, quiero una barra de navegación inferior fija con las 5 secciones principales del marketplace, para poder navegar con el pulgar sin tener que abrir un menú hamburguesa cada vez.

---

## Acceptance Criteria

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| **AC-1** | En viewport < 640px, aparece una barra inferior fija con 5 tabs: 🏠 Home (`/${locale}`), 🔍 Explorar (`/${locale}#agents`), ➕ FAB central (`/${locale}/publish`), 📊 Dashboard (condicional), 👤 Perfil (condicional) | DevTools 375px · screenshot |
| **AC-2** | El drawer hamburguesa y el mobile menu dropdown desaparecen en < 640px. El botón hamburguesa se oculta con clase `hidden`. | DevTools 375px: no debe existir `#mobile-menu` abierto ni el botón hamburguesa visible |
| **AC-3** | Header en mobile muestra ÚNICAMENTE: logo WasiAI (Link a `/`) + `WalletConnectButton`. Sin links de nav, sin LanguageSwitcher, sin email, sin hamburguesa. | DevTools 375px · screenshot |
| **AC-4** | El tab ➕ (Publicar) es un FAB: circular, elevado (`shadow-lg`), color `#E84142`, z-index 50, size ~56px (`h-14 w-14`), `-mt-5` para crear efecto "flotante". | Screenshot 375px |
| **AC-5** | Click en FAB ➕ → navega a `/${locale}/publish` | Prueba manual mobile |
| **AC-6** | Tab activo (según `usePathname()`): color `text-[#E84142]`. Tab inactivo: `text-gray-500 dark:text-gray-400` | Navegar entre tabs y verificar color |
| **AC-7** | La barra tiene `padding-bottom: env(safe-area-inset-bottom)` como inline style, con fallback en el `pb-1` para non-iOS. | Inspeccionar el elemento nav en DevTools |
| **AC-8** | El `<meta name="viewport">` en el root layout incluye `viewport-fit=cover`. Se logra exportando `export const viewport: Viewport` con `viewportFit: 'cover'` en `src/app/layout.tsx`. | Verificar el HTML renderizado: `<meta name="viewport" content="...viewport-fit=cover">` |
| **AC-9** | Tab Dashboard: creator → `/${locale}/creator/dashboard` \| consumer → `/${locale}/dashboard` \| no auth → `/${locale}/login` | Test manual con 3 estados de usuario |
| **AC-10** | Tab Perfil: mismo comportamiento que Dashboard (MVP: mismo destino) | Test manual con 3 estados de usuario |
| **AC-11** | Tab Explorar → `/${locale}#agents`. El `id="agents"` ya existe en `src/app/[locale]/page.tsx` — **no tocar ese archivo**. | Verificar que el scroll al anchor funciona |
| **AC-12** | En desktop ≥ 640px: la barra inferior NO aparece (`sm:hidden`). El navbar existente funciona sin cambios. | DevTools 1280px |
| **AC-13** | Traducciones en `es` y `en` para claves `mobileNav.home`, `mobileNav.explore`, `mobileNav.publish`, `mobileNav.dashboard`, `mobileNav.profile` | `grep -r "mobileNav" src/messages/` |
| **AC-14** | DevTools Network: al navegar entre tabs NO aparece ninguna request nueva a Supabase. El rol del usuario viene de SSR (prop drilling desde el layout). | Filtrar Network por "supabase" mientras se cambia de tab: 0 requests |
| **AC-15** | `npm run build` sin errores TypeScript | `npm run build` en la raíz del proyecto |

---

## 🚨 ORDEN DE IMPLEMENTACIÓN (CRÍTICO)

**El Dev DEBE seguir este orden exacto:**

### PASO 1 — `src/app/layout.tsx` (ROOT LAYOUT): Agregar `viewport-fit=cover`

**Este es el PRIMER paso. Sin él, `env(safe-area-inset-bottom)` retorna 0 en iOS y el safe area no funciona.**

```typescript
// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'

// ✅ NUEVO: exportar viewport separado de metadata (patrón Next.js 14)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',   // → genera viewport-fit=cover en el <meta>
}

export const metadata: Metadata = {
  // ... igual que antes, sin cambios en el contenido
  title: 'WasiAI — The marketplace for the agentic economy',
  // ...
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
```

> **Nota:** En Next.js 14 App Router, `viewport` se exporta **por separado** de `metadata`. Genera automáticamente `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. No agregar el meta tag a mano.

---

### PASO 2 — `src/app/[locale]/layout.tsx`: Leer role en servidor + pasar props

El rol del usuario se determina **en el server layout** con una query a `creator_profiles` (1 fila por PK — costo mínimo). El componente `MobileBottomNav` recibe `userRole` como prop estático. **Cero network requests en cliente.**

```typescript
// src/app/[locale]/layout.tsx
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { Web3Provider } from '@/shared/providers/Web3Provider'
import { WasiNavBar } from '@/components/WasiNavBar'
import { MobileBottomNav } from '@/components/MobileBottomNav'   // ← NUEVO
import { createClient } from '@/lib/supabase/server'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Determinar role en servidor — sin query extra visible en cliente
  // 1 query por PK a creator_profiles (index scan, < 1ms)
  let userRole: 'creator' | 'consumer' | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
    userRole = profile ? 'creator' : 'consumer'
  }

  return (
    <NextIntlClientProvider>
      <Web3Provider>
        <WasiNavBar initialEmail={user?.email ?? null} />
        {children}
        {/* NUEVO: Bottom Nav — sm:hidden lo oculta en desktop */}
        <MobileBottomNav locale={locale} userRole={userRole} />
      </Web3Provider>
    </NextIntlClientProvider>
  )
}
```

---

### PASO 3 — CREAR `src/hooks/useUserRole.ts`

Hook minimal. Solo existe para establecer el tipo `UserRole` reutilizable. En esta HU, el role viene como prop — el hook no hace fetch.

```typescript
// src/hooks/useUserRole.ts
export type UserRole = 'creator' | 'consumer' | null

/**
 * Hook wrapper para el tipo UserRole.
 * En HU-MOBILE-NAV, el role viene como prop desde SSR (no hace fetch).
 * Este hook es el lugar canónico para el tipo — para uso futuro.
 */
export function useUserRole(role: UserRole): UserRole {
  return role
}
```

---

### PASO 4 — CREAR `src/components/MobileBottomNav.tsx`

**Path del `WalletConnectButton`:** `@/features/payments/components/WalletConnectButton`
(NO `@/components/WalletConnectButton` — ese path no existe en el codebase)

```typescript
// src/components/MobileBottomNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { UserRole } from '@/hooks/useUserRole'

interface MobileBottomNavProps {
  locale: string
  userRole: UserRole  // viene del server layout — sin fetch
}

export function MobileBottomNav({ locale, userRole }: MobileBottomNavProps) {
  const pathname = usePathname()
  const t = useTranslations('mobileNav')

  // Destinos condicionales por rol (calculados en SSR, pero también se recalculan en cliente
  // porque userRole es un prop — son idénticos, sin flash)
  const dashboardHref =
    userRole === 'creator'  ? `/${locale}/creator/dashboard` :
    userRole === 'consumer' ? `/${locale}/dashboard` :
                              `/${locale}/login`

  const profileHref = dashboardHref  // MVP: mismo destino

  // Tab activo por pathname
  function isActive(href: string): boolean {
    if (href.includes('#')) return false  // Tab Explorar: nunca "activo" (es un anchor)
    if (href === `/${locale}` || href === `/${locale}/`) {
      return pathname === `/${locale}` || pathname === `/${locale}/`
    }
    return pathname.startsWith(href.split('?')[0])
  }

  const tabs = [
    {
      key: 'home',
      label: t('home'),
      href: `/${locale}`,
      isFAB: false,
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
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      ),
    },
  ]

  return (
    // sm:hidden → invisible en desktop ≥ 640px
    // fixed bottom-0 → anclado al borde inferior de la pantalla
    // z-50 → sobre el contenido principal
    // inline style paddingBottom → env(safe-area-inset-bottom) para notch iOS
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
```

---

### PASO 5 — MODIFICAR `src/components/WasiNavBar.tsx`

Leer el archivo completo antes de modificar. Localizar:
1. El botón hamburguesa (tiene `sm:hidden` y `onClick` para abrir menú)
2. El bloque `#mobile-menu` (dropdown que aparece al abrir el hamburguesa)
3. La zona del header en mobile (logo + botones)

**Cambio 1 — Ocultar botón hamburguesa:**
```typescript
// ANTES (buscar el botón con sm:hidden y onClick que abre el menú):
<button
  type="button"
  onClick={() => setMenuOpen(!menuOpen)}
  className="inline-flex items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-50 sm:hidden"
>
  {/* icono hamburguesa */}
</button>

// DESPUÉS: reemplazar la className para ocultarlo completamente
<button
  type="button"
  onClick={() => setMenuOpen(!menuOpen)}
  className="hidden"
  aria-hidden="true"
>
  {/* icono hamburguesa */}
</button>
```

**Cambio 2 — Eliminar o neutralizar el bloque `#mobile-menu`:**
```typescript
// ANTES:
{menuOpen && (
  <div id="mobile-menu" className="border-t border-gray-100 sm:hidden">
    {/* links del menú mobile */}
  </div>
)}

// DESPUÉS: envolver en {false && ...} para eliminarlo del render sin romper el estado
{false && menuOpen && (
  <div id="mobile-menu" className="border-t border-gray-100 sm:hidden">
    {/* links del menú mobile */}
  </div>
)}
```

**Cambio 3 — Agregar `WalletConnectButton` en el header mobile:**

El import ya debería existir en `WasiNavBar.tsx`. Si no existe, agregar:
```typescript
// ⚠️ PATH REAL: @/features/payments/components/WalletConnectButton
// NO usar @/components/WalletConnectButton — ese path NO existe
import { WalletConnectButton } from '@/features/payments/components/WalletConnectButton'
```

Localizar en el JSX la zona del header que contiene el logo. Agregar el botón después del logo, solo visible en mobile:
```typescript
{/* Después del Logo Link, antes del botón hamburguesa */}
<div className="flex items-center gap-2 sm:hidden">
  <WalletConnectButton locale={locale} />
</div>
```

> **Nota:** Si `WalletConnectButton` recibe props diferentes (verificar el componente real), adaptar según la firma real del componente.

---

### PASO 6 — Agregar traducciones

**`src/messages/es.json`** — agregar al objeto raíz:
```json
"mobileNav": {
  "home": "Inicio",
  "explore": "Explorar",
  "publish": "Publicar",
  "dashboard": "Dashboard",
  "profile": "Perfil"
}
```

**`src/messages/en.json`** — agregar al objeto raíz:
```json
"mobileNav": {
  "home": "Home",
  "explore": "Explore",
  "publish": "Publish",
  "dashboard": "Dashboard",
  "profile": "Profile"
}
```

---

## Estructura de Archivos

### CREAR
| Archivo | Descripción |
|---------|-------------|
| `src/components/MobileBottomNav.tsx` | Componente principal (`'use client'`) |
| `src/hooks/useUserRole.ts` | Tipo `UserRole` + hook thin |

### MODIFICAR
| Archivo | Cambio |
|---------|--------|
| `src/app/layout.tsx` | Agregar `export const viewport: Viewport` con `viewportFit: 'cover'` |
| `src/app/[locale]/layout.tsx` | Query role en servidor + pasar `userRole` a `MobileBottomNav` |
| `src/components/WasiNavBar.tsx` | Ocultar hamburguesa, eliminar mobile-menu, agregar WalletConnectButton en mobile |
| `src/messages/es.json` | Agregar `mobileNav.*` |
| `src/messages/en.json` | Agregar `mobileNav.*` |

### NO TOCAR
| Archivo | Razón |
|---------|-------|
| `src/app/[locale]/page.tsx` | El `id="agents"` ya existe — verificado por Architect |
| Contratos Solidity | Fuera de scope |
| API routes | Fuera de scope |
| `WalletConnectButton` | Solo se referencia, no se modifica |
| Cualquier componente desktop que funcione hoy | Sin cambios en desktop |

---

## Notas de Implementación

### Safe Area en iOS
```
viewport-fit=cover  →  activa el safe area en iOS
env(safe-area-inset-bottom)  →  el espacio que el sistema reserva para gestos
```
Sin `viewport-fit=cover`, `env(safe-area-inset-bottom)` siempre retorna `0` y la barra queda tapada por el home indicator de iPhone. **El Paso 1 es no-negociable.**

### Por qué prop drilling y no hook con fetch
Si `useUserRole` hiciera fetch a `/api/me` o query directa a Supabase en cada render del componente, el usuario vería un flash del tab Dashboard/Perfil mientras el fetch resuelve (primero aparece sin destino, luego actualiza). Con prop drilling desde SSR, el HTML inicial ya tiene los hrefs correctos — sin flash, sin loading state, sin network request adicional.

### Tab Explorar y el anchor `#agents`
El `id="agents"` fue verificado por Architect en `src/app/[locale]/page.tsx` (línea ~73): `<section id="agents" className="px-6 py-12">`. No necesita modificarse.

### Dashboard y Perfil apuntan al mismo href
Esto es intencional en MVP. Cuando exista `/profile` como ruta propia (backlog P3), se diferenciarán. Es deuda técnica documentada, no un bug.

### z-index del FAB
El FAB usa `z-50`. Cualquier elemento que deba aparecer sobre la barra (modales, toasts) debe usar `z-60` o superior. Auditar si hay elementos fixed con z-index conflictivo.

---

## DoD Checklist

- [ ] **Paso 1 completado:** `export const viewport` con `viewportFit: 'cover'` en `src/app/layout.tsx`
- [ ] HTML renderizado incluye `viewport-fit=cover` en el meta tag de viewport
- [ ] `MobileBottomNav` renderiza 5 tabs en 375px (`sm:hidden` funciona)
- [ ] FAB circular: `bg-[#E84142]`, `shadow-lg`, `-mt-5`, `h-14 w-14`, `rounded-full`
- [ ] Tab activo muestra `text-[#E84142]` según `usePathname()`
- [ ] Hamburguesa oculta en mobile (`hidden`), mobile-menu eliminado del render
- [ ] Header mobile muestra solo logo + `WalletConnectButton`
- [ ] Safe area: `style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}` en el `<nav>`
- [ ] Tab Dashboard: redirige correcto en 3 estados (no auth → login, consumer → /dashboard, creator → /creator/dashboard)
- [ ] Tab Perfil: misma lógica que Dashboard
- [ ] Tab Explorar: `/${locale}#agents` — scroll funciona al anchor
- [ ] En desktop 1280px: barra invisible, navbar desktop sin cambios
- [ ] DevTools Network (mobile): al cambiar tabs NO aparece ninguna request a Supabase
- [ ] Traducciones `mobileNav.*` en `en.json` y `es.json`
- [ ] `npm run build` sin errores TypeScript
- [ ] Screenshot 375px: bottom nav visible, sin hamburguesa visible
- [ ] Screenshot 1280px: solo navbar desktop, sin bottom nav

---

*Story generado por SM (Bob) — BMAD v6 — Sprint 8 — 2026-02-27*
*Basado en: HU-MOBILE-NAV-s0.md (PRD) + sdd-HU-MOBILE-NAV.md (SDD)*
*Correcciones críticas del Architect incluidas: viewport-fit=cover como PASO 1, WalletConnectButton path real, useUserRole sin query Supabase*
