# WasiAI — Roadmap

> Construyendo el marketplace de la economía agentica.
> Última actualización: 2026-02-21

---

## Visión

WasiAI es la capa de acceso a servicios de IA para la economía agentica.
Donde los agentes compran capacidades, no especulan con tokens.

**Tesis:** Los agentes de IA van a manejar capital real. Necesitan un marketplace
donde puedan descubrir, pagar y usar modelos de forma autónoma — sin humanos en el loop.
Ese marketplace es WasiAI.

---

## ✅ Sprint 0 — Base (completado 2026-02-20)

- [x] Scaffold NexusFactory Hybrid + Supabase + Avalanche + Pimlico
- [x] Auth (email, Supabase) + auto-crear creator_profile
- [x] Homepage marketplace (grid, filtros, hero)
- [x] /models/[slug] — detalle de modelo
- [x] /publish — wizard para publicar modelos (Zod validation)
- [x] /creator/dashboard — stats reales de Supabase
- [x] POST /api/models — crear modelos con auth
- [x] POST/GET /api/v1/models/[slug]/invoke — x402 flow base
- [x] GET /api/v1/models — discovery API machine-readable
- [x] /agent-keys — UI + API + service (create, revoke, validate)
- [x] POST /api/v1/mcp — WasiAI como servidor MCP
- [x] Schema Supabase + RLS (migrations 003 + 004)

---

## 🔨 Sprint 1 — Producto real (semana 2026-02-21)

### Seguridad & pagos
- [x] Validar Agent Keys contra DB en /invoke (hash SHA-256)
- [x] Budget enforcement real (increment_agent_key_spend RPC atómica)
- [x] Error codes específicos: `invalid_key`, `budget_exceeded`, `payment_required`
- [ ] Verificación real de tx_hash en Avalanche (via Snowtrace API)
- [ ] USDC real en Avalanche mainnet (wagmi + viem en PayToCallButton)
- [ ] Payout automático 80% al creator wallet on-chain

### API & endpoints
- [x] GET /api/v1/agent-keys/me — balance y status del agente
- [x] increment_agent_key_spend — función SQL atómica
- [ ] Rate limiting por key (upstash/redis o pg advisory locks)
- [ ] Webhook para creators: notificación por llamada recibida

### ERC-8004 & AgentKit
- [x] Migration 005: agent_identities table + campos en agent_keys
- [x] Ejemplo de integración: examples/agentkit-wasiai/
- [ ] POST /api/v1/agent-keys/identity — vincular wallet AgentKit
- [ ] Verificación de firma on-chain para identidades ERC-8004
- [ ] UI: "Link on-chain identity" en /agent-keys

### Deploy
- [ ] Variables de entorno en Vercel (WASIAI_TREASURY_ADDRESS, etc.)
- [ ] Deploy a wasiai.io en Vercel
- [ ] Seed inicial: 3-5 modelos demo en Supabase prod

---

## 🚀 Sprint 2 — Producto vendible (semana 3)

### Pagos reales
- [ ] Fuji testnet → Avalanche mainnet USDC
- [ ] Smart contract WasiAI: split automático 80/20 on-chain
- [ ] Historial de pagos en /creator/dashboard con tx links

### Developer experience
- [ ] /docs/agents — guía completa con ejemplos copy-paste
- [ ] Input/output schema por modelo (OpenAPI-compatible)
- [ ] Playground en /models/[slug] (probar sin wallet en testnet)
- [ ] npm package `@wasiai/sdk` — cliente para agentes en TypeScript/Python

### Producto
- [ ] Search semántico en /api/v1/models?q=...
- [ ] Ratings de modelos (1-5 estrellas, por llamada exitosa)
- [ ] Model health check (latencia, uptime del endpoint del creator)
- [ ] Modelo "featured" / "verified"

---

## 🌱 Sprint 3 — Tracción (semana 4+)

### Distribución
- [ ] Landing page separada (wasiai.io) con waitlist
- [ ] Programa early creator: 0% fee por 3 meses
- [ ] Integración directa con Coinbase AgentKit Action Registry
- [ ] Listado en ecosystem pages: Avalanche, Pimlico, Coinbase CDP

### Plataforma
- [ ] Soporte multi-chain: Base, Arbitrum, Polygon
- [ ] Streaming responses (SSE) para modelos de texto
- [ ] Batch invoke: llamar múltiples modelos en una sola request
- [ ] Composable pipelines: encadenar modelos on-platform

### Negocio
- [ ] Analytics para creators: conversión, churn de agentes, geo
- [ ] Dashboard de ingresos con proyecciones
- [ ] Programa de referidos para creators

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 15 + Tailwind + next-intl |
| Auth | Supabase Auth |
| DB | Supabase Postgres + RLS |
| Pagos | x402 + USDC + Avalanche C-Chain (43114) |
| Account Abstraction | Pimlico + ERC-4337 |
| Agent Identity | ERC-8004 (draft) |
| AgentKit | Coinbase CDP SDK |
| MCP | Model Context Protocol v1 |
| Deploy | Vercel |

---

## Métricas de éxito (6 meses)

- 100 modelos publicados
- 10,000 llamadas/mes (agentes + humanos)
- $5,000 MRR en fees de plataforma (20% de revenue bruto)
- 50 agentes con identidad ERC-8004 verificada
- Integración oficial en Coinbase AgentKit ecosystem
