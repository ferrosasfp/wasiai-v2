# S0 — HU-7.4: Documentación MCP para Claude Desktop y Cursor

**Epic:** E7 — Integraciones con Ecosistema AI  
**Sprint:** 5  
**Prioridad:** P1 (Build Games: demuestra que WasiAI es parte del ecosistema AI)  
**Estimado:** 0.5–1 día  
**Estado:** PENDING_HU_APPROVED

---

## Historia de Usuario

Como developer que usa Claude Desktop o Cursor,  
quiero una guía paso a paso para conectar WasiAI como MCP server en mi herramienta,  
para poder invocar agentes del marketplace directamente desde mi editor o asistente de IA.

---

## Contexto y Motivación

WasiAI ya tiene un MCP server funcional con pagos reales via agent keys. Falta la documentación que le dice a los developers cómo usarlo. Para el Build Games, esto demuestra que WasiAI es un ciudadano de primera clase del ecosistema de agentes IA (MCP es el estándar que Claude, Cursor y decenas de herramientas están adoptando).

Fer creó su primer agente hoy. La documentación MCP permite que alguien más lo integre mañana.

---

## Criterios de Aceptación (ACs)

### AC1 — Página de documentación MCP en el sitio
- [ ] Nueva página en `/[locale]/docs/mcp` (o `/docs/mcp` si no hay estructura de docs aún)
- [ ] Accesible desde el navbar o footer (link "MCP Docs" o "Integrations")
- [ ] Renderizada con Next.js (no CDN externo), misma UI del sitio

### AC2 — Guía para Claude Desktop
- [ ] Sección "Claude Desktop" con pasos numerados:
  1. Obtener una API key de WasiAI (`/creator/dashboard` → API Keys)
  2. Editar `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) o path equivalente en Windows/Linux
  3. Agregar el bloque de configuración con el server de WasiAI
  4. Reiniciar Claude Desktop
  5. Verificar: buscar el ícono de MCP en Claude → herramientas de WasiAI disponibles
- [ ] Bloque de código JSON copiable con la configuración exacta del MCP server
- [ ] Incluye: `command`, `args`, `env` con `WASIAI_API_KEY` como variable

### AC3 — Guía para Cursor
- [ ] Sección "Cursor" con pasos equivalentes para `.cursor/mcp.json`
- [ ] Bloque de código JSON copiable con configuración para Cursor
- [ ] Nota sobre compatibilidad: MCP en Cursor requiere versión X.X+

### AC4 — Ejemplo de invocación
- [ ] Sección "Cómo usarlo" con ejemplo real:
  - Prompt de ejemplo: "Usa el agente `text-summarizer` de WasiAI para resumir este texto: ..."
  - Resultado esperado: Claude/Cursor llama al agente, paga automáticamente desde la API key, retorna respuesta
- [ ] Link al agente de ejemplo en el marketplace

### AC5 — Referencia técnica del MCP server
- [ ] URL del MCP server documentada (path en el repo o URL de producción si aplica)
- [ ] Lista de tools disponibles via MCP (mínimo: `invoke_agent`, `list_agents`)
- [ ] Parámetros de cada tool con tipos y descripción
- [ ] Nota sobre pagos: "Cada invocación consume USDC de tu API key automáticamente"

### AC6 — Accesibilidad y formato
- [ ] Código en bloques con syntax highlighting
- [ ] Botón "Copy" en cada bloque de código
- [ ] Funciona en español e inglés (i18n o al menos en inglés por ser documentación técnica)

---

## Scope (qué SÍ incluye)

- Página `/docs/mcp` nueva
- Guías paso a paso para Claude Desktop y Cursor
- Ejemplo funcional de invocación
- Referencia técnica del MCP server de WasiAI

## Out of Scope

- Documentación para otros clientes MCP (VS Code, Zed, etc.) → Sprint 6
- SDK docs completas (HU-2.3)
- Video tutorial
- Hosting externo (GitBook, Mintlify) → si el tiempo lo permite, es nice-to-have

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| MCP server path/URL no es público (requiere setup local) | Media | Alto | Documentar ambos: local (npx) y si hay endpoint remoto |
| Config de Claude Desktop cambia con versiones nuevas | Baja | Bajo | Mencionar versión testeada en la guía |
| No hay estructura de /docs en el sitio aún | Media | Medio | Crear página simple sin sistema de docs completo |

---

## Dependencias

- MCP server existente en el repo (verificar path y forma de invocar)
- Claude Desktop con soporte MCP (verificar config format actual)
- Estructura de rutas en Next.js (dónde vive `/docs/`)

---

## Notas de Pre-Implementación

Antes de S1, verificar:
1. `cat` del MCP server actual en el repo — ¿cómo se invoca? (`node path/to/server.js`? `npx wasiai-mcp`?)
2. ¿Existe `WASIAI_API_KEY` como env var estándar en el MCP server?
3. ¿Hay tools `invoke_agent` y `list_agents` ya implementados?

---

**Estado:** PENDING_HU_APPROVED  
**Requiere aprobación explícita de Fer antes de pasar a S1.**
