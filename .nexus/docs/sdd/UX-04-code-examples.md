# SDD — UX-04: Código de Ejemplo Auto-generado en Ficha del Agente

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-26
> **Sprint:** 3

---

## Objetivo
Mostrar en la ficha de cada agente ejemplos de código listos para copiar (curl, Node.js, Python) generados automáticamente desde el slug y precio del agente.

---

## Componente: `src/features/models/components/CodeExamples.tsx`

```typescript
'use client'
import { useState } from 'react'

interface Props {
  slug: string
  inputExample?: string | null
}

type Tab = 'curl' | 'node' | 'python'

const BASE = 'https://wasiai-v2.vercel.app'

export function CodeExamples({ slug, inputExample }: Props) {
  const [tab, setTab] = useState<Tab>('curl')
  const [copied, setCopied] = useState(false)

  const exampleInput = inputExample ?? 'Hello, world!'

  const snippets: Record<Tab, string> = {
    curl: `curl -X POST ${BASE}/api/v1/agents/${slug}/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wasi_YOUR_KEY" \\
  -d '{"input": "${exampleInput}"}'`,

    node: `import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({ apiKey: 'wasi_YOUR_KEY' })
const result = await client.invoke('${slug}', {
  input: '${exampleInput}'
})
console.log(result.output)`,

    python: `import requests

response = requests.post(
  '${BASE}/api/v1/agents/${slug}/invoke',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': '${exampleInput}'}
)
print(response.json()['output'])`,
  }

  function copy() {
    navigator.clipboard.writeText(snippets[tab])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'curl',   label: 'cURL' },
    { id: 'node',   label: 'Node.js' },
    { id: 'python', label: 'Python' },
  ]

  return (
    <div className="rounded-2xl bg-gray-900 overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {tabs.map(t => (
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
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Code */}
      <pre className="p-4 text-xs text-gray-100 overflow-x-auto leading-relaxed">
        <code>{snippets[tab]}</code>
      </pre>

      {/* Footer note */}
      <div className="px-4 pb-3 text-xs text-gray-500">
        Reemplaza <span className="text-gray-300">wasi_YOUR_KEY</span> por tu API key.{' '}
        <a
          href="https://wasiai-v2.vercel.app/keys"
          className="text-avax-400 hover:text-avax-300"
          target="_blank" rel="noreferrer"
        >
          Obtener API key →
        </a>
      </div>
    </div>
  )
}
```

---

## Integración en la ficha del agente

En `src/app/[locale]/models/[slug]/page.tsx`, importar `CodeExamples` y renderizarlo en la columna principal, **dentro del bloque oscuro "Agent API"** (reemplaza o complementa el bloque de URL actual):

```tsx
import { CodeExamples } from '@/features/models/components/CodeExamples'

// Dentro del bloque Agent API:
<CodeExamples
  slug={model.slug}
  inputExample={model.capabilities?.input_example ?? null}
/>
```

---

## Definition of Done
- [ ] Componente `CodeExamples` con 3 tabs (cURL, Node.js, Python)
- [ ] Botón "Copiar" funcional con feedback visual (✓ Copiado)
- [ ] `inputExample` desde `capabilities` del agente si existe, sino fallback genérico
- [ ] Integrado en la ficha del agente (sección API)
- [ ] `npm run build` limpio
