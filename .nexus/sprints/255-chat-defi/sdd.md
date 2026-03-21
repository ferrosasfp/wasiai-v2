# SDD #255 — Chat DeFi

## Context
WasiAI necesita una interfaz conversacional para el hackathon. El usuario escribe una pregunta DeFi en lenguaje natural, el backend la interpreta con un LLM, genera un pipeline de agentes, lo ejecuta via /compose (con el Transform Layer de WAS-254), y devuelve resultado legible.

Dependencia: WAS-254 (Transform Layer) ✅ DONE

## Acceptance Criteria (EARS)
- AC1: **When** el usuario escribe una pregunta DeFi, **the system shall** interpretar la pregunta con un LLM y ejecutar el pipeline de agentes correspondiente via /compose.
- AC2: **When** el pipeline se ejecuta, **the system shall** mostrar un estado de loading mientras procesa. Al terminar, mostrar cada step ejecutado con nombre del agente, costo USDC y estado (success/error).
- AC3: **When** el pipeline termina exitosamente, **the system shall** mostrar un resumen legible (generado por LLM), costo total en USDC, y lista de receipts con firma EIP-712.
- AC4: **When** el usuario no ingresa agent key, **the system shall** mostrar un mensaje con link a /en/models para obtener una.
- AC5: **When** el pipeline falla, **the system shall** mostrar el error y los steps parciales que sí completaron.
- AC6: **The UI shall** ser responsive (mobile-friendly).
- AC7: **The system shall** soportar español e inglés via next-intl.
- AC8: **When** el LLM no puede mapear la pregunta a ningún agente, **the system shall** devolver un mensaje indicando que no puede responder esa pregunta.
- AC9: **The system shall** limitar el pipeline a máximo 5 steps (MAX_STEPS del compose).
- AC10: **The system shall** only use the 5 agents that exist in production (chainlink-price, defi-sentiment, onchain-analyzer, contract-auditor, risk-report). The LLM prompt must NOT reference non-existent agents.

## Wave 0 — Pre-flight
- Verify `src/lib/agents/llm.ts` exports `callLLM` 
- Verify `src/app/api/v1/compose/route.ts` exists and handles POST
- Verify `messages/en.json` and `messages/es.json` exist
- Verify `src/app/[locale]/pipelines/_components/PipelinePageClient.tsx` as exemplar
- Verify `src/components/pipelines/PipelineStatus.tsx` as exemplar for step rendering

## Wave 1 — Backend: `/api/v1/chat/route.ts`

### Request schema
```ts
POST /api/v1/chat
Headers: x-api-key: wasi_xxx (agent key)
Body: { "question": "Is AVAX safe to invest in?" }
```

### Response schema
```ts
// Success:
{
  "answer": "string — LLM-generated human-readable summary",
  "steps": [{ "agent_slug": "...", "cost_usdc": "...", "status": "success"|"error" }],
  "receipts": [{ "step": 0, "agent_slug": "...", "cost_usdc": "...", "receipt_signature": "0x..." }],
  "total_cost_usdc": "0.230000",
  "pipeline_id": "uuid"
}

// Error:
{ "error": "string", "code": "no_agents_matched" | "compose_failed" | "missing_key" }
```

### Implementation steps:
1. Create `src/app/api/v1/chat/route.ts`
2. `export const maxDuration = 60` (Next.js timeout for long pipelines)
3. Validate: `question` string required (1-500 chars), `x-api-key` header required → 401 if missing (AC4)
4. Call `callLLM` to interpret the question into ComposeStep[]:
   - System prompt (EXACT):
   ```
   You are WasiAI's pipeline planner. Given a user question about DeFi/crypto, return a JSON array of ComposeStep objects.

   Available agents (ONLY these 5 exist in production):
   - wasi-chainlink-price: real-time token prices from Chainlink oracles (input: {"token": "SYMBOL"})
   - wasi-defi-sentiment: sentiment analysis and scam detection (input: {"token": "SYMBOL"})  
   - wasi-onchain-analyzer: on-chain token data, holder info, contract analysis (input: {"token": "SYMBOL"} or {"address": "0x..."})
   - wasi-contract-auditor: smart contract security audit (input: {"address": "0x..."})
   - wasi-risk-report: comprehensive risk report combining multiple data sources (input: {"token": "SYMBOL"})

   Rules:
   - Return ONLY a valid JSON array, no explanation
   - First step MUST have "input" with the extracted parameters
   - Subsequent steps use "pass_output": true
   - Maximum 5 steps
   - If the question is not about DeFi/crypto, return []

   Format: [{"agent_slug":"...","input":"..."},{"agent_slug":"...","pass_output":true}]
   ```
   - User content: the question
   - Config: temperature 0, maxTokens 512
5. Parse LLM response → `JSON.parse(response.result)` → validate it's an array of 1-5 objects
6. If empty array or parse fails → return `{ error: "I can only answer questions about DeFi and crypto on Avalanche.", code: "no_agents_matched" }` with 422 (AC8)
7. Forward to compose: `fetch('/api/v1/compose', ...)` internally using the same `x-api-key` header. Use absolute URL: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`
8. If compose succeeds → call `callLLM` again to generate human-readable summary:
   - System prompt: "You are a DeFi analyst. Summarize the following agent pipeline results in 2-3 clear sentences for a non-technical user. Include key numbers (prices, scores, risk ratings). Be concise."
   - User content: JSON.stringify(compose result)
   - Config: temperature 0.3, maxTokens 256
9. Return success response with `answer` (summary), steps, receipts, total_cost
10. If compose fails → return error with partial receipts (AC5)
11. Build gate: `tsc --noEmit`

## Wave 2 — Frontend: `/[locale]/chat/page.tsx`

### Create these files:
1. `src/app/[locale]/chat/page.tsx` — server component, metadata, layout
2. `src/app/[locale]/chat/_components/ChatPageClient.tsx` — client component

### ChatPageClient.tsx spec:
1. State: `question` (string), `apiKey` (string, from localStorage `wasi_api_key`), `loading` (boolean), `result` (ChatResponse | null), `error` (string | null)
2. Input: text input for question + text input for API key (pre-filled from localStorage)
3. Submit: POST to `/api/v1/chat` with `{ question }` and `x-api-key` header
4. Loading state: show spinner + "Analyzing your question..." text
5. Success state (AC2, AC3):
   - Summary text (`answer`) in a styled card
   - Steps list: each step shows agent name, cost, status badge (green/red)
   - Total cost in USDC
   - Receipts: collapsible section showing receipt signatures (truncated)
6. Error state (AC5): show error message + partial steps if any
7. No API key state (AC4): show message "You need an Agent Key to use Chat. Get one at /en/models"
8. Save apiKey to localStorage on change
9. Responsive: single column on mobile, max-w-2xl centered (AC6)
10. Use `useTranslations('chat')` for all user-facing strings (AC7)
11. Build gate: `tsc --noEmit`

### page.tsx spec:
1. `generateMetadata` → `{ title: 'Chat DeFi — WasiAI' }`
2. Render `<ChatPageClient />`
3. Simple layout: navbar already exists from parent layout
4. This page is PUBLIC — no auth check, no getUser(). The API key is entered manually by the user in the UI.

## Wave 3 — i18n messages
1. Add `chat` section to `messages/en.json`:
   ```json
   "chat": {
     "title": "Chat DeFi",
     "subtitle": "Ask any question about DeFi on Avalanche",
     "placeholder": "e.g. Is AVAX safe to invest in?",
     "send": "Analyze",
     "loading": "Analyzing your question...",
     "totalCost": "Total cost",
     "steps": "Pipeline steps",
     "receipts": "Receipts",
     "noKey": "You need an Agent Key to use Chat DeFi.",
     "getKey": "Get an Agent Key",
     "apiKeyLabel": "Agent Key",
     "errorGeneric": "Something went wrong. Please try again.",
     "noAgents": "I can only answer questions about DeFi and crypto on Avalanche.",
     "summary": "Summary"
   }
   ```
2. Add equivalent `chat` section to `messages/es.json` in Spanish
3. Build gate: `tsc --noEmit`

## Wave 4 — Navigation link + i18n nav key
1. Add `{ href: '/chat', key: 'chat' }` to `NAV_ITEMS` in `src/features/auth/components/NavBar.tsx` (after pipelines)
2. Add chat entry to `src/components/WasiNavBar.tsx` create menu items array (after pipelines line ~112). Use `MessageCircle` icon from lucide-react.
3. Add chat entry to `src/features/auth/components/BottomTabBar.tsx` in BOTH logged-in AND logged-out item arrays (chat is public). Use `MessageCircle` icon.
4. Add `"chat": "Chat DeFi"` to `nav` section in `messages/en.json`
5. Add `"chat": "Chat DeFi"` to `nav` section in `messages/es.json`
6. Build gate: `tsc --noEmit`
7. Commit message: `feat(chat): Chat DeFi conversational interface WAS-255`

## Rollback
1. Delete `src/app/api/v1/chat/route.ts`
2. Delete `src/app/[locale]/chat/` directory
3. Remove `chat` section from `messages/en.json` and `messages/es.json`
4. Remove nav link

## Critical Constraints
- OBLIGATORIO: `maxDuration = 60` in chat route (pipeline can take 40s+)
- OBLIGATORIO: use `callLLM` from `@/lib/agents/llm` (NOT callGroq directly)
- OBLIGATORIO: temperature 0 for question→steps mapping (deterministic)
- OBLIGATORIO: max 5 steps in generated pipeline
- OBLIGATORIO: fail-open — if summary LLM fails, return raw compose result as answer
- PROHIBIDO: streaming / SSE (single response)
- PROHIBIDO: store conversation history
- PROHIBIDO: allow more than 500 chars in question
- PROHIBIDO: call compose directly from frontend (must go through /api/v1/chat)
- NOTA: compose uses `x-api-key` header (not `x-agent-key`)
- NOTA: receipts are EIP-712 off-chain signatures, NOT on-chain tx hashes — no Snowtrace links
- NOTA: use existing Tailwind classes and WasiAI design language (rounded cards, gray-900 text, avax-600 accents)
- NOTA: chat page is PUBLIC — no auth required. API key entered manually in UI.
- NOTA: nav links must be added to ALL 3 nav components: WasiNavBar.tsx, NavBar.tsx, BottomTabBar.tsx
- NOTA: self-fetch to compose uses `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`
