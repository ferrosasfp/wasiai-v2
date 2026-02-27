# SDD — WAS-47: Botón "Ver agentes" hace scroll a sección de agentes

**Estado:** SPEC_PENDING  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P3 | **Estimación:** XS  
**Generado por:** Architect (BMAD Method v6) · 2026-02-27

---

## 1. Análisis del codebase actual

### Hallazgo crítico: `id="agents"` ya existe

`src/app/[locale]/page.tsx` línea 91:
```tsx
<section id="agents" className="px-6 py-12">
```

**El anchor target ya está en su lugar.** Solo falta modificar `HeroDualCard.tsx`.

### Situación actual en HeroDualCard

El botón consumer CTA es un `<Link>` que navega a `/${locale}` — si ya estás en home, el browser hace un full navigation sin scroll:
```tsx
<Link
  href={`/${locale}`}
  onClick={(e) => e.stopPropagation()}
  className={...}
>
  {ctaConsumer} →
</Link>
```

---

## 2. Schema de DB / Endpoints / On-chain

**Ninguno.** Cambio exclusivamente de UI.

---

## 3. Cambios en archivos

### 3.1 HeroDualCard.tsx — MODIFICAR

**Path:** `src/features/home/components/HeroDualCard.tsx`

**Prop nueva:** Ya recibe `locale` — la usaremos para construir el href de cross-route.

**Cambio: reemplazar `<Link>` del consumer CTA por botón con lógica de scroll/navegación:**

```tsx
// ANTES:
<Link
  href={`/${locale}`}
  onClick={(e) => e.stopPropagation()}
  className={...}
>
  {ctaConsumer} →
</Link>

// DESPUÉS:
<ConsumerCTA locale={locale} label={ctaConsumer} isActive={isConsumer} />
```

**Componente helper interno (en el mismo archivo o como función):**

```typescript
// Dentro de HeroDualCard.tsx o como componente local
function ConsumerCTA({ locale, label, isActive }: {
  locale: string
  label: string
  isActive: boolean
}) {
  const pathname = usePathname()
  const isHome = pathname === `/${locale}` || pathname === `/${locale}/`

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (isHome) {
      // Misma página → scroll suave
      const section = document.getElementById('agents')
      section?.scrollIntoView({ behavior: 'smooth' })
    } else {
      // Otra ruta → navegar a home con anchor
      window.location.href = `/${locale}#agents`
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm ${
        isActive
          ? 'bg-avax-500 text-white hover:bg-avax-600'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label} →
    </button>
  )
}
```

**Imports nuevos necesarios:**
```typescript
import { usePathname } from 'next/navigation'
// HeroDualCard ya es 'use client' → usePathname disponible
```

**Alternativa más simple (href con anchor):**

Si se prefiere evitar lógica JS:
```tsx
<a
  href={`/${locale}#agents`}
  onClick={(e) => {
    e.stopPropagation()
    const isHome = window.location.pathname === `/${locale}` || window.location.pathname === `/${locale}/`
    if (isHome) {
      e.preventDefault()
      document.getElementById('agents')?.scrollIntoView({ behavior: 'smooth' })
    }
    // Si no es home → href navega normalmente a /${locale}#agents
  }}
  className={...}
>
  {ctaConsumer} →
</a>
```

**Recomendación:** Usar la alternativa con `<a>` — más semántico, funciona con JS desactivado (navegación al anchor), y el código es más simple.

### 3.2 page.tsx — SIN CAMBIOS

El `id="agents"` ya existe. ✅

---

## 4. Flujo completo

```
Usuario en Home → Click "Ver agentes"
  ↓
pathname === /${locale} → isHome = true
  ↓
e.preventDefault() + document.getElementById('agents').scrollIntoView({ behavior: 'smooth' })
  ↓
Scroll suave a sección de agentes ✓

Usuario en /publish → Click "Ver agentes"
  ↓
pathname !== /${locale} → isHome = false
  ↓
href="/${locale}#agents" → navegación full page → landing en sección #agents ✓
```

---

## 5. Consideraciones mobile

`scrollIntoView({ behavior: 'smooth' })` funciona en todos los browsers modernos incluyendo Safari mobile (iOS 15.4+). No se requiere polyfill.

---

## 6. Definition of Done

- [ ] Click en "Ver agentes" desde home → scroll suave a `id="agents"` ✓
- [ ] Scroll usa `behavior: 'smooth'` nativo ✓
- [ ] `id="agents"` en `page.tsx` ya existe (no requiere cambio) ✓
- [ ] Funciona en mobile (iOS/Android) ✓
- [ ] Desde `/publish` u otra ruta → navega a `/${locale}#agents` ✓
- [ ] `npm run build` sin errores TypeScript ✓
- [ ] Sin warnings ESLint ✓
- [ ] `git push origin master master:main`

---

## 7. Implementation Readiness Check

| Item | Estado |
|------|--------|
| `id="agents"` en page.tsx | ✅ Ya existe |
| HeroDualCard es `'use client'` | ✅ Ya tiene el directive |
| `usePathname` disponible | ✅ next/navigation |
| Sin cambios de backend | ✅ Confirmado |
| Sin dependencias externas | ✅ Solo DOM nativo |

**Veredicto: IMPLEMENTABLE en ~30 minutos.** Cambio quirúrgico en un componente, sin riesgos.

---

*Generado por Architect (BMAD v6) · Sprint 7 · 2026-02-27*
