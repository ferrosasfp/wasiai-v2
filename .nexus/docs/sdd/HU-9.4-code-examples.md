---
title: SDD — HU-9.4 Code Examples Auto-generados en Ficha del Agente
fecha: 2026-02-26
hu_origen: HU-9.4
linear: WAS-28
HU_APPROVED: yes
SPEC_APPROVED: yes
---

## Objetivo
Mostrar snippets listos para copiar (curl, Node.js, Python) en la ficha de cada agente, generados en build time con el slug y precio real. Corregir dos violaciones al Golden Path en el componente existente.

---

## Rutas / Endpoints
Ninguna nueva — la ficha ya existe en `/[locale]/models/[slug]/page.tsx`.

## Schema de DB
Ninguno.

## Interacciones on-chain
Ninguna.

---

## Hallazgo crítico — código existente con 2 bugs

`src/features/models/components/CodeExamples.tsx` ya existe e importado en la ficha, pero tiene:

1. **`'use client'`** — viola AC5 (debe ser Server Component con ISR)
2. **`BASE = 'https://wasiai-v2.vercel.app'` hardcodeado** — viola regla absoluta #1

Esta HU los corrige completamente.

---

## Arquitectura resultante

```
CodeExamples.tsx          ← Server Component async
                             genera snippets como strings
                             pasa snippets a →
  CodeExamplesTabs.tsx    ← Client Component (solo tabs + botón copiar)
                             maneja useState tab activo
                             navigator.clipboard.writeText()
```

---

## Componentes

### `CodeExamples` (Server Component)
```typescript
// src/features/models/components/CodeExamples.tsx
interface Props {
  slug: string
  priceUsdc: string | null   // null = agente gratuito
  inputExample?: string | null
}
// Sin 'use client', sin hooks
// BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'
// Genera los 3 snippets como strings → pasa a CodeExamplesTabs
```

### `CodeExamplesTabs` (Client Component)
```typescript
// src/features/models/components/CodeExamplesTabs.tsx
interface Props {
  snippets: { curl: string; node: string; python: string }
}
// 'use client'
// useState: tab activo ('curl' | 'node' | 'python')
// Botón copiar: navigator.clipboard.writeText(snippets[tab])
// 2s feedback: "✓ Copiado"
```

---

## Generación de snippets

### Snippet Node.js — lógica de dependencia con HU-2.1
- Si `@wasiai/sdk` disponible en npm → usar SDK en el snippet
- Si no → usar `fetch` con comentario `// or: npm install @wasiai/sdk`
- En esta HU: usar `fetch` con comentario (HU-2.1 puede o no estar publicado aún)

### Agente gratuito (`priceUsdc` null)
- Snippet curl: omite `X-Price` header, añade `# free agent`
- Snippet Node.js: omite referencia a precio
- Snippet Python: omite referencia a precio

---

## Flujos

### Happy Path
1. Developer abre ficha del agente
2. Sección "Cómo usar" visible con 3 tabs: cURL · Node.js · Python
3. Tab cURL activo por defecto
4. Click "Copiar" → copiado al clipboard, botón muestra "✓ Copiado" 2s
5. Cambia tab → ve snippet correspondiente

### Edge Cases
| Caso | Comportamiento |
|------|---------------|
| `priceUsdc` null | Snippets sin línea de precio + comentario `# free agent` |
| `inputExample` null | Fallback `"Hello, world!"` |
| `navigator.clipboard` no disponible | Botón no aparece o falla silenciosamente (no rompe la UI) |

---

## Definition of Done
- [ ] `CodeExamples` es Server Component — sin `'use client'`, sin hooks
- [ ] `BASE_URL` desde `process.env.NEXT_PUBLIC_SITE_URL` — sin hardcode
- [ ] `CodeExamplesTabs` es el único Client Component, mínimo (solo tabs + copiar)
- [ ] Agente gratuito → snippet correcto sin línea de precio
- [ ] Botón copiar funciona en los 3 tabs
- [ ] Tests unitarios para la función de generación de snippets
- [ ] `npm run build` sin errores TS ni ESLint warnings (`--max-warnings 0`)

---

## Assumptions
- La sección "Cómo usar" ya tiene espacio en el layout (componente ya importado en `page.tsx`)
- El snippet Node.js usa `fetch` en esta HU, con comentario sobre `@wasiai/sdk`
- `page.tsx` no requiere cambios si los props de `CodeExamples` se mantienen compatibles

## Open Questions
Ninguna.
