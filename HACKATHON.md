# WasiAI — AlephHack Progress

> Tag `hackathon-baseline` marks the "before" state.
> `git diff hackathon-baseline..HEAD` shows all hackathon work.

## Completed HUs

| # | Issue | Feature | Commit | Date |
|---|-------|---------|--------|------|
| 1 | WAS-257 | Agent Keys balance fix | pre-baseline | 2026-03-20 |
| 2 | WAS-256 (perf) | Layout sequential awaits → Promise.all | c3204e7a0 | 2026-03-20 |
| 3 | WAS-258 (perf) | void Promise → after() in invoke | 4e0db2340 | 2026-03-20 |
| 4 | WAS-259 (perf) | Reputation 7 awaits → Promise.all | e77456808 | 2026-03-20 |
| 5 | WAS-260 (perf) | select('*') → explicit fields in invoke | a446446a8 | 2026-03-20 |
| 6 | WAS-258 | Wizard input_schema + multi-agent onboarding | d7acb70a0 | 2026-03-20 |
| 7 | WAS-259 | Multi-agent via agent key | d7acb70a0 | 2026-03-20 |
| 8 | WAS-261 | Search ?search= alias | d6bcb2a6d | 2026-03-20 |
| 9 | WAS-262 | Price formatting (no trailing zeros) | 3ec6a005b | 2026-03-20 |
| 10 | WAS-263 | Dynamic meta title + OG tags | d6bcb2a6d | 2026-03-20 |
| 11 | WAS-260 | PATCH /api/v1/agents/{slug} | 2cfb678b4 | 2026-03-20 |
| 12 | WAS-264 | GET /api/v1/creator/agents | 56c54b249 | 2026-03-20 |
| 13 | WAS-254 | **Transform Layer LLM** — compose pipeline auto-adapts output→input via LLM fallback chain | b4f2e42fe | 2026-03-20 |
| 14 | WAS-231 | Pipeline encadenamiento real (resolved by WAS-254) | b4f2e42fe | 2026-03-20 |

## Docs Updated
- API Reference: PATCH /agents/:slug + GET /creator/agents
- Creator Guide: "Managing Your Agents" section with curl examples
- README: 2 new endpoints in API table

## Key Hackathon Features
1. **LLM Transform Layer** — agents in a pipeline auto-adapt their output to the next agent's input_schema using Groq/Cerebras/Together AI fallback chain
2. **Self-service agent editing** — creators can PATCH their agents (endpoint, price, schema) without re-registering
3. **Creator dashboard API** — creators can list and monitor their agents programmatically
4. **Multi-agent onboarding** — returning creators authenticate via agent key, skip email step
5. **Input schema validation** — wizard collects input_schema, auto-generates examples

## Remaining
- [ ] WAS-255: Chat DeFi — conversational UI at /en/chat
- [ ] WAS-256: Autonomous Agent Demo
