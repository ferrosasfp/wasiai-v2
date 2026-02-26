# Story 9.6: Hero Copy — Reemplazar "modelos" por "agentes"

Status: ready-for-dev

## Story

As a new visitor to WasiAI (creator or consumer),
I want to see copy that speaks about "agents" (not "models") throughout the homepage,
so that the product communicates clearly what it is from the first moment.

## Acceptance Criteria

1. All references to "modelo/model" in the `home` i18n namespace replaced by "agente/agent"
2. `heroTitle`, `heroSubtitle`, `ctaCreator`, `ctaConsumer` NOT modified — they are already correct
3. `es.json` and `en.json` are in sync (same keys, correct translations)
4. No hardcoded "modelo/model" strings in `page.tsx` — everything via `t()`
5. `npm run build` passes with 0 TS errors, 0 ESLint warnings

## Tasks / Subtasks

- [ ] Task 1: Update `messages/es.json` (AC: 1, 3)
  - [ ] `"availableModels"` → `"Agentes Disponibles"`
  - [ ] `"browseModels"` → `"Ver Agentes"`
  - [ ] `"publishModel"` → `"Publicar un Agente →"`
  - [ ] `"modelsCount"` → `"{total} agentes · página {page} de {total_pages}"`
  - [ ] `"noModels"` → `"Sin agentes todavía."`
  - [ ] `"noModelsFiltered"` → `"Ningún agente coincide con tus filtros."`
  - [ ] `"step2Label"` → `"2. Descubrir agentes"`
  - [ ] `"step3Label"` → `"3. Invocar y pagar"`

- [ ] Task 2: Update `messages/en.json` (AC: 1, 3)
  - [ ] `"availableModels"` → `"Available Agents"`
  - [ ] `"browseModels"` → `"Browse Agents"`
  - [ ] `"publishModel"` → `"Publish an Agent →"`
  - [ ] `"modelsCount"` → `"{total} agents · page {page} of {total_pages}"`
  - [ ] `"noModels"` → `"No agents yet."`
  - [ ] `"noModelsFiltered"` → `"No agents match your filters."`
  - [ ] `"step2Label"` → `"2. Discover agents"`
  - [ ] `"step3Label"` → `"3. Invoke & pay"`

- [ ] Task 3: Verify `page.tsx` (AC: 4)
  - [ ] Grep for any hardcoded "model/modelo" strings in `src/app/[locale]/page.tsx`
  - [ ] If found → move to i18n keys; if not → no changes needed

- [ ] Task 4: Build check (AC: 5)
  - [ ] `npm run build` → 0 errors, 0 warnings

## Dev Notes

### Important: what NOT to change
Do NOT modify:
- `heroTitle` — "Publica tu agente de IA." (es) / "Publish your AI agent." (en) ✅
- `heroSubtitle` — "Cobra automáticamente en USDC." (es) / "Get paid automatically in USDC." (en) ✅
- `heroDescription` ✅
- `ctaCreator` ✅
- `ctaConsumer` ✅
- `badge` ✅
- `builtForAgents` ✅
- `builtSubtitle` ✅

### Files to check for any other "model/modelo" references
Run: `grep -r "model\|modelo" messages/` — fix any found in namespace `home` only.

### References
- SDD: `.nexus/docs/sdd/HU-9.6-hero-copy.md`
- i18n source: `messages/es.json`, `messages/en.json`
- Page: `src/app/[locale]/page.tsx`

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes List

### File List
- `messages/es.json` (modify — namespace `home` only)
- `messages/en.json` (modify — namespace `home` only)
- `src/app/[locale]/page.tsx` (verify only, modify if hardcodes found)
