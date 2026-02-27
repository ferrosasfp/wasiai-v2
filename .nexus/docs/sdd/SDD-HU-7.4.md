# S1 — SDD: HU-7.4 — Documentación MCP para Claude Desktop y Cursor

**Estado:** PENDING_SPEC_APPROVED  
**HU:** HU-7.4 | **Sprint:** 5 | **PM:** San  
**Fecha:** 2026-02-26

---

## 1. Decisión Arquitectónica: Sección en /docs vs página /docs/mcp

**Decisión: Nueva sección dentro de `/[locale]/docs`** — no página separada.

**Razón:**
- La estructura existente (`/docs`) ya tiene DocsSidebar con scroll-spy y secciones por componentes en `src/features/docs/content/*.tsx`. El patrón es claro: cada tema = un archivo de contenido + una entrada en `SECTION_KEYS`.
- Crear `/docs/mcp` como ruta separada requeriría duplicar layout, sidebar y navegación sin beneficio real.
- La sección MCP es documentación técnica de integración, exactamente el mismo tipo de contenido que `sdk-node`, `sdk-python`, `api-reference`.
- Costo: 0 cambios de estructura de rutas. Solo agregar el componente y registrarlo.

**Alternativa descartada:** `/[locale]/docs/mcp` como subruta — innecesariamente complejo para este volumen de contenido.

---

## 2. Análisis del MCP Server Existente

Del análisis de `src/app/api/v1/mcp/route.ts`:

### URL de producción
```
https://wasiai-v2.vercel.app/api/v1/mcp
```

### Autenticación
- Query param: `?key=wasi_YOUR_KEY`
- Obtención: `https://wasiai-v2.vercel.app/en/agent-keys`

### Métodos MCP implementados

| Método | Auth | Descripción |
|--------|------|-------------|
| `GET /api/v1/mcp` | No | Server info + lista de tools dinámica (agentes activos) |
| `tools/list` (POST) | No | Lista todos los agentes activos como MCP tools |
| `tools/call` (POST) | Sí (`?key=`) | Ejecuta un agente, descuenta del budget |
| `resources/read` (POST) | No | Catálogo completo en `wasiai://catalog` |

### Naming convention de tools
- Pattern: `wasiai_{slug_con_guiones_reemplazados_por_underscore}`
- Ejemplo: agente `text-summarizer` → tool `wasiai_text_summarizer`

### Schema de input para tools/call
```json
{
  "method": "tools/call",
  "params": {
    "name": "wasiai_text_summarizer",
    "arguments": {
      "input": "Texto a procesar",
      "options": {}
    }
  }
}
```

### Pagos
- Cada `tools/call` exitoso descuenta `price_per_call` USDC del budget de la agent key.
- Se registra en `agent_calls` con `latency_ms`.

**Nota crítica:** El MCP server usa HTTP (URL-based), NO stdio. Esto simplifica la configuración para Claude Desktop y Cursor — no se necesita `command`/`args`, solo `url`.

---

## 3. Configuración Exacta para Clientes MCP

### Claude Desktop (`claude_desktop_config.json`)

**Path Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Path Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://wasiai-v2.vercel.app/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}
```

### Cursor (`.cursor/mcp.json` en el proyecto o `~/.cursor/mcp.json` global)

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://wasiai-v2.vercel.app/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}
```

**Nota:** Ambos usan el mismo formato porque el server es HTTP-based (no stdio). La compatibilidad con Cursor requiere versión 0.43+.

---

## 4. Estructura del Contenido de la Sección

### 4.1 Secciones de la página (en orden)

```
## MCP Integration
  ├── ¿Qué es MCP? (2 líneas)
  ├── Paso 1: Obtener una Agent Key
  ├── Paso 2: Configurar Claude Desktop
  │     ├── CodeBlock: JSON config (Mac path)
  │     └── Nota: path en Windows/Linux
  ├── Paso 3: Configurar Cursor
  │     └── CodeBlock: JSON config (.cursor/mcp.json)
  ├── Paso 4: Verificar conexión
  │     └── CodeBlock: prompt de verificación
  ├── Ejemplo real de uso
  │     ├── CodeBlock: prompt de ejemplo
  │     └── Explicación de lo que pasa (tool call → pago → respuesta)
  └── Referencia técnica
        ├── URL del server
        ├── Tabla: métodos disponibles
        ├── Tabla: parámetros de tools/call
        └── Nota sobre pagos USDC
```

### 4.2 Ejemplo real de invocación (contenido exacto)

**Prompt de ejemplo:**
```
Usa el agente text-summarizer de WasiAI para resumir este texto:
"La inteligencia artificial generativa está transformando la forma en que los 
desarrolladores construyen aplicaciones. Con modelos como GPT-4 y Claude..."
```

**Flujo que ocurre:**
1. Claude/Cursor detecta el tool `wasiai_text_summarizer`
2. Llama a `POST /api/v1/mcp?key=wasi_...` con `method: tools/call`
3. WasiAI llama al endpoint del agente y descuenta del budget
4. Retorna el resumen + metadata (`charged: 0.001 USDC`)

---

## 5. Componentes a Crear / Modificar

### 5.1 CREAR: `src/features/docs/content/mcp.tsx`

Componente `McpSection` — sigue exactamente el mismo patrón que `sdk-node.tsx`.

**Estructura:**
```tsx
'use client'  // por CodeBlock
import { CodeBlock } from '../components/CodeBlock'

export function McpSection() {
  return (
    <section id="mcp-integration" className="scroll-mt-20">
      <h2>MCP Integration</h2>
      {/* subsecciones con CodeBlock reutilizado */}
    </section>
  )
}
```

**CodeBlocks necesarios:**
1. Claude Desktop config (JSON)
2. Cursor config (JSON)  
3. Verificación (prompt texto plano, language: `bash` o plain)
4. Ejemplo de invocación (prompt texto plano)
5. Referencia: tools/call body (JSON)

### 5.2 MODIFICAR: `src/features/docs/components/DocsSidebar.tsx`

Agregar entrada a `SECTION_KEYS`:
```ts
{ id: 'mcp-integration', key: 'mcpIntegration' },
```

### 5.3 MODIFICAR: `src/app/[locale]/docs/page.tsx`

Agregar import y renderizado:
```tsx
import { McpSection } from '@/features/docs/content/mcp'
// ...
<div className="border-t border-gray-100 pt-8">
  <McpSection />
</div>
```

Agregar ANTES de `<ErrorsSection />` (orden lógico: Quickstart → SDKs → API Ref → MCP → Errors).

### 5.4 MODIFICAR: Traducciones i18n

Archivos de mensajes (path a confirmar: `messages/en.json`, `messages/es.json`):
```json
{
  "docs": {
    "mcpIntegration": "MCP Integration"
  }
}
```

---

## 6. Archivos Afectados (resumen)

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `src/features/docs/content/mcp.tsx` | CREAR | Componente McpSection con todo el contenido |
| `src/features/docs/components/DocsSidebar.tsx` | MODIFICAR | +1 entrada en SECTION_KEYS |
| `src/app/[locale]/docs/page.tsx` | MODIFICAR | Import + render McpSection |
| `messages/en.json` | MODIFICAR | `docs.mcpIntegration` key |
| `messages/es.json` | MODIFICAR | `docs.mcpIntegration` key (si existe) |

---

## 7. Lo que NO se necesita crear

- ❌ Nueva ruta (`/docs/mcp`) — innecesario
- ❌ Componente CodeBlock nuevo — ya existe y tiene Copy button
- ❌ highlight.js config nueva — ya registrado json, bash, js, python
- ❌ Nuevo layout — hereda el de `/docs`
- ❌ Lógica de autenticación — MCP server ya la maneja

---

## 8. Definition of Done (DoD) Verificable

### Funcional
- [ ] Sección "MCP Integration" visible en `/en/docs` con scroll-spy en sidebar
- [ ] Entrada "MCP Integration" en DocsSidebar, activa al hacer scroll a la sección
- [ ] CodeBlock de Claude Desktop config: JSON válido, botón Copy funcional, syntax highlighting
- [ ] CodeBlock de Cursor config: JSON válido, botón Copy funcional
- [ ] Verificar que la URL documentada (`https://wasiai-v2.vercel.app/api/v1/mcp`) responde GET con server info
- [ ] Tabla de métodos lista: `tools/list`, `tools/call`, `resources/read`
- [ ] Ejemplo real con nombre de agente existente en producción (verificar slug real en Supabase)

### Técnico
- [ ] `McpSection` no hace fetch — contenido estático (sin loading states)
- [ ] No rompe build de Next.js (`npm run build` sin errores)
- [ ] Sidebar scroll-spy funciona correctamente con la nueva sección
- [ ] i18n: key `docs.mcpIntegration` presente en EN (ES opcional para documentación técnica)

### Calidad
- [ ] Copy de Claude Desktop config pega JSON directamente usable (sin modificar)
- [ ] Copy de Cursor config pega JSON directamente usable
- [ ] La nota de pagos USDC está presente y clara
- [ ] Link a `/en/agent-keys` para obtener la key

---

## 9. Notas de Implementación para Dev

1. **ID de sección:** Usar `id="mcp-integration"` en el `<section>` (no `id="mcp"`) para consistencia con el patrón existente (todos tienen IDs con guión).

2. **Agent key de ejemplo en docs:** Usar `wasi_YOUR_KEY` como placeholder — nunca un valor real.

3. **Agente de ejemplo:** Confirmar con Fer qué slug de agente usar en el ejemplo. Si no hay un `text-summarizer` activo, elegir uno que sí exista. El Dev puede hacer `GET /api/v1/mcp` para ver la lista actual.

4. **Windows path:** `%APPDATA%\Claude\claude_desktop_config.json` → equivale a `C:\Users\<username>\AppData\Roaming\Claude\claude_desktop_config.json`. Documentarlo como nota colapsada o texto secundario.

5. **Cursor versión mínima:** La doc menciona 0.43+ como referencia — confirmar en la [documentación oficial de Cursor MCP](https://docs.cursor.com/context/model-context-protocol) antes de publicar.

6. **Order en page.tsx:** Insertar McpSection entre ApiReferenceSection y ErrorsSection — tiene sentido narrativo (primero la API raw, luego cómo conectarla desde IDEs, luego manejo de errores).

---

**Próximo paso:** SPEC_APPROVED de Fer → SM crea `story-HU-7.4.md` → Dev implementa.
