---
id: HU-4.2
title: Filtros avanzados en marketplace (tipo agente, precio max, categoría)
sprint: 7
epic: Epic 4 — Discovery y Calidad del Catálogo
prioridad: P2
estimacion: M
estado: PENDIENTE_HU_APPROVED
stepsCompleted: [S0]
---

# S0 — HU-4.2: Filtros avanzados marketplace (solo UI)

## Historia de usuario

> Como usuario explorando el marketplace, quiero poder filtrar agentes por tipo (LLM, RAG, tool, etc.), precio máximo y categoría combinados, para encontrar exactamente el agente que necesito sin revisar todo el catálogo.

---

## Contexto técnico

La API `/api/v1/agents` **ya acepta** los parámetros `category`, `agent_type`, `max_price`, y `q`. Esta HU es **exclusivamente implementación de UI** — sin cambios en backend ni en la API.

El filtro de categoría ya existe de forma básica. Se necesita: (1) unificarlo en un `FilterPanel` central, (2) agregar selector de `agent_type`, (3) agregar input de `max_price`.

---

## Acceptance Criteria

1. El marketplace muestra un **panel/row de filtros** con: selector de categoría (integrado del existente), selector de tipo de agente (`agent_type`), y input de precio máximo (`max_price` en USDC).
2. Los filtros son **acumulables** — categoría + tipo + precio máximo funcionan juntos en la misma query hacia la API.
3. La **URL refleja los filtros activos** como query params: `?category=X&agent_type=Y&max_price=Z` — compatible con back/forward del browser.
4. Cuando hay filtros activos, se muestra un botón **"Limpiar filtros"** visible.
5. Los **tipos de agente** disponibles: `llm`, `rag`, `tool`, `multimodal`, `code` — mostrados como chips o select.
6. El **filtro de precio máximo** acepta valores entre `0` y `10` USDC con pasos de `0.10`.
7. Los filtros **no causan full page reload** — usan `router.push` con los params actualizados (Next.js shallow navigation).
8. Los filtros tienen **traducciones en es/en**.
9. Confirmado: la API ya soporta estos params — **zero cambios de backend**.

---

## Scope — Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `src/features/models/components/FilterPanel.tsx` | **Crear**: componente central con todos los filtros integrados |
| `src/features/models/components/CategoryFilter.tsx` | Modificar o integrar dentro de `FilterPanel` (sin duplicar lógica URL params) |
| `src/app/[locale]/page.tsx` | Modificar: leer nuevos `searchParams` (`agent_type`, `max_price`) y pasarlos a `getModels` |
| `src/features/models/services/models.service.ts` | Modificar: agregar `agent_type` y `max_price` a la función `getModels` y al fetch a la API |
| `src/messages/en.json` | Agregar claves i18n para labels de filtros |
| `src/messages/es.json` | Agregar claves i18n para labels de filtros |

**Archivos NO tocar:**
- API routes — sin cambios de backend
- DB, contratos — sin cambios

---

## Dependencias

- **Requiere:** Nada (API ya lista con todos los params)
- **Habilita:** Mejor discovery — usuarios encuentran agentes específicos sin revisar todo el catálogo

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Slider de precio en SSR puede ser complejo / hydration mismatch | Media | Usar `<input type="number">` en lugar de slider para simplicidad y compatibilidad SSR |
| Compatibilidad con `CategoryFilter` existente — evitar duplicar lógica de URL params | Media | Integrar `CategoryFilter` dentro de `FilterPanel` como subcomponente; un solo punto de `router.push` |
| `getModels` service puede no pasar correctamente `max_price` como número | Baja | Parsear `searchParams.max_price` con `parseFloat` y validar `isNaN` antes de pasar a la API |

---

## Estimación

**M (Medium)** — ~1 día de dev. Crear `FilterPanel`, integrar `CategoryFilter`, actualizar service + page, i18n. Sin backend.

---

## Definition of Done

- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Filtros de categoría + tipo de agente + precio máximo visibles y funcionales
- [ ] Filtros acumulables — combinación de 3 funciona correctamente
- [ ] URL refleja filtros activos como query params
- [ ] Botón "Limpiar filtros" aparece cuando hay filtros activos
- [ ] No hay full page reload al cambiar filtros
- [ ] Traducciones en es/en
- [ ] `git push origin master master:main`

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
*Sprint 7 — Wallet UX & Marketplace Polish*
