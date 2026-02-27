---
id: HU-9.1
title: Empty state cuando búsqueda retorna 0 resultados
sprint: 7
epic: Epic 9 — UX Improvements
prioridad: P2
estimacion: S
estado: PENDIENTE_HU_APPROVED
stepsCompleted: [S0]
---

# S0 — HU-9.1: Empty state búsqueda sin resultados

## Historia de usuario

> Como usuario buscando agentes, cuando mi búsqueda no encuentra resultados, quiero ver una pantalla amigable con sugerencias de agentes populares, para no quedarme con una página vacía y poder descubrir agentes relevantes.

---

## Contexto técnico

Hoy cuando una búsqueda retorna 0 agentes, `page.tsx` renderiza el grid vacío — sin mensaje, sin sugerencias, sin CTA. La API ya retorna `[]` correctamente; solo falta la UI que maneje ese estado.

---

## Acceptance Criteria

1. Cuando `models.length === 0` **y hay un término de búsqueda activo** (`search` query param presente), se muestra el componente `EmptySearchState` en lugar del grid vacío.
2. El `EmptySearchState` muestra: **icono** + **mensaje** `"No encontramos agentes para '{search}'"` + sugerencia de limpiar filtros.
3. El empty state incluye hasta **4 agentes sugeridos** (más populares/llamados) cargados desde el mismo endpoint con `limit=4` sin filtros.
4. Hay un botón **"Ver todos los agentes"** que limpia la búsqueda y vuelve al marketplace completo.
5. Si hay **filtro de categoría activo también**, el mensaje sugiere adicionalmente quitar el filtro de categoría.
6. El componente tiene **traducciones en es/en**.

---

## Scope — Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `src/features/models/components/EmptySearchState.tsx` | **Crear**: componente con icono, mensaje, sugerencias, CTA |
| `src/app/[locale]/page.tsx` | Modificar: renderizar `EmptySearchState` condicionalmente cuando `models.length === 0 && search` |
| `src/messages/en.json` | Agregar claves i18n |
| `src/messages/es.json` | Agregar claves i18n |

**Archivos NO tocar:**
- API, DB, modelos — sin cambios de backend
- `ModelCard.tsx` — se reutiliza sin modificación para los agentes sugeridos

---

## Dependencias

- **Requiere:** Nada
- **Habilita:** Mejor conversión — usuarios que no encuentran nada descubren agentes relevantes

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Segunda llamada a `getModels` para agentes sugeridos puede ser costosa | Media | Hacer la llamada en el mismo Server Component de `page.tsx` condicionalmente; son 4 agentes, cacheados por Next.js |
| Si no hay agentes en DB, los sugeridos también son `[]` | Baja | Mostrar empty state sin sección de sugerencias si el segundo fetch también retorna vacío |

---

## Estimación

**S (Small)** — ~4 horas de dev. Crear componente, integrar en page.tsx, i18n. Sin backend.

---

## Definition of Done

- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Búsqueda sin resultados → `EmptySearchState` visible con mensaje correcto
- [ ] Agentes sugeridos aparecen (hasta 4)
- [ ] Botón "Ver todos los agentes" limpia la búsqueda
- [ ] Traducciones en es/en funcionando
- [ ] `git push origin master master:main`

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
*Sprint 7 — Wallet UX & Marketplace Polish*
