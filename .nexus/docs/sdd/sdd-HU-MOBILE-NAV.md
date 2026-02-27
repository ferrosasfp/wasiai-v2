# SDD — HU-MOBILE-NAV: Bottom Navigation Bar en Mobile
**Fase:** S1 (Software Design Document)  
**Agente:** Architect — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**HU Fuente:** `.nexus/docs/prd/HU-MOBILE-NAV-s0.md`  
**Estado:** SPEC_PENDING

---

## Hallazgos del Codebase (Pre-diseño)

### ✅ Verificaciones completadas

| Check | Resultado |
|-------|-----------|
| `id="agents"` en `page.tsx` | ✅ **EXISTE** — `<section id="agents" className="px-6 py-12">` (línea ~73 de page.tsx) |
| `viewport-fit=cover` en `src/app/layout.tsx` | ❌ **AUSENTE** — El root layout usa `metadata` de Next.js pero no exporta `viewport`. Debe agregarse como parte de esta HU. |
| `WalletConnectButton` path real | `@/features/payments/components/WalletConnectButton` (no `@/components/WalletConnectButton`) |
| Hamburguesa en mobile | El botón tiene `sm:hidden` → **ya está oculto en ≥ 640px**, pero visible en mobile. Necesita ocultarse. |
| Sesión en locale layout | `src/app/[locale]/layout.tsx` pasa `initialEmail` al `WasiNavBar` via server component. **No pasa `role`** directamente. |
| Rol de usuario en cliente | El locale layout solo obtiene `user.email`. **No lee `creator_profiles`**. El `user_metadata` puede contener rol si se configuró en signup. |

### 🚨 Hallazgo crítico: `useUserRole` sin query adicional

El `src/app/[locale]/layout.tsx` actual solo pasa `initialEmail` al `WasiNavBar`. No hay un `role` disponible en el contexto de cliente sin una query adicional.

**Solución de diseño (Golden Path):**  
El hook `useUserRole` debe leer el email del usuario desde Supabase Auth client-side (que usa la sesión cacheada localmente — sin network request), y determinar el rol via un fetch a `/api/me` con SWR (cacheado, no se repite en cada tab-change). **No se consulta `creator_profiles` directamente desde el cliente.**

Alternativamente: el `locale layout` se modifica para consultar `creator_profiles.username` y pasarlo como prop al `MobileBottomNav` (prop drilling puro, sin cliente). Esta es la solución más limpia para SSR.

**Decisión de diseño de este SDD:** Usar prop drilling desde el server layout. El `LocaleLayout` consulta el role del usuario y lo pasa como prop. Zero network requests en cliente.

---

## Arquitectura

### Nuevos Archivos

```
src/
├── components/
│   └── MobileBottomNav.tsx          ← 'use client' — barra inferior
└── hooks/
    └── useUserRole.ts               ← lee role desde prop (no query)
```

### Archivos Modificados

```
src/app/layout.tsx                   → export viewport con viewport-fit=cover
src/app/[locale]/layout.tsx          → query role + pasar props a MobileBottomNav
src/components/WasiNavBar.tsx        → ocultar hamburguesa y mobile-menu en < 640px
src/messages/en.json                 → agregar mobileNav.*
src/messages/es.json                 → agregar mobileNav.*
```

**Nota:** `src/app/[locale]/page.tsx` — **NO requiere cambio**. El `id="agents"` ya existe.

---

## Diseño Detallado

### 1. `src/app/layout.tsx` — Agregar viewport

```typescript
// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'

// ✅ NUEVO: viewport export para safe-area iOS
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',          // → viewport-fit=cover para safe area iOS
}

export const metadata: Metadata = {
  // ...igual que antes, sin cambios...
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

> **Nota:** En Next.js 14 App Router, `viewport` se exporta por separado de `metadata`. Genera automáticamente `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

---

### 2. `src/app/[locale]/layout.tsx` — Leer role y pasar props

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

  // ✅ NUEVO: determinar role sin query extra a creator_profiles
  // El role se infiere: si el usuario existe y tiene registro en creator_profiles → 'creator'
  // Para MVP: un fetch ligero en server (ya tenemos supabase client activo)
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
        {/* ✅ NUEVO: Bottom Nav — solo se renderiza, sm:hidden oculta en desktop */}
        <MobileBottomNav locale={locale} userRole={userRole} />
      </Web3Provider>
    </NextIntlClientProvider>
  )
}
```

> **Rationale:** La query a `creator_profiles` ya se hace en el server layout (costo: 1 query de 1 fila, index scan por PK). No hay network request en cliente. El componente `MobileBottomNav` recibe `userRole` como prop estático desde SSR.

---

### 3. `src/components/MobileBottomNav.tsx`

```typescript
// src/components/MobileBottomNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface MobileBottomNavProps {
  locale: string
  userRole: 'creator' | 'consumer' | null  // viene del server, sin fetch
}

export function MobileBottomNav({ locale, userRole }: MobileBottomNavProps) {
  const pathname = usePathname()
  const t = useTranslations('mobileNav')

  // Destinos condicionales por rol
  const dashboardHref = userRole === 'creator'
    ? `/${locale}/creator/dashboard`
    : userRole === 'consumer'
    ? `/${locale}/dashboard`
    : `/${locale}/login`

  const profileHref = dashboardHref  // MVP: mismo destino

  // Determinar tab activo por pathname
  function isActive(href: string): boolean {
    if (href.includes('#')) return false  // tab Explorar: nunca "activo"
    if (href === `/${locale}`) return pathname === `/${locale}` || pathname === `/${locale}/`
    return pathname.startsWith(href.split('?')[0])
  }

  const tabs = [
    {
      key: 'home',
      label: t('home'),
      href: `/${locale}`,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
      isFAB: false,
    },
    {
      key: 'explore',
      label: t('explore'),
      href: `/${locale}#agents`,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      ),
      isFAB: false,
    },
    {
      key: 'publish',
      label: t('publish'),
      href: `/${locale}/publish`,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      ),
      isFAB: true,
    },
    {
      key: 'dashboard',
      label: t('dashboard'),
      href: dashboardHref,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
      isFAB: false,
    },
    {
      key: 'profile',
      label: t('profile'),
      href: profileHref,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      ),
      isFAB: false,
    },
  ]

  return (
    // sm:hidden → invisible en desktop ≥ 640px
    // fixed bottom-0 → anclado al borde inferior
    // pb-[env(safe-area-inset-bottom)] → espacio para safe area iOS
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white border-t border-gray-200"
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
                className="relative -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#E84142] shadow-lg text-white z-50"
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
              className={`flex flex-col items-center gap-0.5 py-1 px-3 min-w-0 ${color}`}
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

### 4. `src/hooks/useUserRole.ts`

```typescript
// src/hooks/useUserRole.ts
// NOTA: Este hook es un wrapper thin para uso futuro.
// En esta HU, el role viene como prop desde el server layout.
// No hace fetch. Solo expone el tipo para consistencia de código.

export type UserRole = 'creator' | 'consumer' | null

// Para uso en componentes que no tienen acceso al prop drilling,
// este hook puede aceptar el role directamente:
export function useUserRole(role: UserRole): UserRole {
  return role
}
```

> **Nota de arquitectura:** El hook es minimal en esta HU. Su existencia es para establecer el tipo `UserRole` reutilizable en el proyecto. La lógica real vive en el server layout, no en el hook.

---

### 5. `src/components/WasiNavBar.tsx` — Cambios en mobile

**Cambios mínimos requeridos:**

```typescript
// ANTES (botón hamburguesa — aprox línea 200):
<button
  type="button"
  onClick={() => setMenuOpen(!menuOpen)}
  // ...
  className="inline-flex items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-50 sm:hidden"
>

// DESPUÉS: agregar hidden para ocultar en mobile también
// El bottom nav reemplaza la hamburguesa en mobile
<button
  type="button"
  onClick={() => setMenuOpen(!menuOpen)}
  // ...
  className="hidden"    // ← ocultar completamente (bottom nav lo reemplaza)
  aria-hidden="true"
>
```

```typescript
// ANTES (mobile menu dropdown):
{menuOpen && (
  <div id="mobile-menu" className="border-t border-gray-100 sm:hidden">
    ...
  </div>
)}

// DESPUÉS: eliminar el bloque mobile-menu completamente del JSX
// (o envolverlo en {false && ...} para no romper la referencia aria)
```

**Header mobile simplificado:**  
El header actual ya tiene los elementos desktop con `hidden sm:flex`. En mobile quedan: logo + hamburguesa. Al ocultar la hamburguesa, en mobile solo queda el logo. 

Para mostrar `WalletConnectButton` en mobile header, agregar:
```typescript
// Después del Logo, antes del hamburguesa button:
<div className="sm:hidden shrink-0">
  <WalletConnectButton locale={locale} />
</div>
```

---

### 6. Traducciones

```json
// src/messages/es.json — agregar bajo clave "mobileNav"
"mobileNav": {
  "home": "Inicio",
  "explore": "Explorar",
  "publish": "Publicar",
  "dashboard": "Dashboard",
  "profile": "Perfil"
}
```

```json
// src/messages/en.json — agregar bajo clave "mobileNav"
"mobileNav": {
  "home": "Home",
  "explore": "Explore",
  "publish": "Publish",
  "dashboard": "Dashboard",
  "profile": "Profile"
}
```

---

## Flujo End-to-End

```
1. Usuario abre WasiAI en mobile (< 640px)
   ↓
2. Server: LocaleLayout llama auth.getUser() → obtiene user
   → Si user existe: consulta creator_profiles por PK → determina role
   → Si no: userRole = null
   ↓
3. Server render: MobileBottomNav recibe { locale, userRole }
   → dashboardHref se calcula en SSR
   → HTML inicial contiene los 5 tabs con hrefs correctos
   ↓
4. Cliente: MobileBottomNav hidrata
   → usePathname() marca tab activo
   → Sin fetch adicional
   ↓
5. Usuario hace tap en tab
   → Link de next/navigation → navegación
   → usePathname() actualiza tab activo
   ↓
6. Usuario en iOS: padding-bottom = env(safe-area-inset-bottom)
   → contenido no queda tapado por gestos del sistema
```

---

## CSS Safe Area — Detalle

```html
<!-- Resultado de export const viewport: Viewport = { viewportFit: 'cover' } -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
/* En MobileBottomNav: inline style o clase Tailwind arbitraria */
padding-bottom: env(safe-area-inset-bottom, 16px);  /* fallback 16px para no-iOS */
```

El `env()` solo tiene efecto cuando `viewport-fit=cover` está activo. Sin él, `env(safe-area-inset-bottom)` siempre retorna `0`.

---

## Implementation Readiness Check

| Item | Estado | Acción Dev |
|------|--------|-----------|
| `id="agents"` en page.tsx | ✅ Existe | Sin cambio |
| `viewport-fit=cover` en root layout | ❌ Ausente | Agregar `export const viewport` |
| `WalletConnectButton` import path | ✅ Confirmado | `@/features/payments/components/WalletConnectButton` |
| Hamburguesa visible en mobile | 🔴 Debe ocultarse | Cambiar clase a `hidden` |
| Mobile menu dropdown | 🔴 Debe eliminarse | Remover bloque `#mobile-menu` |
| `useUserRole` sin query Supabase cliente | ✅ Diseñado | Prop drilling desde server layout |
| Tipos TypeScript en MobileBottomNavProps | ✅ Definidos | `locale: string, userRole: 'creator' \| 'consumer' \| null` |
| Traducciones | ❌ Ausentes | Agregar `mobileNav.*` en es.json y en.json |

---

## Definition of Done

- [ ] `export const viewport` con `viewportFit: 'cover'` en `src/app/layout.tsx`
- [ ] `MobileBottomNav` renderiza 5 tabs en 375px, invisible en 1280px (`sm:hidden`)
- [ ] FAB circular con bg `#E84142`, shadow-lg, -mt-5 (flotante)
- [ ] Tab activo: `text-[#E84142]` según `usePathname()`
- [ ] Hamburguesa oculta en mobile (`hidden`), mobile-menu eliminado
- [ ] Header mobile muestra solo logo + `WalletConnectButton`
- [ ] Safe area: `padding-bottom: env(safe-area-inset-bottom)` en nav
- [ ] Tab Dashboard/Perfil redirige correctamente en 3 estados de auth
- [ ] `id="agents"` verificado en page.tsx (ya existe — no tocar)
- [ ] DevTools Network: sin requests adicionales a Supabase al navegar tabs
- [ ] `npm run build` sin errores TypeScript
- [ ] Traducciones `mobileNav.*` en `en.json` y `es.json`
- [ ] Screenshot 375px: bottom nav visible, sin hamburguesa
- [ ] Screenshot 1280px: navbar desktop sin cambios, sin bottom nav

---

*Generado por Architect — BMAD v6 — 2026-02-27*  
*Gate requerido: Fer escribe `SPEC_APPROVED` después de leer este documento*
