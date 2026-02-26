# Story HU-2.3 — Documentación interactiva (`/docs`)

**Estado:** Todo  
**Fecha:** 2026-02-26  
**Sprint:** 3

---

## Historia

Como developer que quiere integrar WasiAI,
quiero una página `/docs` clara con ejemplos ejecutables,
para entender la API en minutos y empezar a integrar sin fricción.

---

## Acceptance Criteria

- [ ] Página `/docs` accesible públicamente (sin auth)
- [ ] Quickstart con los 3 SDKs: Node.js, Python, curl
- [ ] Referencia de endpoints: invoke, agents.list, agents.get, register
- [ ] Sección de errores con todos los códigos y su significado
- [ ] Ejemplos de código con syntax highlighting
- [ ] "Try it" inline — el developer pega su API key (real, guardada en localStorage) y ejecuta desde el browser
- [ ] Navegación lateral con secciones (Quickstart, SDK Node, SDK Python, API Reference, Errors)
- [ ] Mobile responsive — sidebar colapsable

---

## Estructura de archivos

```
src/
├── app/[locale]/docs/
│   ├── page.tsx                  # layout principal con nav lateral
│   └── layout.tsx                # sidebar + content layout
├── features/docs/
│   ├── components/
│   │   ├── DocsSidebar.tsx       # navegación lateral con scroll spy
│   │   ├── CodeBlock.tsx         # syntax highlighting (tabs Node/Python/curl)
│   │   ├── TryIt.tsx             # widget interactivo (client component)
│   │   └── EndpointCard.tsx      # tarjeta de endpoint con params y respuesta
│   └── content/
│       ├── quickstart.tsx        # sección Quickstart
│       ├── sdk-node.tsx          # sección SDK Node.js
│       ├── sdk-python.tsx        # sección SDK Python
│       ├── api-reference.tsx     # sección API Reference
│       └── errors.tsx            # sección Errores
messages/
├── en.json                       # keys docs.*
└── es.json                       # keys docs.*
```

---

## Secciones y contenido

| Sección | Contenido |
|---|---|
| Quickstart | Install SDK, primera llamada en 3 líneas, curl alternativo |
| SDK Node.js | Install, init, invoke, agents.list, agents.get, error handling |
| SDK Python | Mismo contenido en Python |
| API Reference | POST invoke, GET agents, GET agents/:slug, POST register — params, headers, respuesta |
| Errors | Tabla: código HTTP → excepción → descripción → solución |

---

## TryIt widget

- Input: API key del usuario (guardada en `localStorage`, nunca enviada al servidor de logs)
- Input: slug del agente (dropdown con agentes del catálogo — fetch a GET /api/v1/agents)
- Input: payload JSON (textarea con ejemplo pre-llenado según el agente seleccionado)
- Output: respuesta del agente en tiempo real con latencia mostrada
- Endpoint: `POST /api/v1/agents/[slug]/invoke` con header `X-API-Key`
- CORS: ya soportado por el backend — browser fetch directo

---

## Navegación lateral

- Links ancla a cada sección: `#quickstart`, `#sdk-node`, `#sdk-python`, `#api-reference`, `#errors`
- Scroll spy: resalta la sección activa al hacer scroll
- Desktop: sticky sidebar izquierdo
- Mobile: botón hamburguesa que abre sidebar como drawer

---

## Keys i18n

```json
// en.json — agregar sección "docs":
"docs": {
  "title": "Documentation",
  "quickstart": "Quickstart",
  "sdkNode": "SDK Node.js",
  "sdkPython": "SDK Python",
  "apiRef": "API Reference",
  "errors": "Errors",
  "tryIt": "Try it",
  "tryItApiKey": "Your API Key",
  "tryItSlug": "Agent slug",
  "tryItPayload": "Input payload (JSON)",
  "tryItRun": "Run",
  "tryItResponse": "Response",
  "tryItLatency": "Latency"
}
```

```json
// es.json — equivalente:
"docs": {
  "title": "Documentación",
  "quickstart": "Inicio rápido",
  "sdkNode": "SDK Node.js",
  "sdkPython": "SDK Python",
  "apiRef": "Referencia de API",
  "errors": "Errores",
  "tryIt": "Pruébalo",
  "tryItApiKey": "Tu API Key",
  "tryItSlug": "Slug del agente",
  "tryItPayload": "Payload de entrada (JSON)",
  "tryItRun": "Ejecutar",
  "tryItResponse": "Respuesta",
  "tryItLatency": "Latencia"
}
```

---

## Notas de implementación

- Syntax highlighting: usar `highlight.js` o `shiki` (ligero, sin deps pesadas)
- Contenido en componentes React estáticos — sin MDX ni CMS externo
- `TryIt.tsx` es `'use client'` — el resto puede ser server components
- La API key nunca sale del browser (solo va como header al invoke endpoint)
- Agregar link a `/docs` en la navbar principal

---

## DoD

- [ ] `npm run build` sin errores
- [ ] Página `/docs` accesible sin auth en producción
- [ ] Los 3 tabs de código (Node.js / Python / curl) funcionan y tienen syntax highlighting
- [ ] TryIt hace fetch real al backend y muestra respuesta + latencia
- [ ] Navegación lateral con scroll spy funciona en desktop
- [ ] Mobile: sidebar colapsable como drawer, contenido legible
- [ ] Keys i18n completas en `en.json` y `es.json`
- [ ] Link a `/docs` en la navbar
