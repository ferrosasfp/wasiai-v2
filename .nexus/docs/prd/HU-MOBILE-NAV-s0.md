# S0 — HU-MOBILE-NAV: Bottom Navigation Bar en Mobile
**Fase:** Discovery (S0)  
**Agente:** PM (John) — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**Prioridad:** P0  
**Estado:** PENDIENTE `HU_APPROVED`  

---

## Historia de Usuario

> Como usuario de WasiAI navegando desde un teléfono, quiero una barra de navegación inferior fija con las 5 secciones principales del marketplace, para poder navegar con el pulgar sin tener que abrir un menú hamburguesa cada vez.

---

## Contexto y Motivación

El WasiNavBar actual muestra un drawer hamburguesa en mobile (< 640px). Este es el patrón más roto en Web3 mobile: OpenSea, Uniswap y Blur usan bottom nav. Para WasiAI —un marketplace de agentes IA— la experiencia mobile es crítica porque muchos consumers llegan desde teléfono.

Esta HU convierte la UX mobile de "webapp responsiva con hamburguesa" a "dApp mobile-first con thumb navigation". Es la base sobre la que descansa HU-3.2 (playground comparativo) y cualquier feature futura de Discovery.

---

## Decisiones Críticas Resueltas

### Decisión 1: Tab "Explorar" — `/explore` no existe

**Opciones evaluadas:**
- A) Crear ruta `/explore` nueva (página dedicada) — scope amplio, no es MVP
- B) Tab apunta a `/#agents` con scroll suave a la sección de agentes en homepage

**Decisión:** **Opción B — Tab Explorar apunta a `/#agents`**

**Justificación:** La homepage ya tiene la sección de agentes con filtros y búsqueda (implementada en sprints anteriores). Crear `/explore` añade scope de 1-2 días adicionales sin valor incremental para el Sprint 8. Para MVP, `/#agents` es semánticamente correcto y funciona inmediatamente. `/explore` como ruta propia es backlog P3.

**Implementación:** `href="/${locale}#agents"` con `scroll: true`. El anchor `#agents` debe existir en `page.tsx` (verificar antes de implementar; agregar si no existe).

---

### Decisión 2: Tab "Perfil" — `/profile` no existe

**Opciones evaluadas:**
- A) Crear ruta `/profile` nueva — scope, no es MVP
- B) Redirección condicional por rol al dashboard correspondiente

**Decisión:** **Opción B — Redirección condicional sin nueva ruta**

**Lógica:**
- Usuario autenticado + rol creator → `/creator/dashboard`
- Usuario autenticado + rol consumer → `/dashboard`
- No autenticado → `/login`

**Justificación:** El perfil del usuario ya vive en los dashboards existentes. Crear una ruta `/profile` genérica requiere unificar ambas vistas, lo cual es scope de una épica separada. Para MVP, redirigir al dashboard correcto es correcto funcionalmente y no requiere nueva página.

**Hook necesario:** `useUserRole()` — devuelve `'creator' | 'consumer' | null`. **IMPORTANTE (observación San):** Este hook NO debe hacer query a Supabase en cada render. El rol/email del usuario ya está disponible desde el server layout (`src/app/[locale]/layout.tsx`). La implementación debe usar prop drilling desde el layout o el contexto de sesión ya existente (ej. `useSession()` de Supabase Auth, que no hace network request adicional). Crear una query nueva a `creator_profiles` desde el cliente en cada render está explícitamente prohibido para esta HU.

---

### Decisión 3: Tab "Dashboard"

**Decisión:** Misma lógica condicional que Perfil:
- Creator → `/creator/dashboard`
- Consumer → `/dashboard`
- No auth → `/login`

**Nota:** Dashboard y Perfil apuntan al mismo destino en MVP. En el futuro, cuando `/profile` exista como ruta, se diferenciarán. Esta duplicación es aceptable y documentada.

---

## Acceptance Criteria

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| **AC-1** | En viewport < 640px, aparece una barra inferior fija con 5 tabs: 🏠 Home (`/${locale}`), 🔍 Explorar (`/${locale}#agents`), ➕ FAB central (`/${locale}/publish`), 📊 Dashboard (condicional), 👤 Perfil (condicional) | DevTools 375px · screenshot |
| **AC-2** | El drawer hamburguesa y el mobile menu dropdown desaparecen completamente en < 640px. El botón hamburguesa tiene clase `sm:hidden` pero se oculta también en mobile. | DevTools 375px: no debe existir `#mobile-menu` abierto ni el botón hamburguesa |
| **AC-3** | Header en mobile muestra ÚNICAMENTE: logo WasiAI (Link a `/`) + `WalletConnectButton`. Sin links de nav, sin LanguageSwitcher, sin email, sin hamburguesa. | DevTools 375px · screenshot |
| **AC-4** | El tab ➕ (Publicar) es un FAB: circular, elevado (`shadow-lg`), color `#E84142`, z-index 50, size mayor que los demás tabs (~56px), desplazado -8px hacia arriba para crear efecto "flotante". | Screenshot 375px |
| **AC-5** | Click en FAB ➕ → navega a `/${locale}/publish` | Prueba manual mobile |
| **AC-6** | Tab activo (según `usePathname()` o hash actual): color `#E84142`. Tab inactivo: `text-gray-500 dark:text-gray-400` | Navegar entre tabs y verificar color |
| **AC-7** | La barra tiene `padding-bottom: env(safe-area-inset-bottom)` en el wrapper, con fallback `pb-4` para no-iOS. | Inspeccionar CSS aplicado |
| **AC-8** | El `<meta name="viewport">` en el layout raíz incluye `viewport-fit=cover`. Si no existe, se agrega como parte de esta HU. | Verificar `src/app/layout.tsx` (el root layout, no el locale layout) |
| **AC-9** | Tab Dashboard: creator → `/${locale}/creator/dashboard` \| consumer → `/${locale}/dashboard` \| no auth → `/${locale}/login` | Test manual con 3 estados de usuario |
| **AC-10** | Tab Perfil: mismo comportamiento que Dashboard (ver Decisión 2) | Test manual con 3 estados de usuario |
| **AC-11** | Tab Explorar → `/${locale}#agents`. Si la sección no tiene `id="agents"` en `page.tsx`, se agrega. | Inspeccionar DOM de homepage |
| **AC-12** | En desktop ≥ 640px: la barra inferior NO aparece. El navbar existente funciona sin ningún cambio. | DevTools 1280px |
| **AC-13** | Todas las etiquetas de la barra tienen traducción en `es` y `en` bajo las claves `mobileNav.home`, `mobileNav.explore`, `mobileNav.publish`, `mobileNav.dashboard`, `mobileNav.profile` | `grep -r "mobileNav" src/messages/` |
| **AC-14** | El componente `MobileBottomNav` es `'use client'` y no hace fetch en cada render. La consulta de rol usa `useSWR` con key estable o `useState` + `useEffect` con fetch a `/api/me` o desde la sesión de Supabase ya disponible. | Revisar Network tab: no debe hacer fetch en cada navegación de tab |
| **AC-15** | El estado de rol del usuario se obtiene del contexto de sesión existente — sin query adicional a Supabase. El hook `useUserRole` (o equivalente) lee el rol desde el contexto ya disponible (prop drilling desde layout o `useSession()` de Supabase Auth). Network tab en DevTools no debe mostrar ninguna request nueva a Supabase al montar `MobileBottomNav`. | Abrir DevTools > Network > filtrar por `supabase`: no debe aparecer ninguna request nueva al cargar el bottom nav |

---

## Scope

### Archivos a CREAR

| Archivo | Descripción |
|---------|-------------|
| `src/components/MobileBottomNav.tsx` | Componente principal de la barra inferior (`'use client'`) |
| `src/hooks/useUserRole.ts` | Hook que devuelve `'creator' \| 'consumer' \| null`. **NO hace query a Supabase.** Lee el rol desde el contexto de sesión existente (prop drilling desde layout o `useSession()` de Supabase Auth). Si el contexto no expone el rol directamente, leer el campo `user_metadata.role` o el email de la sesión ya cacheada — sin fetch adicional. |

### Archivos a MODIFICAR

| Archivo | Cambio |
|---------|--------|
| `src/components/WasiNavBar.tsx` | En mobile (< 640px): ocultar hamburguesa (`sm:hidden` en el botón), ocultar el `#mobile-menu` dropdown. En el header mobile, mostrar solo logo + WalletConnectButton. Los elementos existentes de desktop (`hidden sm:flex`) no se tocan. |
| `src/app/[locale]/layout.tsx` | Agregar `<MobileBottomNav locale={locale} />` después del `{children}`, dentro del `Web3Provider`, fuera del flujo de scroll principal. |
| `src/app/[locale]/page.tsx` | Verificar que la sección de agentes tiene `id="agents"`. Si no, agregar al elemento contenedor correspondiente. |
| `src/app/layout.tsx` (root) | Verificar que `<meta name="viewport">` incluye `viewport-fit=cover`. Agregar si falta. |
| `src/messages/en.json` | Agregar `"mobileNav": { "home": "Home", "explore": "Explore", "publish": "Publish", "dashboard": "Dashboard", "profile": "Profile" }` |
| `src/messages/es.json` | Agregar `"mobileNav": { "home": "Inicio", "explore": "Explorar", "publish": "Publicar", "dashboard": "Dashboard", "profile": "Perfil" }` |

### Archivos a NO TOCAR

- Contratos Solidity
- API routes
- Cualquier componente desktop que funcione hoy
- `WalletConnectButton` — solo se referencia, no se modifica

---

## Estructura del Componente (referencia para Dev/S1)

```typescript
// src/components/MobileBottomNav.tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useUserRole } from '@/hooks/useUserRole'
import { HomeIcon, MagnifyingGlassIcon, PlusIcon, ChartBarIcon, UserIcon } from '@heroicons/react/24/outline'

// Props: locale pasado desde layout.tsx para construir hrefs correctos
interface MobileBottomNavProps { locale: string }

export function MobileBottomNav({ locale }: MobileBottomNavProps) {
  const pathname = usePathname()
  const role = useUserRole() // 'creator' | 'consumer' | null

  const dashboardHref = role === 'creator'
    ? `/${locale}/creator/dashboard`
    : role === 'consumer'
    ? `/${locale}/dashboard`
    : `/${locale}/login`

  const profileHref = dashboardHref // MVP: mismo destino

  const tabs = [
    { key: 'home',      icon: HomeIcon,              href: `/${locale}`,           isFAB: false },
    { key: 'explore',   icon: MagnifyingGlassIcon,   href: `/${locale}#agents`,    isFAB: false },
    { key: 'publish',   icon: PlusIcon,              href: `/${locale}/publish`,   isFAB: true  },
    { key: 'dashboard', icon: ChartBarIcon,          href: dashboardHref,          isFAB: false },
    { key: 'profile',   icon: UserIcon,              href: profileHref,            isFAB: false },
  ]

  // Wrapper: fixed bottom-0, sm:hidden, safe-area
  // FAB: bg-[#E84142] rounded-full -mt-6 shadow-lg p-4
  // Tab activo: text-[#E84142] | inactivo: text-gray-500 dark:text-gray-400
}
```

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| `viewport-fit=cover` no está en el root layout → safe area no funciona en iOS | Media | Alto | AC-8 obliga a verificar y agregar antes de implementar la barra |
| FAB se solapa con contenido fixed (cookie banners, modales) | Baja | Medio | Auditar z-index del proyecto. FAB usa z-50; cualquier elemento que deba estar por encima usará z-60+ |
| `useUserRole` hace query en cada mount → latencia visible al cambiar tabs | Media | Medio | **[RIESGO MITIGADO — observación San]** El hook NO hace query a Supabase. Usa el rol ya disponible en el contexto de sesión del server layout (prop drilling o `useSession()`). Sin network request adicional = sin latencia = riesgo eliminado. |
| Anchor `#agents` no existe en `page.tsx` → Tab Explorar no hace scroll | Media | Bajo | AC-11 lo resuelve: verificar y agregar el id antes de codear |
| WasiNavBar usa `sm:hidden` inconsistentemente → hamburguesa visible en mobile junto a bottom nav | Media | Alto | AC-2 y AC-3 son la verificación explícita. El Dev debe leer WasiNavBar.tsx completo antes de modificar |
| Dashboard y Perfil apuntan al mismo href → UX redundante | Alta | Bajo | Documentado y aceptado. Es MVP. Se diferencia cuando exista `/profile`. |

---

## Estimación

**Tamaño:** M — 3-5 horas de desarrollo  
**Complejidad:** Media (lógica condicional de roles, interacción con NavBar existente, safe area CSS)  
**Dependencias:** Ninguna técnica. Debe implementarse antes de HU-3.2.

---

## Definition of Done (para QA)

- [ ] Screenshot en 375px muestra bottom nav con 5 tabs, sin hamburguesa, header simplificado
- [ ] Screenshot en 1280px muestra navbar desktop sin cambios, sin bottom nav
- [ ] Los 3 estados de auth pasan (no auth, consumer, creator) para Dashboard y Perfil
- [ ] Safe area visible en Safari iOS real o BrowserStack iOS
- [ ] `npm run build` sin errores TypeScript
- [ ] Traducciones `mobileNav.*` en `en.json` y `es.json`
- [ ] `viewport-fit=cover` confirmado en root layout

---

*Generado por PM (John) — BMAD v6 — 2026-02-27*  
*Revisado por San (orquestradora) — 2026-02-27: Observaciones técnicas integradas (useIsCreator sin query Supabase, AC-15 agregado, riesgo de query en cada render marcado como mitigado)*  
*Gate requerido: Fer escribe `HU_APPROVED` después de leer este documento*
