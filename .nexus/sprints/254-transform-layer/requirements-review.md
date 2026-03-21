# Requirements Review — WAS-254: Transform Layer LLM en /compose

**Reviewer:** Requirements Reviewer (subagent)  
**Date:** 2026-03-20  
**Verdict:** ⚠️ NECESITA CAMBIOS

---

## Findings

| # | Type | Severity | Detail | Suggested AC |
|---|------|----------|--------|--------------|
| F1 | **CONFLICT** | 🔴 CRITICAL | **AC1 conflicts with existing input validation.** Line ~647 in `compose/route.ts` validates `stepInput` against `input_schema` BEFORE calling any transform. If the transform hasn't run yet, valid raw output will be rejected as malformed. The transform must run BEFORE the existing `validateInput()` call, not after. No AC mentions this ordering constraint. | Add to AC1: "THE SYSTEM SHALL apply the LLM transform BEFORE the existing `validateInput()` guard at line ~647 in compose/route.ts, so that the validated payload is already in the target schema format." |
| F2 | **MISSING AC** | 🔴 CRITICAL | **Together AI 402 (billing failure) is not an error code covered by AC5.** AC5 lists fallback for 401/429/5xx — but 402 is a 4xx that is NOT 401. Together AI is currently returning 402. The fallback chain will NOT catch it and will throw. | Add: "WHEN a provider returns 402, THE SYSTEM SHALL treat it as a non-retryable failure and skip to the next provider in the chain (or fall back to raw output if no providers remain)." |
| F3 | **MISSING AC** | 🔴 CRITICAL | **No AC for the case where ALL providers fail.** AC5 defines a chain (Groq → Cerebras → Together), but never specifies what happens when all three fail. Should it raise an error or fall back to raw output like AC2? | Add: "WHEN all LLM providers in the fallback chain fail, THE SYSTEM SHALL fall back to raw output (same behavior as AC2 — no pipeline break)." |
| F4 | **MISSING AC** | 🟠 HIGH | **No AC defines the LLM prompt / transformation instruction.** The transform function needs to call an LLM with some prompt. Without a specified prompt template, implementations will diverge and QA cannot write a deterministic test. | Add: "THE SYSTEM SHALL prompt the LLM with the raw output and the target JSON Schema, instructing it to return a JSON object conforming to the schema. The prompt SHALL include the raw output verbatim and the schema stringified." |
| F5 | **MISSING AC** | 🟠 HIGH | **No AC covers `input_schema` type safety.** `AgentRow.input_schema` is typed `unknown | null`. There is no AC specifying how to handle schemas that are not valid JSON Schema objects (e.g., a string, a number, a boolean). The transform function will fail unpredictably. | Add: "WHEN `input_schema` is not a valid JSON object (non-null), THE SYSTEM SHALL skip the LLM transform and pass the raw output, logging a warning." |
| F6 | **MISSING AC** | 🟠 HIGH | **No AC covers `pass_output: true` on the FIRST step (index 0).** By current code, `stepInput` for index 0 always uses `step.input ?? ''` regardless of `pass_output`. AC1 says "step N" which could imply step 0. If step 0 somehow has `pass_output: true` + `input_schema`, behavior is undefined. | Add explicit exclusion: "AC1 applies only to steps where N > 0 (i.e., there is a preceding step to pass output from). For N = 0, `pass_output` is ignored." |
| F7 | **EDGE CASE** | 🟡 MEDIUM | **No AC for when the LLM transform output is valid JSON but does NOT conform to the schema.** AC2 only covers invalid JSON. If the LLM returns syntactically valid JSON that still fails schema validation, the existing `validateInput()` will reject it with a 422. This could "break the pipeline" in contradiction to AC2's intent. | Add: "WHEN the LLM transform returns valid JSON that fails schema validation, THE SYSTEM SHALL fall back to raw output (consistent with AC2 intent) rather than returning a 422." OR clarify that 422 is acceptable in this case. |
| F8 | **EDGE CASE** | 🟡 MEDIUM | **No timeout specified for the LLM transform call.** The transform adds a synchronous LLM call per step. If Cerebras goes down and all fallbacks are slow, the pipeline can hang. No max latency or timeout is defined. | Add: "THE SYSTEM SHALL apply a 10-second timeout per provider attempt in the fallback chain. If the timeout is exceeded, it SHALL proceed to the next provider." |
| F9 | **EDGE CASE** | 🟡 MEDIUM | **No AC covers large outputs.** If step N produces a 50KB output, passing it verbatim to an LLM context window may exceed token limits. No truncation or chunking strategy is specified. | Add: "WHEN the raw output to be transformed exceeds N characters (suggested: 8,000), THE SYSTEM SHALL truncate it before sending to the LLM and log a warning." |
| F10 | **OBSERVABILITY** | 🟡 MEDIUM | **No AC for logging or tracing the transform.** There is no requirement to log which provider was used, whether a transform occurred, or the transform latency. This will make debugging production failures very hard. | Add: "THE SYSTEM SHALL log (at debug level) for each transform: the provider used, latency_ms, whether fallback was triggered, and whether raw fallback was applied." |
| F11 | **SCOPE CONCERN** | 🟡 MEDIUM | **CEREBRAS_API_KEY and TOGETHER_API_KEY added to `env.ts` but no validation behavior specified.** Should the API fail at startup if both are missing? Or should it silently skip those providers? Scope IN adds the keys but doesn't say if they're required or optional. | Clarify: "CEREBRAS_API_KEY and TOGETHER_API_KEY SHALL be optional in env.ts. If a key is absent, that provider SHALL be skipped in the fallback chain." |
| F12 | **PATH COVERAGE** | 🟢 LOW | **AC4 ("pipeline of 3 agents completes successfully") is an integration test AC, not a unit-testable assertion.** It's valid as an acceptance test but needs a concrete test fixture: what are the 3 agents, what schemas do they have, what outputs do they produce? Without this, QA will interpret AC4 differently. | Recommend: supplement AC4 with a test fixture definition (agent slugs, schemas, sample outputs) in the sprint test plan. |
| F13 | **PATH COVERAGE** | 🟢 LOW | **No AC for concurrency: what if two pipelines run simultaneously and both trigger transforms?** Transforms are stateless LLM calls so likely safe, but worth calling out explicitly. | Mark as out-of-scope explicitly, or add: "LLM transform calls are stateless and require no synchronization between concurrent pipeline executions." |

---

## AC Quality Assessment

| AC | Has SHALL | Has WHEN/IF | Testable Assertion | Issues |
|----|-----------|-------------|-------------------|--------|
| AC1 | ✅ | ✅ | ⚠️ Partial — no prompt spec, ordering conflict with validateInput | F1, F4, F5, F6 |
| AC2 | ✅ | ✅ | ⚠️ Partial — doesn't cover LLM-returns-valid-but-wrong-schema | F7 |
| AC3 | ✅ | ✅ | ✅ Clear and complete | — |
| AC4 | ✅ | ✅ | ⚠️ No fixture defined, not unit-testable | F12 |
| AC5 | ✅ | ✅ | ⚠️ Misses 402, misses all-providers-fail path | F2, F3 |

---

## Critical Blockers (must fix before dev starts)

1. **F1** — Transform must run BEFORE `validateInput()`. Fix the ordering in AC1 or it will produce spurious 422s on every chained step with a schema.
2. **F2** — Together AI returns 402 today. AC5 won't catch it. The fallback chain will throw instead of continuing.
3. **F3** — No behavior defined when all providers fail. Implementation will guess (likely throw 500, breaking pipeline).

---

## Verdict

**NECESITA CAMBIOS**

Three critical gaps (F1, F2, F3) will cause incorrect behavior at runtime given the known state of the environment (Groq 401, Together 402). F4 (no prompt spec) will make QA impossible. Recommend addressing F1–F5 before dev starts. F6–F13 can be addressed in a quick AC amendment or noted in the SDD.
