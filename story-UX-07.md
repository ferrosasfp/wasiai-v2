# Story UX-07 — Hero copy dual creator/consumer

**Estado:** In Progress  
**Fecha:** 2026-02-26  
**Sprint:** 3

---

## Historia

Como visitante nuevo en wasiai-v2.vercel.app,
quiero entender en 5 segundos qué hace WasiAI y si es para mí,
para decidir si me registro o sigo explorando.

---

## Acceptance Criteria

- [ ] Hero tiene mensajes claros para creators y consumers
- [ ] CTA diferenciado por perfil
- [ ] Tagline principal actualizado
- [ ] Copy en inglés y español (ambos archivos i18n)
- [ ] Mobile responsive sin cambios de layout

---

## Archivos a modificar

```
src/
├── app/[locale]/(marketing)/page.tsx   # componente Hero
├── messages/en.json                    # copy en inglés
└── messages/es.json                    # copy en español (si existe)
```

---

## Copy definitivo

**Headline principal:**
> "The Home of AI Agents"

**Subtítulo dual (tabs o split visual):**
- Creator: *"Publish your AI agent and get paid automatically — no invoicing, no friction."*
- Consumer: *"Find the right AI agent and integrate it in minutes — with one API key."*

**CTAs:**
- Creator: `Publish your agent →` → `/publish`
- Consumer: `Browse agents →` → `/` (marketplace)

**Tagline secundaria:**
> *"Powered by Avalanche. Built for the agentic economy."*

---

## Keys i18n

```json
// en.json — agregar/actualizar:
"hero.headline": "The Home of AI Agents",
"hero.subtitle.creator": "Publish your AI agent and get paid automatically — no invoicing, no friction.",
"hero.subtitle.consumer": "Find the right AI agent and integrate it in minutes — with one API key.",
"hero.cta.creator": "Publish your agent",
"hero.cta.consumer": "Browse agents",
"hero.tagline": "Powered by Avalanche. Built for the agentic economy."
```

```json
// es.json — equivalente en español:
"hero.headline": "El Hogar de los Agentes de IA",
"hero.subtitle.creator": "Publica tu agente de IA y cobra automáticamente — sin facturas, sin fricción.",
"hero.subtitle.consumer": "Encuentra el agente que necesitas e intégralo en minutos — con una sola API key.",
"hero.cta.creator": "Publica tu agente",
"hero.cta.consumer": "Ver agentes",
"hero.tagline": "Powered by Avalanche. Construido para la economía agéntica."
```

---

## Implementación del componente

- Dos cards/tabs lado a lado en desktop
- Stack vertical en mobile
- Toggle: "Consumer" activo por defecto
- Sin animaciones complejas — clean y rápido
- Usar clases Tailwind existentes (colores `avax` del proyecto)

---

## DoD

- [ ] `npm run build` sin errores
- [ ] Hero renderiza correctamente en desktop y mobile
- [ ] `en.json` y `es.json` actualizados con todas las keys
- [ ] Copy refleja exactamente los strings de este story
- [ ] No rompe ninguna otra sección de la página
