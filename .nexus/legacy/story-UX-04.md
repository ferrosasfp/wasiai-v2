# Story File — HU-UX-04
## Sección "Cómo usar" en página de detalle del agente

**Estado:** READY FOR DEV  
**Sprint:** UX — Experiencia del Developer  
**Fecha:** 2026-02-26  
**SM:** BMAD Method v6 — Bob  

> ⚠️ Este archivo es 100% autocontenido. El Dev implementa desde aquí sin leer ningún otro documento.

---

## Historia de Usuario

**Como** developer que llega a la página de detalle de un agente en WasiAI,  
**quiero** ver una sección "Cómo usar" con ejemplos de código listos para copiar (curl, Node.js, Python) generados automáticamente con el slug y precio del agente,  
**para** integrar el agente en mi sistema sin necesidad de consultar documentación externa ni modificar manualmente los snippets.

---

## Contexto de implementación

### Estado actual del codebase

Los componentes **ya existen** pero tienen **2 bugs críticos** y **1 mejora pendiente**:

| Bug/Mejora | Descripción | Impacto |
|------------|-------------|---------|
| BUG-1 | `CodeExamples.tsx` usa `/api/v1/agents/${slug}/invoke` | Los snippets fallan en producción — endpoint real es `/api/v1/models/` |
| BUG-2 | `CodeExamplesTabs.tsx` tiene textos hardcodeados en español (`"Reemplaza"`, `"Obtener API key →"`) | Rompe i18n en locale `en` |
| MEJORA-1 | `keysUrl` hardcodeado como `${BASE_URL}/en/agent-keys` | Siempre apunta a `/en/` aunque el locale sea `es` |

**La tarea es corregir estos 3 problemas.** No reescribir desde cero.

### Archivos del proyecto relevantes

```
src/features/models/components/
  CodeExamples.tsx          ← Server Component — MODIFICAR (reemplazar completo)
  CodeExamplesTabs.tsx      ← Client Component — MODIFICAR (reemplazar completo)

src/app/[locale]/models/[slug]/
  page.tsx                  ← MODIFICAR mínimo (agregar prop locale)

messages/
  es.json                   ← MODIFICAR (agregar namespace codeExamples)
  en.json                   ← MODIFICAR (agregar namespace codeExamples)
```

### Archivos que NO tocar

- `src/app/api/v1/models/[slug]/invoke/route.ts` — endpoint real, no modificar
- `src/features/models/components/AgentTrialPlayground.tsx` — HU-3.1, no tocar
- Cualquier otro componente de la página de detalle

---

## Acceptance Criteria (verificables)

### AC-1 — Sección visible en la página de detalle
- [ ] La sección "Cómo usar" / "How to use" aparece en `/[locale]/models/[slug]` para todos los agentes.
- [ ] Se posiciona después de `<AgentTrialPlayground>` y antes del bloque "Agent API".

### AC-2 — Tabs de lenguaje
- [ ] Exactamente 3 tabs: `cURL`, `Node.js`, `Python`.
- [ ] Tab activo por defecto: `curl`.
- [ ] Cambiar de tab no llama ninguna API ni re-renderiza el Server Component.

### AC-3 — Snippets correctamente generados
- [ ] URL en snippets: `${SITE_URL}/api/v1/models/{slug}/invoke` (con `/models/`, NO `/agents/`).
- [ ] Si `price_per_call > 0`: no aparece `# free agent` en el snippet.
- [ ] Si `price_per_call === 0` o `null`: aparece `# free agent` al final del snippet.
- [ ] El `input` usa `capabilities[0].example.input`; fallback `"Hello, world!"`.
- [ ] Inputs con comillas o backslashes no rompen el snippet (sanitización con `JSON.stringify`).

### AC-4 — Copiar al portapapeles
- [ ] Botón "Copy" / "Copiar" visible en cada tab.
- [ ] Al click copia el código del tab activo con `navigator.clipboard.writeText`.
- [ ] Feedback visual: muestra "Copied!" / "¡Copiado!" por 2 segundos y vuelve al estado original.
- [ ] Si `navigator.clipboard` no disponible: no lanza excepción no manejada (silent fail).

### AC-5 — Código listo para usar
- [ ] Único placeholder manual: `wasi_YOUR_KEY`.
- [ ] Footer indica dónde obtener la key con link a `/${locale}/agent-keys` (localizado).
- [ ] No hay `YOUR_SLUG`, `YOUR_INPUT`, ni `BASE_URL` como placeholders.

### AC-6 — Internacionalización
- [ ] En locale `es`: título "Cómo usar", botón "Copiar", feedback "¡Copiado!", footer en español.
- [ ] En locale `en`: título "How to use", botón "Copy", feedback "Copied!", footer en inglés.
- [ ] El código de los snippets permanece en inglés sin importar el locale.
- [ ] Textos via `getTranslations` / `useTranslations` de next-intl — sin hardcodes.

### AC-7 — Compatibilidad con ISR
- [ ] `CodeExamples.tsx` es Server Component (sin `'use client'`).
- [ ] Solo `CodeExamplesTabs.tsx` tiene `'use client'`.
- [ ] `page.tsx` mantiene `export const revalidate = 300`.

---

## Implementación — Código completo

### 1. `CodeExamples.tsx` — REEMPLAZAR COMPLETO

**Ruta:** `src/features/models/components/CodeExamples.tsx`

```typescript
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

---

### 2. `CodeExamplesTabs.tsx` — REEMPLAZAR COMPLETO

**Ruta:** `src/features/models/components/CodeExamplesTabs.tsx`

```typescript
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

> **Nota:** Se eliminó `<span className="text-gray-300">wasi_YOUR_KEY</span>` del footer porque `labels.replace` ya incluye esa mención en el texto traducido. Esto simplifica el componente y evita duplicación visual.

---

### 3. Keys i18n — AGREGAR a `messages/es.json`

**Ubicación:** Agregar el objeto `codeExamples` al nivel raíz del JSON (junto a otros namespaces existentes).

```json
"codeExamples": {
  "title": "Cómo usar",
  "copy": "Copiar",
  "copied": "¡Copiado!",
  "replace": "Reemplaza wasi_YOUR_KEY con tu API key.",
  "getKey": "Obtener API key"
}
```

---

### 4. Keys i18n — AGREGAR a `messages/en.json`

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

### 5. Diff en `page.tsx`

**Ruta:** `src/app/[locale]/models/[slug]/page.tsx`

Solo se agrega la prop `locale`. El bloque actual (líneas ~128-133) es:

```tsx
// ANTES (actual):
<CodeExamples
  slug={model.slug}
  priceUsdc={model.price_per_call > 0 ? model.price_per_call.toString() : null}
  inputExample={model.capabilities?.[0]?.example?.input ?? null}
/>

// DESPUÉS (requerido):
<CodeExamples
  slug={model.slug}
  priceUsdc={model.price_per_call > 0 ? model.price_per_call.toString() : null}
  inputExample={model.capabilities?.[0]?.example?.input ?? null}
  locale={locale}
/>
```

**No se requiere ningún otro cambio en `page.tsx`.** La variable `locale` ya está disponible en el componente (viene de `params`).

---

## Ejemplos de snippets generados

### Agente de pago — slug: `gpt4-assistant`, input: `Hello, world!`

**curl:**
```bash
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/gpt4-assistant/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wasi_YOUR_KEY" \
  -d '{"input": "Hello, world!"}'
```

**Node.js:**
```javascript
const response = await fetch(
  'https://wasiai-v2.vercel.app/api/v1/models/gpt4-assistant/invoke',
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

**Python:**
```python
import requests

response = requests.post(
  'https://wasiai-v2.vercel.app/api/v1/models/gpt4-assistant/invoke',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': "Hello, world!"}
)
print(response.json()['output'])
```

### Agente gratuito — agrega `# free agent` al final de cada snippet

```bash
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/free-bot/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wasi_YOUR_KEY" \
  -d '{"input": "Hello, world!"}' # free agent
```

### Input con caracteres especiales — slug: `my-agent`, input: `Say "hello" to me`

`JSON.stringify('Say "hello" to me')` → `"Say \"hello\" to me"`

```bash
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/my-agent/invoke \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wasi_YOUR_KEY" \
  -d '{"input": "Say \"hello\" to me"}'
```

---

## Flujo de datos

```
page.tsx (SC, ISR revalidate=300)
  │
  ├─ params.locale → locale
  ├─ getModelBySlug(slug) → model
  │
  └─ <CodeExamples slug priceUsdc inputExample locale>   (SC)
       │
       ├─ process.env.SITE_URL → SITE_URL (server only)
       ├─ generateSnippets(slug, priceUsdc, example, SITE_URL)
       │    └─ { curl, node, python }  — strings puros, computados en servidor
       │
       ├─ getTranslations({ locale, namespace: 'codeExamples' })
       │    └─ { title, copy, copied, replace, getKey }
       │
       └─ <CodeExamplesTabs snippets keysUrl labels>   (CC, 'use client')
            ├─ useState(tab = 'curl')
            ├─ useState(copied = false)
            └─ navigator.clipboard.writeText(snippets[tab])
```

---

## Variables de entorno

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `SITE_URL` | Server-only (preferida) | URL base para snippets en SC |
| `NEXT_PUBLIC_SITE_URL` | Pública (fallback) | Ya existe en el proyecto |

**No se introduce ninguna variable de entorno nueva.** El SC usa `SITE_URL ?? NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'`. Los snippets se generan en servidor y se pasan al cliente como strings ya interpolados — no se expone ningún secret.

---

## Notas de implementación

1. **`CodeExamples` es `async`** — necesario para `getTranslations`. Verificar que no haya conflicto con la firma actual (la existente es síncrona).

2. **`generateSnippets` es función pura** — no tiene imports ni side effects. Se puede mover fuera del archivo si en el futuro se quiere testear unitariamente.

3. **`priceUsdc === '0'` es gratuito** — la condición es `!priceUsdc || priceUsdc === '0'`. Esto cubre tanto `null` como el string `'0'`.

4. **`safeInput` incluye comillas propias** — `JSON.stringify("Hello")` devuelve `"Hello"` (con comillas). En el snippet de curl el resultado es `{"input": "Hello"}` que es JSON válido. En Node.js/Python el resultado es `JSON.stringify({ input: "Hello" })` que también es correcto.

5. **Footer simplificado** — el texto `labels.replace` ya contiene la mención de `wasi_YOUR_KEY` (ej. "Reemplaza wasi_YOUR_KEY con tu API key."). No se necesita el `<span>` separado para resaltar la key — si Fer quiere resaltado visual, se puede agregar en una iteración posterior.

6. **`locale` en `page.tsx`** — verificar que `locale` esté desestructurado de `params`. Típicamente: `const { locale, slug } = await params` o similar según la versión de Next.js.

---

## Definition of Done

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
- [ ] Si `navigator.clipboard` no disponible, no lanza excepción no manejada

### i18n
- [ ] En locale `es`: título "Cómo usar", botón "Copiar", feedback "¡Copiado!", footer en español
- [ ] En locale `en`: título "How to use", botón "Copy", feedback "Copied!", footer en inglés
- [ ] El código de los snippets permanece en inglés sin importar el locale

### Integración
- [ ] La sección aparece debajo de `<AgentTrialPlayground>` y antes del bloque "Agent API"
- [ ] La sección es visible para agentes gratuitos y de pago
- [ ] `page.tsx` tiene `export const revalidate = 300`

### Técnico
- [ ] `CodeExamples.tsx` no tiene `'use client'`
- [ ] `CodeExamplesTabs.tsx` tiene `'use client'`
- [ ] No hay `any` explícito
- [ ] `generateSnippets` es función pura (sin side effects, sin imports externos)
- [ ] Link "Obtener API key" / "Get API key" apunta a `/${locale}/agent-keys` (no hardcodeado `/en/`)
- [ ] Build de Next.js sin errores de TypeScript ni warnings de ESLint

### Verificación manual
- [ ] Abrir `/es/models/[slug-real]` → snippets en español, código con `/models/`
- [ ] Abrir `/en/models/[slug-real]` → snippets en inglés, código con `/models/`
- [ ] Copiar snippet curl → pegar en terminal → comando ejecutable (solo requiere reemplazar `wasi_YOUR_KEY`)
- [ ] Click en tab "Node.js" → código Node.js visible sin refresh
- [ ] Click en "Copiar" → feedback "¡Copiado!" por ~2s, vuelve a "Copiar"

---

*Story preparada por SM Agent — BMAD Method v6 — 2026-02-26*
