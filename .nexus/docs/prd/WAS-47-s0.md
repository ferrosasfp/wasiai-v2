---
id: WAS-47
title: 'Botón "Ver agentes" en Home hace scroll a sección de agentes'
sprint: 7
epic: Epic 9 — UX Improvements
prioridad: P3
estimacion: XS
estado: PENDIENTE_HU_APPROVED
stepsCompleted: [S0]
---

# S0 — WAS-47: "Ver agentes" scroll en home

## Historia de usuario

> Como visitante de la home, cuando hago clic en el botón "Ver agentes" del hero, quiero que la página haga scroll suave hacia la sección de agentes del marketplace, para no tener que hacer scroll manual.

---

## Contexto técnico

Hoy el botón CTA del hero en `HeroDualCard.tsx` usa un `<Link>` que navega o hace nada visible si ya estás en la home. No hay scroll a la sección de agentes. La sección de agentes en `page.tsx` no tiene `id` de anchor.

---

## Acceptance Criteria

1. El botón **"Ver agentes"** (consumer CTA) en `HeroDualCard` hace **scroll suave** hacia la sección de agentes en la misma página.
2. El scroll usa **`behavior: 'smooth'`** nativo del browser.
3. La sección de agentes en `page.tsx` tiene el atributo **`id="agents"`** como anchor objetivo.
4. En **mobile** el scroll funciona igual.
5. Si el usuario está en **otra ruta** (`/publish`, etc.), el botón navega a `/${locale}#agents` (navegación a home con anchor, no scroll en la misma página).

---

## Scope — Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `src/features/home/components/HeroDualCard.tsx` | Modificar: cambiar `<Link>` a botón con `scrollIntoView` o `href="#agents"` |
| `src/app/[locale]/page.tsx` | Modificar: agregar `id="agents"` al elemento contenedor del grid de agentes |

**Archivos NO tocar:** Nada más — cambio mínimo y quirúrgico.

---

## Dependencias

- **Requiere:** Nada
- **Habilita:** Nada (mejora de UX independiente)

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Ninguno significativo | — | — |

---

## Estimación

**XS (Extra Small)** — ~1 hora de dev. Dos archivos, cambio mínimo.

---

## Definition of Done

- [ ] `npm run build` sin errores TypeScript
- [ ] Clic en "Ver agentes" desde home → scroll suave a sección de agentes
- [ ] Funciona en mobile
- [ ] Desde otra ruta → navega a `/${locale}#agents`
- [ ] `git push origin master master:main`

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
*Sprint 7 — Wallet UX & Marketplace Polish*
