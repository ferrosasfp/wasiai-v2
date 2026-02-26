---
title: SDD — HU-9.6 Hero Copy — Reemplazar "modelos" por "agentes"
fecha: 2026-02-26
hu_origen: HU-9.6
linear: WAS-31
HU_APPROVED: yes
SPEC_APPROVED: yes
---

## Objetivo
Reemplazar todas las referencias a "modelo/model" en el namespace `home` de los archivos i18n por "agente/agent". El hero principal (heroTitle, heroSubtitle, ctaCreator, ctaConsumer) ya tiene copy correcto — no se toca.

---

## Rutas / Endpoints
Ninguna — cambio de copy puro.

## Schema de DB
Ninguno.

## Interacciones on-chain
Ninguna.

---

## Archivos a modificar

### `messages/es.json` — namespace `home`

Claves a cambiar (solo estas, no tocar heroTitle/heroSubtitle/heroDescription/ctaCreator/ctaConsumer):

```json
"availableModels": "Agentes Disponibles",
"browseModels":    "Ver Agentes",
"publishModel":    "Publicar un Agente →",
"modelsCount":     "{total} agentes · página {page} de {total_pages}",
"noModels":        "Sin agentes todavía.",
"noModelsFiltered":"Ningún agente coincide con tus filtros.",
"step2Label":      "2. Descubrir agentes",
"step3Label":      "3. Invocar y pagar"
```

### `messages/en.json` — namespace `home`

```json
"availableModels": "Available Agents",
"browseModels":    "Browse Agents",
"publishModel":    "Publish an Agent →",
"modelsCount":     "{total} agents · page {page} of {total_pages}",
"noModels":        "No agents yet.",
"noModelsFiltered":"No agents match your filters.",
"step2Label":      "2. Discover agents",
"step3Label":      "3. Invoke & pay"
```

### `src/app/[locale]/page.tsx`
Verificar que no haya strings hardcodeadas con "model/modelo" — todo debe ir via `t()`. Sin cambios de lógica.

---

## Flujos
Cambio de copy — sin flujos de usuario nuevos.

---

## Definition of Done
- [ ] Todas las referencias a "modelo/model" en namespace `home` reemplazadas por "agente/agent"
- [ ] `heroTitle`, `heroSubtitle`, `ctaCreator`, `ctaConsumer` NO modificados
- [ ] `es` y `en` sincronizados (mismas claves)
- [ ] Ninguna cadena con "modelo/model" hardcodeada en `page.tsx`
- [ ] `npm run build` sin errores TS ni ESLint warnings

---

## Assumptions
- La estructura del hero no cambia — solo texto en i18n
- `beFirst` ("Sé el primero en publicar →") no requiere cambio — ya es neutral

## Open Questions
Ninguna.
