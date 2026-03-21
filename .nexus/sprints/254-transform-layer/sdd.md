# SDD #254 — Transform Layer LLM en /compose

## Context
El pipeline `/api/v1/compose` ejecuta agentes en cadena, pero con `pass_output: true` el step siguiente recibe JSON crudo. No hay transformación — el agente B no entiende el output de A. Actualmente se propagan campos hardcodeados via `pipelineCtx` (líneas 590-615 de compose/route.ts). No escala.

`wasiai-v2` solo tiene `callGroq` directo sin fallback. La key de Groq da 401. Se necesita `callLLM` con fallback chain (Groq → Cerebras → Together AI).

## Acceptance Criteria (EARS)
- AC1: **When** step N (N > 0) tiene `pass_output: true` y el agente N+1 tiene `input_schema` que es un JSON object válido, **the system shall** transformar el output de N al formato del schema usando un LLM **ANTES** del `validateInput()` existente (línea ~647). Para N=0, `pass_output` se ignora.
- AC2: **When** el LLM devuelve JSON inválido O JSON válido que no conforma al schema, **the system shall** usar el output raw como fallback. NOTA: el `validateInput()` posterior puede devolver 422 si el raw tampoco conforma — esto es comportamiento correcto (el pipeline ya fallaba así antes del transform). El Builder NO debe modificar ni bypassear `validateInput()`.
- AC3: **When** el agente N+1 NO tiene `input_schema` o `input_schema` no es un object válido, **the system shall** pasar el output raw (comportamiento actual).
- AC4: **When** se ejecuta un pipeline de 3 agentes encadenados (chainlink→sentiment→risk), **the system shall** completar exitosamente con cada step recibiendo input en su formato correcto.
- AC5: **When** un LLM provider falla (401, 402, 429, 5xx), **the system shall** fallback al siguiente provider en la cadena (Groq → Cerebras → Together AI).
- AC6: **When** todos los LLM providers fallan, **the system shall** usar el output raw como fallback (fail-open, mismo comportamiento que AC2).
- AC7: **The system shall** aplicar un timeout de 10 segundos por provider. Si se excede, proceder al siguiente.
- AC8: **The system shall** loguear (console.warn) por cada transform: provider usado, latency_ms, si hubo fallback, si se aplicó raw fallback.

## Wave 0 — Pre-flight
- Verify `src/lib/agents/groq.ts` exports `callGroq` with `{ messages, model?, maxTokens?, temperature? }` returning `GroqResponse { result: string }`
- Verify `compose/route.ts` line ~639: `const stepInput = globalStepIndex === 0 ? ...`
- Verify `compose/route.ts` line ~647: `validateInput()` call happens AFTER stepInput is built
- Verify `agentMap.get(step.agent_slug)` returns agent with `input_schema: unknown | null`
- Verify `src/lib/env.ts` has `GROQ_API_KEY: z.string().optional()`

## Wave 1 — Create `src/lib/agents/llm.ts` (LLM fallback chain)
1. Create `src/lib/agents/llm.ts` — port from `wasiai-agents/src/shared/lib/agents/llm.ts`
2. Interfaces: `LLMMessage`, `LLMResult { result, model, provider, usage }`
3. Provider chain: Groq → Cerebras → Together AI
   - Groq: `https://api.groq.com/openai/v1/chat/completions`, env `GROQ_API_KEY`, model `llama-3.3-70b-versatile`
   - Cerebras: `https://api.cerebras.ai/v1/chat/completions`, env `CEREBRAS_API_KEY`, model `llama-3.3-70b`
   - Together: `https://api.together.xyz/v1/chat/completions`, env `TOGETHER_API_KEY`, model `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free`
4. Retryable errors: 401, 402, 429, 500, 502, 503 (AC5). **ALERTA: el reference implementation en wasiai-agents OMITE 402 — el Builder DEBE agregar `msg.includes('402')` explícitamente. NO copiar la lista del reference tal cual.**
5. Timeout: `AbortSignal.timeout(10_000)` per provider (AC7). **ALERTA: el reference usa 30_000 — usar 10_000, NO copiar el valor del reference.**
6. Skip providers with no API key (don't throw, just continue)
7. Export `callLLM` and backward-compat alias `export const callGroq = callLLM`
8. Build gate: `tsc --noEmit`

## Wave 2 — Add env vars
1. Add to `src/lib/env.ts`: `CEREBRAS_API_KEY: z.string().optional()`, `TOGETHER_API_KEY: z.string().optional()`
2. Add to `.env.local`: both keys (CEREBRAS and TOGETHER)
3. Build gate: `tsc --noEmit`

## Wave 3 — Create `src/lib/step-transform.ts`
1. Create new file `src/lib/step-transform.ts`
2. Import `callLLM` from `@/lib/agents/llm`
3. Export `async function transformStepOutput(previousOutput: string, targetSchema: Record<string, unknown>, targetSlug: string): Promise<string>`
4. System prompt (EXACT — do not modify):
   ```
   You are a JSON transformer. Convert the output of one AI agent into the input format required by the next agent. Return ONLY valid JSON matching the target schema. No explanation, no markdown, no code fences.
   ```
5. User prompt (EXACT template):
   ```
   Previous agent output:
   ${previousOutput}

   Target agent (${targetSlug}) expects input matching this JSON Schema:
   ${JSON.stringify(targetSchema)}

   Return the transformed JSON:
   ```
6. Config: temperature 0, maxTokens 512
7. Parse response: `callLLM` returns `LLMResult { result: string }`. Try `JSON.parse(response.result)`:
   - If valid JSON → return `JSON.stringify(parsed)`
   - If invalid JSON → log warning, return `previousOutput` (AC2 fallback)
8. Wrap entire function in try/catch → on ANY error (including all-providers-fail from AC6), log `console.warn('[step-transform] all providers failed, using raw output', { targetSlug, error: error.message, latency_ms: Date.now() - start, fallbackUsed: true })` and return `previousOutput`
9. Log on success: `console.warn('[step-transform]', { targetSlug, provider: response.provider, latency_ms: Date.now() - start, fallbackUsed: false })` (AC8)
10. Log on JSON parse failure (AC2): `console.warn('[step-transform] invalid JSON from LLM, using raw output', { targetSlug, provider: response.provider, latency_ms: Date.now() - start, fallbackUsed: true })`
10. Build gate: `tsc --noEmit`

## Wave 4 — Integrate into compose/route.ts
1. Import `transformStepOutput` from `@/lib/step-transform`
2. Replace line ~639. The transform MUST happen BEFORE `validateInput()` (line ~647). New code:
   ```ts
   // BEFORE (line ~639):
   const stepInput = globalStepIndex === 0 ? (step.input ?? '') : (step.pass_output ? (lastOutput ?? '') : (step.input ?? ''))

   // AFTER:
   let stepInput: string
   if (globalStepIndex === 0) {
     stepInput = step.input ?? ''
   } else if (step.pass_output && lastOutput) {
     const nextAgent = agentMap.get(step.agent_slug ?? '')
     if (nextAgent?.input_schema && typeof nextAgent.input_schema === 'object' && nextAgent.input_schema !== null) {
       stepInput = await transformStepOutput(lastOutput, nextAgent.input_schema as Record<string, unknown>, nextAgent.slug)
     } else {
       stepInput = lastOutput  // AC3: no schema → raw passthrough
     }
   } else {
     stepInput = step.input ?? ''
   }
   ```
3. The existing `validateInput()` block (line ~647) stays UNCHANGED and runs AFTER the transform
4. Build gate: `tsc --noEmit`
5. Commit message: `feat(compose): LLM transform layer with fallback chain between pipeline steps WAS-254`

## Rollback
1. Delete `src/lib/agents/llm.ts` and `src/lib/step-transform.ts`
2. Revert changes in `compose/route.ts` and `src/lib/env.ts`
3. Remove env vars from `.env.local`

## Critical Constraints
- OBLIGATORIO: fail-open — LLM failure must NOT break pipeline (return raw output) — AC2, AC6
- OBLIGATORIO: transform runs BEFORE validateInput() — AC1, F1 fix
- OBLIGATORIO: temperature 0 for deterministic output
- OBLIGATORIO: fallback chain order Groq → Cerebras → Together AI
- OBLIGATORIO: 401 AND 402 must be retryable — AC5, F2 fix
- OBLIGATORIO: 10s timeout per provider — AC7
- OBLIGATORIO: log transform results — AC8
- PROHIBIDO: charge the user for the transform LLM call
- PROHIBIDO: modify pipelineCtx propagation logic (lines 590-615)
- PROHIBIDO: modify existing `src/lib/agents/groq.ts`
- PROHIBIDO: modify the existing validateInput() block
- PROHIBIDO: change any other compose behavior
- NOTA: `input_schema` typed `unknown | null` — type guard `typeof === 'object' && !== null` before transform
- NOTA: parallel steps (line ~723) use `step.input` directly — no transform needed
- NOTA: `.env.local` is gitignored — Vercel env vars need manual setup by PO
- NOTA: concurrency is safe — transforms are stateless LLM calls, no synchronization needed
