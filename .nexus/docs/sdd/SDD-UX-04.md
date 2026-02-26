# SDD-UX-04 — Sección "Cómo usar" en página de detalle del agente

**Estado:** S1 — Software Design Document  
**HU origen:** HU-UX-04  
**Fecha:** 2026-02-26  
**Autor:** PM Agent — BMAD Method v6  

---

## 0. Resumen ejecutivo

La sección "Cómo usar" ya existe parcialmente en el codebase. Hay **dos bugs críticos** que deben corregirse antes de considerar la HU cerrada:

1. **BUG-1 (R4):** `CodeExamples.tsx` genera snippets con `/api/v1/agents/${slug}/invoke` pero el endpoint real de producción es `/api/v1/models/${slug}/invoke`. Los snippets actuales fallan en producción.
2. **BUG-2 (AC-6):** `CodeExamplesTabs.tsx` tiene textos hardcodeados en español (`"Reemplaza"`, `"Obtener API key →"`). No usa next-intl. Rompe la internacionalización en locale `en`.

Además hay una **mejora necesaria (AC-5):** el footer del componente enlaza a `/en/agent-keys` hardcodeado en lugar de usar el locale activo.

Este SDD define el diseño completo corregido.

---

## 1. Resolución R4 — Endpoint real

| Pregunta | Respuesta |
|----------|-----------|
| ¿Cuál es el path real del endpoint de invocación? | `/api/v1/models/[slug]/invoke` |
| Archivo de ruta | `src/app/api/v1/models/[slug]/invoke/route.ts` |
| ¿Existe también `/api/v1/agents/[slug]/invoke`? | Sí, pero es un endpoint diferente con auth distinta |
| ¿Qué usa `page.tsx`? | `APP_URL/api/v1/models/${model.slug}/invoke` ✅ |
| ¿Qué usa `CodeExamples.tsx` actual? | `BASE_URL/api/v1/agents/${slug}/invoke` ❌ BUG |

**Conclusión:** El snippet debe usar `/api/v1/models/{slug}/invoke` en todos los lenguajes.

---

## 2. Estructura de archivos

```
src/
└── features/
    └── models/
        └── components/
            ├── CodeExamples.tsx          ← Server Component (SC) — MODIFICAR
            └── CodeExamplesTabs.tsx      ← Client Component (CC) — MODIFICAR

src/app/
└── [locale]/
    └── models/
        └── [slug]/
            └── page.tsx                 ← NO MODIFICAR (integración ya correcta)

messages/
├── es.json                              ← MODIFICAR — agregar namespace codeExamples
└── en.json                              ← MODIFICAR — agregar namespace codeExamples
```

---

## 3. Función `generateSnippets()`

### Firma

```typescript
function generateSnippets(
  slug: string,
  priceUsdc: string | null | undefined,
  inputExample: string,
  invokeBaseUrl: string  // recibido como parámetro — no hardcoded, no NEXT_PUBLIC_
): { curl: string; node: string; python: string }
```

### Notas de implementación

- `invokeBaseUrl` se pasa desde el Server Component usando `process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'`
- `inputExample` se sanitiza con `JSON.stringify(inputExample)` para escapar comillas y caracteres especiales (mitiga R3)
- `isFree = !priceUsdc || priceUsdc === '0'`
- El único placeholder manual en el snippet es `wasi_YOUR_KEY`

### Snippets resultantes (slugEjemplo: `my-agent`, input: `Hello, world!`, agente de pago)

#### curl
```bash
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/my-agent/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wasi_YOUR_KEY" \
  -d '{"input": "Hello, world!"}'
```

#### curl (agente gratuito)
```bash
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/my-agent/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wasi_YOUR_KEY" \
  -d '{"input": "Hello, world!"}' # free agent
```

#### Node.js
```javascript
const response = await fetch(
  'https://wasiai-v2.vercel.app/api/v1/models/my-agent/invoke',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'wasi_YOUR_KEY',
    },
    body: JSON.stringify({ input: "Hello, world!" }),
  }
)
const { output } = await response.json()
console.log(output)
```

#### Python
```python
import requests

response = requests.post(
  'https://wasiai-v2.vercel.app/api/v1/models/my-agent/invoke',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': "Hello, world!"}
)
print(response.json()['output'])
```

---

## 4. Componente `CodeExamples.tsx` (Server Component)

```typescript
// src/features/models/components/CodeExamples.tsx
// Server Component — ISR compatible, no 'use client'
import { getTranslations } from 'next-intl/server'
import { CodeExamplesTabs } from './CodeExamplesTabs'

const SITE_URL = (
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  'https://wasiai-v2.vercel.app'
).replace(/\/$/, '')

interface Props {
  slug: string
  priceUsdc?: string | null
  inputExample?: string | null
  locale: string
}

function generateSnippets(
  slug: string,
  priceUsdc: string | null | undefined,
  inputExample: string,
  invokeBaseUrl: string
): { curl: string; node: string; python: string } {
  const isFree = !priceUsdc || priceUsdc === '0'
  const freeNote = isFree ? ' # free agent' : ''
  // Sanitizar inputExample para evitar ruptura de template strings (R3)
  const safeInput = JSON.stringify(inputExample) // incluye comillas: "Hello, world!"
  const invokeUrl = `${invokeBaseUrl}/api/v1/models/${slug}/invoke`

  const curl =
`curl -X POST ${invokeUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wasi_YOUR_KEY" \\
  -d '{"input": ${safeInput}}'${freeNote}`

  const node =
`const response = await fetch(
  '${invokeUrl}',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'wasi_YOUR_KEY',
    },
    body: JSON.stringify({ input: ${safeInput} }),
  }
)
const { output } = await response.json()
console.log(output)${freeNote ? '\n' + freeNote : ''}`

  const python =
`import requests

response = requests.post(
  '${invokeUrl}',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': ${safeInput}}
)
print(response.json()['output'])${freeNote}`

  return { curl, node, python }
}

export async function CodeExamples({ slug, priceUsdc, inputExample, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'codeExamples' })
  const example = inputExample ?? 'Hello, world!'
  const snippets = generateSnippets(slug, priceUsdc, example, SITE_URL)
  const keysUrl = `/${locale}/agent-keys`

  return (
    <div className="rounded-2xl bg-gray-900 overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          {t('title')}
        </h2>
      </div>
      <CodeExamplesTabs
        snippets={snippets}
        keysUrl={keysUrl}
        labels={{
          copy: t('copy'),
          copied: t('copied'),
          replace: t('replace'),
          getKey: t('getKey'),
        }}
      />
    </div>
  )
}
```

**Notas:**
- La función `generateSnippets` es pura — testeable sin framework.
- `CodeExamples` pasa al CC solo strings ya computados — no pasa env vars al cliente.
- `locale` viene de `params` en `page.tsx`.
- `keysUrl` es localizado: `/${locale}/agent-keys`.

---

## 5. Componente `CodeExamplesTabs.tsx` (Client Component)

```typescript
// src/features/models/components/CodeExamplesTabs.tsx
'use client'
import { useState } from 'react'

type Tab = 'curl' | 'node' | 'python'

interface Labels {
  copy: string
  copied: string
  replace: string
  getKey: string
}

interface Props {
  snippets: { curl: string; node: string; python: string }
  keysUrl: string
  labels: Labels
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'curl',   label: 'cURL' },
  { id: 'node',   label: 'Node.js' },
  { id: 'python', label: 'Python' },
]

export function CodeExamplesTabs({ snippets, keysUrl, labels }: Props) {
  const [tab, setTab]       = useState<Tab>('curl')
  const [copied, setCopied] = useState(false)

  function copy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(snippets[tab]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {/* silent fail — R2 */})
  }

  return (
    <>
      {/* Tabs + copy button */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t.id
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1"
        >
          {copied ? labels.copied : labels.copy}
        </button>
      </div>

      {/* Code */}
      <pre className="p-4 text-xs text-gray-100 overflow-x-auto leading-relaxed">
        <code>{snippets[tab]}</code>
      </pre>

      {/* Footer */}
      <div className="px-4 pb-3 text-xs text-gray-500">
        {labels.replace}{' '}
        <span className="text-gray-300">wasi_YOUR_KEY</span>.{' '}
        <a
          href={keysUrl}
          className="text-avax-400 hover:text-avax-300"
          target="_blank"
          rel="noreferrer"
        >
          {labels.getKey} →
        </a>
      </div>
    </>
  )
}
```

---

## 6. Keys i18n

### `messages/es.json` — agregar namespace `codeExamples`

```json
"codeExamples": {
  "title": "Cómo usar",
  "copy": "Copiar",
  "copied": "¡Copiado!",
  "replace": "Reemplaza wasi_YOUR_KEY por tu API key.",
  "getKey": "Obtener API key"
}
```

### `messages/en.json` — agregar namespace `codeExamples`

```json
"codeExamples": {
  "title": "How to use",
  "copy": "Copy",
  "copied": "Copied!",
  "replace": "Replace wasi_YOUR_KEY with your API key.",
  "getKey": "Get API key"
}
```

---

## 7. Integración en `page.tsx`

La integración **ya existe y es mayormente correcta**. Solo requiere agregar `locale` como prop:

### Ubicación exacta en el árbol

```
<main>
  <div> (max-w-5xl)
    <div> (grid 3 cols)
      <div> (col-span-2 — columna principal)
        ├── Bloque Header (nombre, creator)
        ├── Bloque Capabilities & Schema
        ├── <AgentTrialPlayground>      ← HU-3.1, ya existe
        ├── <CodeExamples>              ← HU-UX-04 ← AQUÍ (ya integrado)
        └── Bloque Agent API (x402 docs)
```

### Diff requerido en `page.tsx`

```diff
- <CodeExamples
-   slug={model.slug}
-   priceUsdc={model.price_per_call > 0 ? model.price_per_call.toString() : null}
-   inputExample={model.capabilities?.[0]?.example?.input ?? null}
- />
+ <CodeExamples
+   slug={model.slug}
+   priceUsdc={model.price_per_call > 0 ? model.price_per_call.toString() : null}
+   inputExample={model.capabilities?.[0]?.example?.input ?? null}
+   locale={locale}
+ />
```

**No se requiere ningún otro cambio en `page.tsx`.**

---

## 8. Variables de entorno

| Variable | Tipo | Uso |
|----------|------|-----|
| `SITE_URL` | Server-only | URL base para snippets en SC. Preferida. |
| `NEXT_PUBLIC_SITE_URL` | Pública (fallback) | Usado en `page.tsx` y como fallback en SC |

El SC usa `process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'`. No se introduce ninguna nueva var de entorno. No se expone ningún secret al cliente.

---

## 9. Flujo de datos (diagrama simplificado)

```
page.tsx (SC, ISR revalidate=300)
  │
  ├─ getModelBySlug(slug)
  │    └─ model.slug, model.price_per_call, model.capabilities[0].example.input
  │
  └─ <CodeExamples slug priceUsdc inputExample locale>   (SC)
       │
       ├─ generateSnippets(slug, priceUsdc, example, SITE_URL)
       │    └─ { curl, node, python }  — strings puros, computados en servidor
       │
       ├─ getTranslations('codeExamples')
       │    └─ { title, copy, copied, replace, getKey }
       │
       └─ <CodeExamplesTabs snippets keysUrl labels>   (CC, 'use client')
            ├─ useState(tab = 'curl')
            ├─ useState(copied = false)
            └─ navigator.clipboard.writeText(snippets[tab])
```

---

## 10. Restricciones Golden Path verificadas

| Restricción | Estado |
|-------------|--------|
| Next.js 14 App Router | ✅ |
| `CodeExamples` es Server Component | ✅ |
| `'use client'` solo en `CodeExamplesTabs` | ✅ |
| ISR `revalidate = 300` en `page.tsx` | ✅ ya existe |
| Sin ethers.js | ✅ no aplica |
| Sin `NEXT_PUBLIC_` para secrets | ✅ snippets generados en servidor |
| Sin hardcodes de URL en cliente | ✅ snippets son strings ya interpolados |
| i18n via next-intl | ✅ |
| Tailwind, sin CSS modules | ✅ |
| Sin `any` explícito | ✅ |

---

## 11. Definition of Done

### Funcional
- [ ] Los snippets de curl, Node.js y Python contienen `/api/v1/models/{slug}/invoke` (no `/agents/`)
- [ ] El único placeholder manual es `wasi_YOUR_KEY`
- [ ] Si `price_per_call === 0` o `null`, aparece `# free agent` al final del snippet
- [ ] Si `price_per_call > 0`, no aparece `# free agent`
- [ ] El `input` del snippet usa `capabilities[0].example.input`; si no existe usa `"Hello, world!"`
- [ ] Inputs con caracteres especiales (comillas, backslashes) no rompen el snippet
- [ ] El tab activo por defecto es `curl`
- [ ] Cambiar de tab no hace request ni re-render del SC
- [ ] El botón Copy copia el código del tab activo
- [ ] El botón muestra "Copied!" / "¡Copiado!" por 2 segundos y vuelve al estado original
- [ ] Si `navigator.clipboard` no está disponible, no lanza excepción no manejada

### i18n
- [ ] En locale `es`: título "Cómo usar", botón "Copiar", feedback "¡Copiado!", footer en español
- [ ] En locale `en`: título "How to use", botón "Copy", feedback "Copied!", footer en inglés
- [ ] El código en sí (snippets) permanece en inglés independientemente del locale

### Integración
- [ ] La sección aparece en la columna principal debajo de `<AgentTrialPlayground>` y antes del bloque "Agent API"
- [ ] La sección es visible para agentes gratuitos y de pago
- [ ] `page.tsx` tiene `export const revalidate = 300`

### Técnico
- [ ] `CodeExamples.tsx` no tiene `'use client'`
- [ ] `CodeExamplesTabs.tsx` tiene `'use client'`
- [ ] No hay imports de ethers.js
- [ ] No hay `any` explícito
- [ ] `generateSnippets` es función pura (sin side effects, sin imports externos)
- [ ] Link "Obtener API key" apunta a `/${locale}/agent-keys` (no hardcodeado `/en/`)
- [ ] Build de Next.js sin errores de TypeScript ni warnings de ESLint

### Verificación manual
- [ ] Abrir `/es/models/[slug-real]` → snippets en español, código correcto
- [ ] Abrir `/en/models/[slug-real]` → snippets en inglés, código correcto
- [ ] Copiar snippet curl → pegar en terminal → comando ejecutable sin modificaciones (excepto `wasi_YOUR_KEY`)

---

## 12. Riesgos residuales

| ID | Riesgo | Estado | Acción |
|----|--------|--------|--------|
| R1 | BASE_URL expuesto en bundle JS | ✅ Mitigado | SC genera snippets como strings; cliente solo recibe el string final |
| R2 | `navigator.clipboard` no disponible | ✅ Mitigado | try/catch + return silencioso implementado |
| R3 | Input con caracteres especiales rompe snippet | ✅ Mitigado | `JSON.stringify(inputExample)` sanitiza el valor |
| R4 | Inconsistencia `/agents/` vs `/models/` | ✅ Resuelto | Endpoint real: `/api/v1/models/{slug}/invoke` |
| R5 | SC con hooks indirectos | ✅ Mitigado | `CodeExamplesTabs` es el único CC |

---

*Generado por PM Agent — BMAD Method v6 — 2026-02-26*
