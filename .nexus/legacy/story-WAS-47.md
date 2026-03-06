# Story WAS-47: Botón "Ver agentes" hace scroll suave a sección de agentes

**Status:** ready-for-dev  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P3 | **Estimación:** XS (~30–60 minutos)  
**Dependencias:** Ninguna

---

## Historia de usuario

Como visitante de la home, cuando hago clic en el botón "Ver agentes" del hero, quiero que la página haga scroll suave hacia la sección de agentes del marketplace, para no tener que hacer scroll manual.

---

## Acceptance Criteria

1. El botón **"Ver agentes"** (consumer CTA) en `HeroDualCard` hace **scroll suave** hacia la sección de agentes en la misma página.
2. El scroll usa **`behavior: 'smooth'`** nativo del browser.
3. La sección de agentes en `page.tsx` tiene el atributo **`id="agents"`** como anchor objetivo (ya existe — verificar).
4. En **mobile** el scroll funciona igual que en desktop.
5. Si el usuario está en **otra ruta** (`/publish`, etc.), el botón navega a `/${locale}#agents` (navegación a home con anchor).

---

## Hallazgo crítico — el anchor ya existe

**`src/app/[locale]/page.tsx` línea ~91 ya tiene:**
```tsx
<section id="agents" className="px-6 py-12">
```

**El `id="agents"` ya está en su lugar. No hay que tocar `page.tsx`.**

---

## Estructura de archivos

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---------|--------|
| `src/features/home/components/HeroDualCard.tsx` | Reemplazar `<Link>` del consumer CTA por `<a>` con scroll lógico |

### Archivos NO tocar:
- `src/app/[locale]/page.tsx` — `id="agents"` ya existe ✅
- Nada más — cambio mínimo y quirúrgico

---

## Cambio exacto en `HeroDualCard.tsx`

### Situación actual (buscar en el archivo):

```tsx
// Botón consumer CTA actual — algo similar a esto:
<Link
  href={`/${locale}`}
  onClick={(e) => e.stopPropagation()}
  className={...}
>
  {ctaConsumer} →
</Link>
```

### Reemplazar por:

```tsx
<a
  href={`/${locale}#agents`}
  onClick={(e) => {
    e.stopPropagation()
    // Si ya estamos en home → scroll suave (no navegación)
    const isHome =
      window.location.pathname === `/${locale}` ||
      window.location.pathname === `/${locale}/`
    if (isHome) {
      e.preventDefault()
      document.getElementById('agents')?.scrollIntoView({ behavior: 'smooth' })
    }
    // Si no es home → href="/${locale}#agents" navega normalmente al anchor
  }}
  className={/* mismas clases que tenía el Link anterior */}
>
  {ctaConsumer} →
</a>
```

**Imports:** No se necesitan nuevos imports. `HeroDualCard.tsx` ya es `'use client'`. DOM nativo puro.

---

## Notas de implementación

### ¿Por qué `<a>` en lugar de botón con usePathname?

La solución con `<a href="...#agents">` es:
- Más semántica (enlace real)
- Funciona con JS desactivado (navega al anchor)
- Más simple — sin imports adicionales (`usePathname`, `useRouter`)
- `e.preventDefault()` solo cuando es home, dejando el comportamiento nativo para otras rutas

### Verificar las clases CSS actuales del Link
El `<a>` debe tener **exactamente las mismas clases** que el `<Link>` que reemplaza. Buscar en el archivo las clases del botón consumer CTA (probablemente algo como `bg-avax-500 text-white rounded-xl px-5 py-2.5 ...`).

### `scrollIntoView` en mobile
`scrollIntoView({ behavior: 'smooth' })` funciona en todos los browsers modernos incluyendo Safari iOS 15.4+. Sin polyfill necesario.

### Preservar `e.stopPropagation()`
`HeroDualCard` tiene un `onClick` en el card que puede interferir. El `stopPropagation()` del CTA debe mantenerse.

---

## Flujo completo

```
Usuario en Home (/${locale}) → Click "Ver agentes"
  ↓
onClick: isHome = true → e.preventDefault()
  ↓
document.getElementById('agents').scrollIntoView({ behavior: 'smooth' })
  ↓
Scroll suave a <section id="agents"> ✓

Usuario en /publish → Click "Ver agentes"
  ↓
onClick: isHome = false → NO preventDefault
  ↓
href="/${locale}#agents" → navegación al anchor en home ✓
```

---

## DoD — Definition of Done

- [ ] Clic en "Ver agentes" desde home → scroll suave a `id="agents"` ✓
- [ ] Scroll usa `behavior: 'smooth'` nativo ✓
- [ ] `id="agents"` en `page.tsx` confirmado (ya existía — no se cambió) ✓
- [ ] Funciona en mobile (iOS/Android) ✓
- [ ] Desde `/publish` u otra ruta → navega a `/${locale}#agents` ✓
- [ ] `npm run build` sin errores TypeScript ✓
- [ ] Sin warnings ESLint ✓
- [ ] `git push origin master master:main`

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
_(completar al implementar)_

### File List
- `src/features/home/components/HeroDualCard.tsx` — MODIFICADO
