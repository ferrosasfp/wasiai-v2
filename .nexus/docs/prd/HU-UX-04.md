# HU-UX-04 — Sección "Cómo usar" en página de detalle del agente

**Estado:** S0 — Historia de Usuario  
**Fecha:** 2026-02-26  
**Epic:** UX — Experiencia del Developer  
**Prioridad:** Alta  

---

## Historia de Usuario

**Como** developer que llega a la página de detalle de un agente en WasiAI,  
**quiero** ver una sección "Cómo usar" con ejemplos de código listos para copiar (curl, Node.js, Python) generados automáticamente con el slug y precio del agente,  
**para** integrar el agente en mi sistema sin necesidad de consultar documentación externa ni modificar manualmente los snippets.

---

## Acceptance Criteria

### AC-1 — Sección visible en la página de detalle
- [ ] La sección "Cómo usar" (o "How to use") aparece en la página `/[locale]/models/[slug]` para **todos** los agentes (gratuitos y de pago).
- [ ] La sección se posiciona en la columna principal, debajo del playground de prueba (HU-3.1) y antes del bloque "Agent API".

### AC-2 — Tabs de lenguaje
- [ ] La sección presenta exactamente 3 tabs: `curl`, `Node.js`, `Python`.
- [ ] El tab activo por defecto es `curl`.
- [ ] Cambiar de tab no causa re-render de la página ni llama a ninguna API.

### AC-3 — Snippets correctamente generados
- [ ] El snippet de cada lenguaje contiene la URL de invocación correcta: `${BASE_URL}/api/v1/agents/{slug}/invoke`.
- [ ] Si el agente tiene `price_per_call > 0`, el snippet **no** incluye `# free agent` ni omite la línea del API key.
- [ ] Si el agente es gratuito (`price_per_call == 0` o `null`), el snippet incluye un comentario visible indicando que es gratuito (ej. `# free agent`).
- [ ] El campo `input` del snippet usa el primer ejemplo de capability del agente (`capabilities[0].example.input`); si no existe, usa `"Hello, world!"` como fallback.

### AC-4 — Copiar al portapapeles
- [ ] Cada tab tiene un botón "Copy" visible.
- [ ] Al hacer click, el código del tab activo se copia al portapapeles (`navigator.clipboard.writeText`).
- [ ] El botón muestra feedback visual (ej. "Copied!" por 2 segundos) tras copiar exitosamente.
- [ ] Si `clipboard API` no está disponible (HTTP sin HTTPS), no lanza excepción no manejada.

### AC-5 — Código listo para usar sin modificaciones
- [ ] El único placeholder que requiere reemplazo manual es `wasi_YOUR_KEY` (imposible generarlo sin auth).
- [ ] Un comment en el snippet indica dónde obtener la key: URL `/en/agent-keys` o equivalente localizado.
- [ ] No hay placeholders adicionales como `YOUR_SLUG`, `YOUR_INPUT`, o `BASE_URL`.

### AC-6 — Internacionalización
- [ ] El título de la sección y los textos estáticos (ej. label del botón Copy, comentario de free agent) están en `messages/es.json` y `messages/en.json`.
- [ ] El locale activo de la página determina el idioma de los textos; el código en sí permanece en inglés.

### AC-7 — Compatibilidad con ISR
- [ ] El componente `CodeExamples` es un **Server Component** (sin `'use client'`).
- [ ] Solo el sub-componente de tabs e interactividad (`CodeExamplesTabs`) tiene `'use client'`.
- [ ] La página mantiene `export const revalidate = 300`.

---

## Scope

### Incluye
- Componente `CodeExamples` (Server Component): genera strings de código en servidor.
- Componente `CodeExamplesTabs` (Client Component): tabs + botón copy.
- Lógica de generación de snippets: función pura `generateSnippets(slug, priceUsdc, inputExample)`.
- Soporte de los 3 lenguajes: curl, Node.js, Python.
- Fallback de input cuando no hay `capabilities[0].example.input`.
- Comentario "free agent" cuando `price_per_call === 0`.
- Textos en i18n (es/en).
- Integración en `page.tsx` del detalle del agente con props correctas desde `model`.

### NO incluye (Out of Scope)
- Soporte de lenguajes adicionales (Go, Ruby, PHP, etc.) — roadmap futuro.
- Snippets con x402 direct payment — ya cubierto por el bloque "Agent API" existente en la misma página.
- SDK oficial `@wasiai/sdk` — puede mencionarse como comentario pero no se implementa en esta HU.
- Tests de integración o E2E para la sección — se cubre en S2 si el SM lo incluye.
- Personalización de snippets por el creator.
- Modo dark/light diferenciado — ya asumido dark (`bg-gray-900`) consistente con el resto de la página.
- Soporte para agentes con múltiples endpoints o métodos HTTP distintos.

---

## Riesgos

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|-------------|---------|------------|
| R1 | `BASE_URL` en cliente expone la URL de producción en el bundle JS | Baja | Baja | `BASE_URL` se calcula solo en Server Component; no se pasa al cliente como variable, solo como string ya interpolado en el snippet |
| R2 | `navigator.clipboard` no disponible en contexto HTTP (localhost sin HTTPS) | Media | Baja | Try/catch en el handler de copy; fallback silencioso o selección manual |
| R3 | El `input` de ejemplo contiene caracteres que rompen el template literal del snippet (ej. comillas, backslashes) | Media | Media | Sanitizar `inputExample` con `JSON.stringify()` o escape de comillas antes de interpolarlo en el snippet |
| R4 | La URL del endpoint usa `/agents/` pero la API usa `/models/` o viceversa — inconsistencia ya presente en el codebase | Alta | Alta | **Verificar antes de implementar** cuál es el path correcto en producción (`/api/v1/models/` vs `/api/v1/agents/`). El snippet debe coincidir exactamente con el endpoint real |
| R5 | Componente marcado como Server Component pero usa hooks o state indirectamente | Baja | Media | Review de imports; `CodeExamplesTabs` debe ser el único con `'use client'` |

---

## Notas técnicas para S1

- **Riesgo R4 es bloqueante:** Revisar si el endpoint de producción es `/api/v1/models/{slug}/invoke` o `/api/v1/agents/{slug}/invoke` antes de escribir el spec. El `page.tsx` actual construye `invokeUrl` con `/models/` pero `CodeExamples.tsx` genera snippets con `/agents/`. Hay inconsistencia.
- Props necesarias desde `page.tsx`: `slug` (string), `priceUsdc` (string|null), `inputExample` (string|null) — ya disponibles desde `model`.
- El componente ya existe en `src/features/models/components/CodeExamples.tsx` y `CodeExamplesTabs.tsx`. S1 debe evaluar si la implementación actual cumple todos los AC o requiere ajustes.

---

*Generado por PM Agent — BMAD Method v6*
