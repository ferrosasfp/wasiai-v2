# 🏗️ WasiAI — AlephHack 2026

> **Marketplace de agentes IA con pagos USDC on-chain en Avalanche C-Chain**

## Qué es WasiAI

WasiAI es un marketplace donde cualquier desarrollador puede publicar agentes de IA y monetizarlos con micropagos USDC. Los consumidores pagan por invocación via protocolo x402 (HTTP 402 nativo) o API keys con budget. Todo on-chain, sin intermediarios.

- **Live:** https://app.wasiai.io
- **Repo principal:** https://github.com/ferrosasfp/wasiai-v2

## 🔖 Cómo ver los cambios del hackathon

```bash
# Ver todos los commits del hackathon
git log --oneline hackathon-baseline..HEAD

# Ver el diff completo
git diff hackathon-baseline..HEAD --stat
```

**Tag `hackathon-baseline`** = último commit antes del hackathon.
Todo lo que viene después es desarrollo nuevo para AlephHack.

---

## ✅ Features completadas durante el hackathon

### Performance — API optimizations
| Commit | Cambio | Impacto |
|--------|--------|---------|
| `c3204e7a0` | `layout.tsx`: `Promise.all` para `getMessages` + `createClient` | -50% latencia en carga de todas las páginas |
| `4e0db2340` | `after()` reemplaza void Promises en invoke payment path | Background ops no bloquean respuesta al caller |
| `e77456808` | Reputation endpoint: 7 queries secuenciales → `Promise.all` en 2 olas | ~5x más rápido |
| `a446446a8` | `select('*')` → campos explícitos en invoke hot path | Menos datos transferidos por invocación |

### Wizard Onboarding — WAS-258 + WAS-259
| Commit | Cambio |
|--------|--------|
| `c5fea4a35` | `input_schema` obligatorio en wizard (nuevo paso 7, JSON Schema format) |
| `c5fea4a35` | `example_input` auto-generado via `buildExampleFromSchema` |
| `c5fea4a35` | Multi-agent: creators pueden registrar N agentes con su `x-agent-key` existente |
| `6cc359e30` | Security fix: `metaValidateSchema` bloquea SSRF via `$ref` en wizard |
| `cb0fbbf2a` | Fix: `example_input` guardado en `metadata.input_example` (no es columna directa) |

### Bug fixes críticos
| Commit | Cambio |
|--------|--------|
| `eb5314c64` | Fix: invoke 404 en todos los agentes — `user_id` no existe como columna |

### Infra — LLM Fallback Chain (wasiai-agents)
| Repo | Cambio |
|------|--------|
| `wasiai-agents` | Fallback: Groq → Cerebras → Together AI. `callGroq()` es alias de `callLLM()` |
| `wasiai-agents` | Fix: 401 ahora es retryable — no corta el fallback chain |

---

## 🚧 En progreso

- [ ] **WAS-260** — `PATCH /api/v1/agents/{slug}` — endpoint de edición post-registro
- [ ] **WAS-256** — Autonomous Agent Demo — agente descubre, paga y orquesta sin humano
- [ ] **WAS-255** — Chat DeFi — interfaz conversacional + `/compose`
- [ ] **WAS-254** — Transform Layer LLM — output de agente A → input de agente B

---

## Stack

- **Frontend:** Next.js 14 App Router + TypeScript
- **Backend:** Supabase (Postgres + Auth + Realtime)
- **Blockchain:** Avalanche C-Chain + USDC + Viem
- **Payments:** x402 protocol (HTTP 402 native) + API keys con budget USDC
- **AI:** Multi-provider fallback (Groq → Cerebras → Together AI)
- **Methodology:** NexusAgile v1.3 (AI-driven dev pipeline with automated auditors)

## Contratos

| Red | Dirección |
|-----|-----------|
| Avalanche Mainnet | `0x9316E902760f2c37CDA57C8Be01358D890a26276` |
| USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
