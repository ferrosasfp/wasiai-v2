# Story UX-10 — Language Switcher EN/ES en WasiNavBar

**Sprint:** 5
**Tipo:** Feature / UX
**Estimación:** S (1–2 puntos)
**Fecha:** 2026-02-26
**Estado del gate:** HU_APPROVED ✅ | SPEC_APPROVED ✅ | Story generada ✅

---

## Historia de Usuario

> **Como** usuario de WasiAI,
> **quiero** poder cambiar el idioma entre inglés y español desde la barra de navegación,
> **para** usar la plataforma en mi idioma preferido sin tener que editar la URL manualmente.

---

## Acceptance Criteria (verificables)

### AC-1 — Switcher visible en NavBar
- [ ] El NavBar muestra botones `EN` y `ES`.
- [ ] El locale activo tiene `font-bold text-gray-900`; el inactivo `text-gray-400 opacity-50`.
- [ ] Visible en desktop (≥ 640px): entre los nav links y el bloque de auth.
- [ ] Visible en mobile (< 640px): dentro del drawer, después de los nav links y antes del bloque de auth.

### AC-2 — Cambio de locale via URL (sin perder ruta)
- [ ] Clic en `ES` desde `/en/publish` navega a `/es/publish`.
- [ ] Clic en `EN` desde `/es/publish` navega a `/en/publish`.
- [ ] Clic en el locale ya activo no hace nada (early return).
- [ ] El cambio usa `router.replace(pathname, { locale })` de `@/i18n/navigation` — **no** `window.location.href`.

### AC-3 — Persistencia
- [ ] Navegar a otra ruta después del cambio mantiene el locale seleccionado.
- [ ] El middleware de next-intl existente gestiona la cookie/header — no requiere código adicional.

### AC-4 — Accesibilidad
- [ ] El wrapper tiene `role="group"` y `aria-label="Change language / Cambiar idioma"`.
- [ ] Cada botón tiene `aria-pressed={currentLocale === 'xx'}` y `aria-label` descriptivo.
- [ ] Navegable con teclado (Tab + Enter).

### AC-5 — Sin regresión en NavBar
- [ ] Logo, nav links, wallet connect y auth buttons funcionan igual.
- [ ] Sin layout shift visible en desktop ni mobile.
- [ ] En mobile el switcher no rompe el flex del drawer existente.

---

## Scope exacto

| Archivo | Acción |
|---------|--------|
| `src/components/LanguageSwitcher.tsx` | **Crear** (nuevo) |
| `src/components/WasiNavBar.tsx` | **Modificar** — 1 import + 2 inserciones |
| `middleware.ts`, `i18n/routing.ts`, `messages/*.json` | **No tocar** |

---

## Código completo — `src/components/LanguageSwitcher.tsx`

```tsx
'use client'

import { usePathname, useRouter } from '@/i18n/navigation'
import { useParams } from 'next/navigation'

export function LanguageSwitcher() {
  const router = useRouter()
  // usePathname de @/i18n/navigation retorna path SIN prefijo de locale
  // e.g. en /en/publish → devuelve '/publish'
  const pathname = usePathname()
  const params = useParams()
  const currentLocale = (params?.locale as string) || 'en'

  function switchLocale(newLocale: string) {
    if (newLocale === currentLocale) return
    router.replace(pathname, { locale: newLocale })
  }

  return (
    <div
      className="flex items-center gap-1 text-xs font-medium"
      role="group"
      aria-label="Change language / Cambiar idioma"
    >
      <button
        type="button"
        onClick={() => switchLocale('en')}
        aria-pressed={currentLocale === 'en'}
        aria-label="Switch to English"
        className={`rounded px-1.5 py-0.5 transition-colors ${
          currentLocale === 'en'
            ? 'font-bold text-gray-900'
            : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        EN
      </button>
      <span className="text-gray-300" aria-hidden="true">|</span>
      <button
        type="button"
        onClick={() => switchLocale('es')}
        aria-pressed={currentLocale === 'es'}
        aria-label="Cambiar a Español"
        className={`rounded px-1.5 py-0.5 transition-colors ${
          currentLocale === 'es'
            ? 'font-bold text-gray-900'
            : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        ES
      </button>
    </div>
  )
}
```

**Por qué funciona:**
- `usePathname()` de `@/i18n/navigation` (next-intl) devuelve el path **sin** el prefijo de locale. Eso es lo que `router.replace` espera como primer arg.
- `useParams()` de `next/navigation` lee el segmento `[locale]` del route. Es la forma más directa sin depender de parsear el pathname.
- `router.replace` de next-intl construye la URL final correctamente: `/es/publish`, no `/es/en/publish`.
- `aria-pressed` informa a screen readers el estado activo del toggle.

---

## Diff exacto — `src/components/WasiNavBar.tsx`

### Cambio 1 — Import (al inicio de los imports)

```diff
  import { useState, useEffect, useMemo } from 'react'
  import Link from 'next/link'
  import { usePathname } from 'next/navigation'
  import { createClient } from '@/lib/supabase/client'
+ import { LanguageSwitcher } from '@/components/LanguageSwitcher'
```

### Cambio 2 — Desktop: insertar entre nav links y auth actions

Localizar el cierre del `<div className="hidden items-center gap-1 sm:flex flex-1" role="list">` y agregar inmediatamente después:

```diff
          </div>

+         {/* Language switcher — desktop */}
+         <div className="hidden sm:flex shrink-0">
+           <LanguageSwitcher />
+         </div>

          {/* Auth actions */}
          <div className="hidden items-center gap-3 sm:flex shrink-0">
```

### Cambio 3 — Mobile: insertar dentro del drawer antes del bloque auth

Localizar el map de `NAV_LINKS` en el mobile menu y agregar después de su cierre y antes del `<div className="mt-3 border-t...">`:

```diff
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive(href) ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(href)
                    ? 'bg-avax-50 text-avax-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </Link>
            ))}
+           {/* Language switcher — mobile */}
+           <div className="pt-2">
+             <LanguageSwitcher />
+           </div>
            <div className="mt-3 border-t border-gray-100 pt-3">
```

**Resumen del diff:** 1 import + 5 líneas en desktop + 3 líneas en mobile. **Cero líneas eliminadas.** **Cero modificaciones** a código existente.

---

## Contexto técnico crítico

| Punto | Detalle |
|-------|---------|
| WasiNavBar es CC | Primera línea: `'use client'` — sin restricciones para hooks |
| `@/i18n/navigation` | Exporta `useRouter` y `usePathname` vía `createNavigation(routing)` de next-intl v4 |
| `usePathname` de next-intl | Retorna path **sin** prefijo de locale (e.g., `/publish`, no `/en/publish`) |
| `useParams` de next/navigation | Lee `params.locale` del segment `[locale]` — más directo que parsear pathname |
| Middleware existente | Ya gestiona detección/persistencia de locale — no tocar |
| `router.replace(pathname, { locale })` | API de next-intl navigation — construye URL correcta sin duplicar prefijo |

---

## DoD Checklist

### Implementación
- [ ] `src/components/LanguageSwitcher.tsx` creado con el código exacto de este story
- [ ] Import agregado en `WasiNavBar.tsx`
- [ ] Inserción desktop aplicada (después del div de nav links, antes de auth)
- [ ] Inserción mobile aplicada (dentro del drawer, antes del `div.mt-3.border-t`)

### Funcional
- [ ] Clic `ES` desde `/en/publish` → URL cambia a `/es/publish`
- [ ] Clic `EN` desde `/es/publish` → URL cambia a `/en/publish`
- [ ] Clic en locale activo → no hace nada (sin navegación)
- [ ] Navegar a otra página → locale se mantiene
- [ ] Locale activo visualmente diferenciado (bold vs opacity)

### Layout
- [ ] Switcher visible en desktop ≥ 640px
- [ ] Switcher visible en mobile < 640px (dentro del drawer)
- [ ] Sin layout shift en desktop
- [ ] Sin layout shift en mobile
- [ ] Logo, nav links, auth buttons funcionan igual que antes

### Accesibilidad
- [ ] `role="group"` + `aria-label="Change language / Cambiar idioma"` presentes
- [ ] `aria-pressed` correcto en cada botón
- [ ] `aria-label` individual en cada botón
- [ ] Navegable con teclado

### Calidad
- [ ] `next build` pasa sin errores ni warnings de tipo
- [ ] Sin `any` explícito en el código nuevo
- [ ] Code Review formal antes de merge
- [ ] Probado manualmente en `/en/` y `/es/` (al menos en `/publish`)

---

## Notas para el Dev

1. **No cambiar** `usePathname` de `next/navigation` que ya usa WasiNavBar — eso extrae el locale del pathname completo y es correcto para el componente existente. El `LanguageSwitcher` usa su propio import de `@/i18n/navigation`.

2. Si aparece error de tipo en `router.replace(pathname, { locale: newLocale })`, verificar que `newLocale` sea `'en' | 'es'` — puede requerir un cast: `router.replace(pathname, { locale: newLocale as 'en' | 'es' })`.

3. El `useParams()` puede retornar `locale` como `string | string[]` — el cast `as string` en `(params?.locale as string)` es correcto dado que `[locale]` es un segmento único.

4. **Orden de implementación recomendado:**
   - Crear `LanguageSwitcher.tsx`
   - Agregar import en `WasiNavBar.tsx`
   - Agregar bloque desktop
   - Agregar bloque mobile
   - Verificar `next build`
   - Prueba manual en `/en/publish` → clic ES → `/es/publish` ✓

---

*Story generada por SM (BMAD v6) — 2026-02-26*
*Basada en: UX-10.md (HU) + SDD-UX-10.md + análisis directo de WasiNavBar.tsx + i18n/navigation.ts*
