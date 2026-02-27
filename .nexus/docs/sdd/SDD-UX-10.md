# S1 — SDD: UX-10 Language Switcher EN/ES en WasiNavBar

**Sprint:** 5
**Tipo:** Feature / UX
**Fecha SDD:** 2026-02-26
**PM:** San (BMAD Agent)
**HU de referencia:** `.nexus/docs/prd/UX-10.md`

---

## 1. Análisis del componente existente

### WasiNavBar — ¿Server Component o Client Component?

**WasiNavBar es un Client Component.**

Evidencia directa: la primera línea del archivo es `'use client'`.

Consecuencias para UX-10:
- No hay restricción para usar hooks en WasiNavBar ni en sus children.
- `LanguageSwitcher.tsx` puede importarse directamente sin wrapper adicional.
- No se necesita convertir nada.

### Contexto técnico relevante (WasiNavBar actual)
- Importa `usePathname` de `next/navigation` (vanilla Next.js, **no** next-intl).
- Extrae el locale manualmente: `const locale = pathname.split('/')[1] || 'en'`
- Usa ese locale para construir todos los `href` de nav y auth.
- El archivo `src/i18n/navigation.ts` exporta `useRouter` y `usePathname` de next-intl v4 vía `createNavigation(routing)`. Estos son los helpers correctos para switching.

---

## 2. Decisiones de diseño

| Decisión | Elección | Razón |
|----------|----------|-------|
| Componente separado vs inline | **Separado** (`LanguageSwitcher.tsx`) | Aislamiento, testeable, reutilizable |
| Import de router/pathname | `@/i18n/navigation` | Es el helper generado con `createNavigation` — locale-aware |
| `usePathname` de next-intl vs next/navigation | **next-intl** (`@/i18n/navigation`) | Devuelve path sin prefijo de locale (e.g., `/publish`), lo que permite `router.replace(pathname, { locale })` correctamente |
| Posición desktop | Entre nav links y auth actions | Consistente con convención internacional; no interrumpe flujo |
| Posición mobile | Al final del drawer, antes de los botones auth | Visible, no rompe layout, lógicamente agrupado |
| Estilo activo | `font-bold text-gray-900` vs `opacity-50 text-gray-400` | Coherente con el sistema visual existente |

---

## 3. Código completo — `LanguageSwitcher.tsx`

**Ruta:** `src/components/LanguageSwitcher.tsx`

```tsx
'use client'

import { usePathname, useRouter } from '@/i18n/navigation'
import { useParams } from 'next/navigation'

export function LanguageSwitcher() {
  const router = useRouter()
  const pathname = usePathname() // path sin locale prefix, e.g. '/publish'
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

**Notas:**
- `usePathname()` de `@/i18n/navigation` retorna el path sin locale (e.g., `/publish`, no `/en/publish`).
- `useParams()` de `next/navigation` es la forma más directa de leer el locale activo en un CC dentro de un route segment `[locale]`.
- `router.replace(pathname, { locale: newLocale })` construye la URL correcta sin duplicar prefijo.
- `aria-pressed` para accesibilidad de toggle state.

---

## 4. Integración en `WasiNavBar.tsx`

### 4.1 Import a agregar

```tsx
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
```

### 4.2 Posición desktop — entre nav links y auth actions

Insertar `<LanguageSwitcher />` en el bloque desktop, **después del div de nav links** y **antes del div de auth actions**:

```tsx
{/* Desktop nav */}
<div className="hidden items-center gap-1 sm:flex flex-1" role="list">
  {NAV_LINKS.map(({ href, label }) => (
    // ... links existentes sin cambio
  ))}
</div>

{/* Language switcher — desktop */}
<div className="hidden sm:flex shrink-0">
  <LanguageSwitcher />
</div>

{/* Auth actions */}
<div className="hidden items-center gap-3 sm:flex shrink-0">
  {/* ... sin cambio */}
</div>
```

### 4.3 Posición mobile — dentro del drawer, antes del bloque auth

Insertar `<LanguageSwitcher />` en el mobile menu, **dentro del `div` con `space-y-1 px-4 py-3`**, antes del `div.mt-3.border-t`:

```tsx
{/* Mobile menu */}
{menuOpen && (
  <div id="mobile-menu" className="border-t border-gray-100 sm:hidden">
    <div className="space-y-1 px-4 py-3">
      {NAV_LINKS.map(({ href, label }) => (
        // ... links existentes sin cambio
      ))}

      {/* Language switcher — mobile */}
      <div className="pt-2">
        <LanguageSwitcher />
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        {/* auth block sin cambio */}
      </div>
    </div>
  </div>
)}
```

### 4.4 Diff consolidado (solo las líneas que cambian)

```diff
+ import { LanguageSwitcher } from '@/components/LanguageSwitcher'

  // Desktop: después del bloque de nav links y antes de auth actions
+ {/* Language switcher — desktop */}
+ <div className="hidden sm:flex shrink-0">
+   <LanguageSwitcher />
+ </div>

  // Mobile drawer: después del map de NAV_LINKS y antes del div.mt-3.border-t
+             {/* Language switcher — mobile */}
+             <div className="pt-2">
+               <LanguageSwitcher />
+             </div>
```

**Líneas eliminadas:** 0. **Líneas modificadas:** 0. Solo adiciones.

---

## 5. Archivos a tocar

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `src/components/LanguageSwitcher.tsx` | **Crear** | Nuevo componente |
| `src/components/WasiNavBar.tsx` | **Modificar** | Agregar import + 2 inserciones |
| `messages/en.json` | No tocar | aria-label hardcoded en inglés (suficiente) |
| `messages/es.json` | No tocar | Ídem |
| `middleware.ts` | No tocar | Ya configurado |
| `src/i18n/navigation.ts` | No tocar | Ya exporta `useRouter`, `usePathname` |

---

## 6. Riesgos y mitigaciones

| Riesgo | Estado | Mitigación |
|--------|--------|-----------|
| WasiNavBar es SC → no puede importar CC | ✅ Eliminado | WasiNavBar ya es CC (`'use client'`) |
| `usePathname` retorna path con locale duplicado | ✅ Eliminado | Se usa `usePathname` de `@/i18n/navigation` que retorna sin prefijo |
| Mobile switcher rompe layout | Bajo | Se inserta como bloque separado con `pt-2`, no modifica flex del menú |
| `useParams` no disponible | Bajo | Es hook estándar de Next.js 13+ — ya está disponible en el proyecto |

---

## 7. Definición de Hecho (DoD) — Verificable

```
[ ] LanguageSwitcher.tsx creado en src/components/
[ ] Import agregado en WasiNavBar.tsx
[ ] Switcher visible en desktop (≥640px) entre nav links y auth
[ ] Switcher visible en mobile (<640px) en el drawer, antes de auth
[ ] Clic en ES: URL cambia de /en/[ruta] → /es/[ruta] manteniendo pathname
[ ] Clic en EN: URL cambia de /es/[ruta] → /en/[ruta] manteniendo pathname
[ ] Locale activo muestra font-bold, el otro opacity-50
[ ] Navegación posterior a otra página mantiene locale seleccionado
[ ] `next build` sin errores ni warnings de tipo
[ ] PR con Code Review formal antes de merge
[ ] Probado manualmente en /en/publish y /es/publish
[ ] Sin layout shift visible en desktop ni mobile
```

---

## 8. Implementation Readiness Check

| Item | Estado |
|------|--------|
| Patrón de next-intl identificado y validado | ✅ |
| Helper de navigation localizado (`@/i18n/navigation`) | ✅ |
| WasiNavBar analizado — tipo CC confirmado | ✅ |
| Posición desktop y mobile definida con código exacto | ✅ |
| Código completo de LanguageSwitcher.tsx listo | ✅ |
| Diff mínimo en WasiNavBar (solo adiciones) | ✅ |
| Sin cambios en middleware/config | ✅ |

**El Dev puede implementar directamente desde este SDD. No hay ambigüedad.**

---

## Estado del Gate

```
[ ] SPEC_APPROVED — pendiente revisión de Fer
```
