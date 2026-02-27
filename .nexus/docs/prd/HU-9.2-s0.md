---
id: HU-9.2
title: Preview live en /publish (creator ve la card en tiempo real)
sprint: 7
epic: Epic 9 — UX Improvements
prioridad: P2
estimacion: M
estado: PENDIENTE_HU_APPROVED
stepsCompleted: [S0]
---

# S0 — HU-9.2: Preview live en /publish

## Historia de usuario

> Como creator publicando un agente, mientras lleno el formulario de publicación, quiero ver una preview en tiempo real de cómo quedará la card de mi agente en el marketplace, para asegurarme de que se ve profesional antes de publicar.

---

## Contexto técnico

La página `/publish` tiene `PublishForm.tsx`. Hoy el creator no tiene ningún feedback visual de cómo quedará su agente hasta que lo publica. `ModelCard.tsx` existe en el marketplace y puede reutilizarse para la preview si se le pasan datos parciales de forma segura.

---

## Acceptance Criteria

1. En la página `/publish`, hay un **panel lateral** (desktop) o **sección inferior** (mobile) que muestra una `ModelCard` con los datos del formulario en tiempo real.
2. La preview se actualiza con **cada keystroke** — debounce ≤ 200ms si aplica.
3. **Campos reflejados** en la preview: nombre, descripción, precio, categoría, slug (para badge), imagen placeholder si no hay imagen subida.
4. Si un campo requerido está **vacío**, la preview muestra un **placeholder en gris** — sin error, sin crash.
5. La preview está claramente **etiquetada como "Preview"** con un badge o label visible.
6. En **mobile**, la preview es **collapsible** (toggle "Ver preview" / "Ocultar preview").
7. La preview usa **exactamente el mismo componente `ModelCard`** del marketplace — sin duplicación de código ni componente alternativo.

---

## Scope — Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `src/app/[locale]/publish/PublishForm.tsx` | Modificar: agregar estado del formulario y pasar datos a `PublishPreview`; puede requerir conversión a Client Component |
| `src/features/publish/components/PublishPreview.tsx` | **Crear**: wrapper que recibe datos del formulario y renderiza `ModelCard` |
| `src/features/models/components/ModelCard.tsx` | Verificar: acepta datos parciales sin crashear; agregar defaults defensivos si falta |
| `src/messages/en.json` | Agregar clave i18n para label "Preview" |
| `src/messages/es.json` | Agregar clave i18n para label "Preview" |

**Archivos NO tocar:**
- API, DB — sin cambios de backend
- Lógica de publicación existente — no romper el flujo actual

---

## Dependencias

- **Requiere:** Nada (`ModelCard` ya existe)
- **Habilita:** Mejor calidad de publicaciones — creators ven el resultado antes de publicar

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| `PublishForm.tsx` puede ser Server Component → no puede tener `useState` | Alta | Convertir a Client Component o extraer la lógica de preview a un componente hijo `'use client'` que recibe los valores del formulario via props/context |
| `ModelCard` puede asumir que todos los campos están presentes → crash con datos parciales | Alta | Revisar todos los accesos a props en `ModelCard`; agregar `?? ''` o `?? 0` como defaults; probar con objeto vacío |
| Layout desktop: panel lateral puede romper el layout actual | Media | Usar CSS grid 2 columnas en desktop, stack en mobile; verificar en breakpoints |

---

## Estimación

**M (Medium)** — ~1 día de dev. Requiere conversión de componente + crear preview wrapper + validar ModelCard con datos parciales + i18n + layout responsive.

---

## Definition of Done

- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Panel de preview visible en desktop, collapsible en mobile
- [ ] Campos del formulario se reflejan en la preview en tiempo real
- [ ] `ModelCard` no crashea con datos parciales
- [ ] Label "Preview" visible
- [ ] Traducciones en es/en
- [ ] `git push origin master master:main`

---

*Generado por PM John (BMAD Method v6) · 2026-02-27*
*Sprint 7 — Wallet UX & Marketplace Polish*
