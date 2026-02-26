# Story 9.4: Code Examples Auto-generados en Ficha del Agente

Status: ready-for-dev

## Story

As a developer (consumer) arriving at an agent detail page,
I want to see ready-to-copy code snippets in curl, Node.js, and Python,
so that I can integrate the agent in my project in under 2 minutes without reading documentation.

## Acceptance Criteria

1. Agent detail page shows "Cómo usar" section with 3 tabs: `curl`, `Node.js`, `Python`
2. Each tab has the correct snippet for that agent (uses real `slug` and `price_usdc`)
3. "Copy" button per tab copies code to clipboard
4. Snippets use `process.env.NEXT_PUBLIC_SITE_URL` — no hardcoded URL
5. `CodeExamples` is a Server Component — no `'use client'`, no hooks, ISR compatible
6. Free agent (`priceUsdc` null) → snippet omits payment line, adds `# free agent` comment

## Tasks / Subtasks

- [ ] Task 1: Rewrite `CodeExamples.tsx` as Server Component (AC: 4, 5)
  - [ ] Remove `'use client'`
  - [ ] Convert to `async function CodeExamples(props)`
  - [ ] Replace hardcoded `BASE = 'https://wasiai-v2.vercel.app'` with `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'`
  - [ ] Generate the 3 snippet strings server-side
  - [ ] Pass snippets as prop to `CodeExamplesTabs`

- [ ] Task 2: Create `CodeExamplesTabs.tsx` Client Component (AC: 1, 3)
  - [ ] `'use client'`
  - [ ] Props: `{ snippets: { curl: string; node: string; python: string } }`
  - [ ] `useState` for active tab (`'curl' | 'node' | 'python'`)
  - [ ] Copy button: `navigator.clipboard.writeText(snippets[tab])`
  - [ ] 2s feedback: button shows "✓ Copiado" → resets to "Copiar"
  - [ ] If `navigator.clipboard` unavailable → button hidden or silent fail (no crash)

- [ ] Task 3: Snippet generation logic (AC: 2, 6)
  - [ ] curl snippet: POST with `X-API-Key` and `{"input": "<example>"}` — correct URL
  - [ ] Node.js snippet: use `fetch` with comment `// or: npm install @wasiai/sdk`
  - [ ] Python snippet: use `requests.post()`
  - [ ] If `priceUsdc` null → add `# free agent` comment, omit price references
  - [ ] If `inputExample` null → fallback to `"Hello, world!"`

- [ ] Task 4: Unit tests (AC: 2, 4, 6)
  - [ ] Extract snippet generation to pure function `generateSnippets(slug, priceUsdc, inputExample, baseUrl)`
  - [ ] Test: paid agent → snippets contain slug and price
  - [ ] Test: free agent (`priceUsdc: null`) → snippets contain `# free agent`
  - [ ] Test: null inputExample → snippets contain `Hello, world!`
  - [ ] Test: baseUrl comes from env, not hardcoded

- [ ] Task 5: Verify page integration (AC: 1, 5)
  - [ ] `src/app/[locale]/models/[slug]/page.tsx` already imports `CodeExamples` — verify props interface is compatible
  - [ ] No changes to `page.tsx` if props match

- [ ] Task 6: Build check
  - [ ] `npm run build` → 0 TS errors, 0 ESLint warnings (`--max-warnings 0`)

## Dev Notes

### Existing code issues to fix
- `src/features/models/components/CodeExamples.tsx` — EXISTS but broken:
  - Has `'use client'` → must be removed
  - Has `const BASE = 'https://wasiai-v2.vercel.app'` hardcoded → must use env var
- This file is rewritten from scratch (not patched)

### Architecture
```
Server Component (CodeExamples)
  → generates snippet strings from slug + price + inputExample + baseUrl
  → renders <CodeExamplesTabs snippets={...} />

Client Component (CodeExamplesTabs)  [new file]
  → minimal: tab switching + clipboard copy
  → no data fetching, no API calls
```

### Env var
`NEXT_PUBLIC_SITE_URL` is already set in Vercel prod env. Fallback to `'https://wasiai-v2.vercel.app'` is safe.

### Node.js snippet template
```typescript
const nodeSnippet = `const response = await fetch(
  '${baseUrl}/api/v1/agents/${slug}/invoke',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'wasi_YOUR_KEY', // or: npm install @wasiai/sdk
    },
    body: JSON.stringify({ input: '${inputExample}' }),
  }
)
const { output } = await response.json()
console.log(output)`
```

### Golden Path
- Server Component = no `'use client'` — ISR revalidate 300s inherited from page
- No new dependencies
- No data fetching in `CodeExamples` — all data comes from props (already fetched by `page.tsx`)

### References
- SDD: `.nexus/docs/sdd/HU-9.4-code-examples.md`
- Existing component: `src/features/models/components/CodeExamples.tsx` (rewrite)
- Page that imports it: `src/app/[locale]/models/[slug]/page.tsx`

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes List

### File List
- `src/features/models/components/CodeExamples.tsx` (rewrite)
- `src/features/models/components/CodeExamplesTabs.tsx` (create)
- `src/features/models/__tests__/codeExamples.test.ts` (create)
