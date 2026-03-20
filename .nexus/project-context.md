# WasiAI — Project Context
> Este archivo es cargado por los agentes NexusAgil antes de operar.
> Contiene las reglas críticas, patrones y contexto que cualquier IA necesita para trabajar correctamente en este proyecto.

---

## Qué es WasiAI

Marketplace on-chain de agentes IA en Avalanche. Cualquier developer publica un agente, cualquier persona o agente autónomo lo llama y paga en USDC. El contrato liquida automáticamente 90% al creator, 10% a la plataforma.

**URL prod:** https://app.wasiai.io
**Landing:** https://wasiai.io
**Repo:** github.com/ferrosasfp/wasiai-v2
**SDK:** `@wasiai/sdk` (npm) v0.3.2
**Stack:** Next.js 14 App Router + Supabase + viem v2 + wagmi v3 + Avalanche C-Chain + Foundry

---

## Actores del sistema

| Actor | Descripción |
|-------|-------------|
| Creator | Developer que publica agentes y recibe el 90% por invocación |
| Consumer | Developer o usuario que llama agentes del marketplace |
| Agente autónomo | Agente IA que llama otros agentes vía Agent Keys, x402 o MCP sin intervención humana |
| Operator wallet | `0x46140A86C01D930d2eAA9be7b4833D42B72C5f9b` — ejecuta txs on-chain, paga gas |
| Treasury | `0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967` — recibe 10% de fees |
| Owner | `0xA8B7EB8e804028A832B5EF302458adfaE880c51c` — admin del contrato |

---

## Contratos activos

| Red | Dirección | Estado |
|-----|-----------|--------|
| **Mainnet (43114)** | `0x9316E902760f2c37CDA57c8Be01358D890a26276` | ✅ activo, verificado en Snowtrace |
| Fuji (43113) | `0x3583fb96bAB5DbBDd85CCeA1C4fCE3EfF3249F08` | ✅ activo (dev/test) |

**USDC Mainnet:** `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (Circle native)
**USDC Fuji:** `0x5425890298aed601595a70AB815c96711a31BC65`

**NUNCA usar estas direcciones deprecadas:**
- `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` (v1.2 sin fee/validaciones)
- `0x2aC90D148563CFe325220bbCB0Dec394B9292C2e` (v1.1)
- `0xB25688c47B441964d8d30b1157161Fde3e0334AA`
- `0x02e8A1c86E4D246ED281E8Cd45B2a8480B15Db71`

---

## Golden Path — Stack inmutable

### Web2
- **Framework:** Next.js 14 App Router — Server Components por defecto
- **DB:** Supabase (Postgres + Auth + RLS) — RLS activo en TODAS las tablas de usuario
- **Rate limiting:** Upstash Redis — en todos los endpoints mutantes o costosos
- **Storage:** Pinata IPFS — solo assets públicos
- **Estilos:** Tailwind CSS — sin CSS modules ni styled-components
- **i18n:** next-intl — `/messages/` para copias en `es` y `en`
- **Deploy:** Vercel — auto-deploy en push a `main`
- **Lenguaje:** TypeScript strict — sin `any` explícito en producción
- **Lint:** eslint v8.57.1 (pinned) — no upgradar
- **Tests:** vitest `^3` (pinned)

### Web3
- **Blockchain:** Avalanche C-Chain (Fuji dev, **Mainnet prod**)
- **Contratos:** Solidity 0.8.24 + Foundry — 221 tests, 6 test files
- **Lib blockchain:** viem v2 — **PROHIBIDO ethers.js**
- **Wallet React:** wagmi v3 — solo para conexión de wallet en frontend
- **Pagos:** x402 + ERC-3009 (EOA) + ERC-4337 (embedded wallets via thirdweb)
- **Identidad:** ERC-8004 — anclado on-chain en registerAgent()
- **Agent Keys:** USDC prepaid on-chain → deducción off-chain → settlement batch diario
- **Chainlink:** Price feeds (AVAX/USD: `0x0A77230d17318075983913bC2145DB16C7366156`) + Automation upkeep

---

## Reglas absolutas (nunca violar)

1. **Sin hardcodes** — contratos, URLs, keys, amounts siempre desde env vars
2. **Sin datos simulados en producción** — métricas, calls, revenue siempre reales o en cero
3. **Sin NEXT_PUBLIC_ para secrets** — API keys de terceros solo en vars de servidor
4. **Sin ethers.js** — viem en todo el codebase
5. **SSRF protection** en cualquier endpoint que haga fetch a URLs del usuario
6. **trim()** en todas las env vars leídas al arrancar
7. **RLS activo** antes de cualquier commit con tablas nuevas
8. **Push siempre:** `git push origin main` (rama única, master eliminado)
9. **Migrations numeradas:** `0XX_descripcion.sql` — próxima disponible: 074
10. **Contrato de integración condicional** — si la HU involucra comunicación entre componentes: la sección "Contrato de Integración" es BLOQUEANTE en el story file. Si NO hay comunicación: la sección se elimina.
11. **`webhook_secret` nunca en respuestas públicas** — usar `serviceClient` para reads del creator
12. **CSRF en todos los POST** que mutan estado
13. **No diagnostic deploys a prod** — test local, push solo cuando funciona
14. **Vercel Hobby plan** — crons daily only (`0 H * * *`)

---

## Patrones críticos del codebase

### Auth
```typescript
// Server: siempre así
const supabase = await createServerClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

// Service role (solo para operaciones privilegiadas)
const supabase = createServiceClient()
```

### Contrato (viem)
```typescript
// Leer contrato
import { getPublicClient } from '@/lib/viem'
const client = getPublicClient()
const result = await client.readContract({ address, abi, functionName, args })

// Escribir contrato (operator)
import { getOperatorClient } from '@/lib/viem'
const wallet = getOperatorClient()
const hash = await wallet.writeContract({ address, abi, functionName, args })
```

### Rate limiting
```typescript
import { ratelimit } from '@/lib/upstash'
const { success } = await ratelimit.limit(identifier)
if (!success) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
```

### SSRF protection
```typescript
import { validateUrl } from '@/lib/ssrf'
const safe = await validateUrl(userProvidedUrl)
if (!safe) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
```

---

## Estructura de directorios clave

```
src/
├── app/
│   ├── [locale]/          ← todas las páginas bajo i18n (en, es)
│   │   ├── (auth)/        ← páginas de autenticación
│   │   ├── (marketplace)/ ← exploración de agentes
│   │   ├── agent-keys/    ← gestión de Agent Keys (UI)
│   │   ├── creator/       ← dashboard del creator
│   │   └── admin/         ← admin panel
│   └── api/               ← 87 route handlers
│       ├── agent-keys/    ← gestión de API keys (sync-balance, balance)
│       ├── creator/       ← withdraw, wallet setup, analytics, transactions
│       ├── v1/            ← API pública (agents, invoke, mcp, compose, sandbox, chat, onboard)
│       ├── cron/          ← settle-key-batches (02:00 UTC), reconcile-onchain (03:00), reputation-batch (04:00)
│       └── admin/         ← settlement manual
├── lib/
│   ├── chain.ts           ← CHAIN_NAME, chain config
│   ├── viem.ts            ← getPublicClient, getOperatorClient
│   ├── supabase/          ← createServerClient, createServiceClient
│   ├── upstash.ts         ← ratelimit
│   ├── ssrf.ts            ← validateUrl
│   ├── agents/groq.ts     ← callGroq() — llama-3.1-8b-instant (free tier)
│   ├── settlement/        ← runSettlement, immediateSettlement
│   └── contracts/         ← WasiAIMarketplace ABI, marketplaceClient, usdcSettler
├── components/            ← componentes compartidos
└── features/              ← 18 features por dominio
    ├── agent-api/         ← agent-keys.service.ts
    ├── agents/            ├── auth/           ├── collections/
    ├── contracts/         ├── creator/        ├── docs/
    ├── home/              ├── layout/         ├── marketplace/
    ├── models/            ├── payments/       ├── publish/
    ├── reputation/        ├── storage/        ├── transactions/
    └── wallet/

contracts/
├── src/WasiAIMarketplace.sol   ← 1,432 lines, 75 functions
├── test/                        ← 221 Foundry tests, 6 test files
└── script/DeployMarketplace.s.sol

supabase/migrations/             ← 76 migrations (000–073)
.nexus/                          ← artefactos NexusAgil, sprints, methodology
```

---

## Agentes live en producción (mainnet)

| Agente | Categoría | Precio/call |
|--------|-----------|------------|
| `wasi-chainlink-price` | defi | $0.01 |
| `wasi-defi-sentiment` | defi | $0.02 |
| `wasi-onchain-analyzer` | defi | $0.05 |
| `wasi-liquidity-analyzer` | defi-risk | $0.05 |
| `wasi-wallet-profiler` | defi-risk | $0.05 |
| `wasi-contract-auditor` | security | $0.10 |
| `wasi-risk-report` | defi | $0.20 |
| `moltbook-test-agent` | defi | $0.05 |

Categorías servidas desde `agent_categories` table (no hardcoded).

---

## Endpoints principales

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/v1/models/:slug/invoke` | Invocar agente (x402 payment) |
| `POST` | `/api/v1/compose` | Pipeline multi-agente (pass_output, LLM transform) |
| `POST` | `/api/v1/sandbox/invoke/:slug` | Free trial (3 calls/día/IP/agente, sin key) |
| `GET` | `/api/v1/agents/discover` | Agent discovery por capability |
| `GET` | `/api/v1/agents/:slug` | Detalles del agente + reputación |
| `GET` | `/api/v1/agents/:slug/reputation` | Métricas de reputación |
| `POST` | `/api/v1/agents/register` | Registro programático de agentes |
| `GET` | `/api/v1/mcp` | MCP server endpoint |
| `POST` | `/api/v1/onboard/start` | Onboarding wizard (7 pasos) |
| `POST` | `/api/v1/chat` | Interfaz conversacional DeFi |
| `GET` | `/api/cron/settle-key-batches` | Cron: settlement batch diario (02:00 UTC) |
| `GET` | `/api/cron/reconcile-onchain` | Cron: sync on-chain state (03:00 UTC) |
| `GET` | `/api/cron/reputation-batch` | Cron: calcular reputación (04:00 UTC) |

---

## Modelo de pagos (referencia rápida)

### Flujo Agent Key (developer/agente autónomo) — principal
1. Developer deposita USDC on-chain via ERC-3009 → `keyBalances[keyId]`
2. Gets API key (`wasi_xxx`) mapped to on-chain key ID
3. Cada llamada: deducción instantánea off-chain (`spent_usdc += price`), recibo ECDSA
4. Cron diario (02:00 UTC): `settleKeyBatch()` on-chain → 90% earnings[creator], 10% treasury
5. **Balance display:** `remaining = budget_usdc - spent_usdc` (WAS-257 fix)
6. Al cerrar key: `refundKeyToEarnings()` → saldo va a earnings del owner
7. Si WasiAI desaparece 30 días: `emergencyWithdrawKey()` sin permiso

### Flujo x402 (humano con wallet EOA)
1. UI → 402 con requisitos de pago
2. Usuario firma EIP-712 en Core Wallet (sin gas)
3. Operator: `USDC.transferWithAuthorization` on-chain (inmediato)
4. Contrato: 90% → `earnings[creator]`, 10% → treasury
5. Creator hace `withdraw()` cuando quiera

### Flujo Embedded Wallet (Google/email)
1. ERC-4337 account abstraction via thirdweb
2. Gasless — user never needs AVAX
3. Settlement: inmediato on-chain per invocación

---

## Crons (Vercel Hobby — daily only)

| Cron | Schedule | Qué hace |
|------|----------|----------|
| `settle-key-batches` | `0 2 * * *` (02:00 UTC) | Liquida calls de Agent Keys en batch on-chain |
| `reconcile-onchain` | `0 3 * * *` (03:00 UTC) | Sincroniza estado on-chain → DB (agentes registered) |
| `reputation-batch` | `0 4 * * *` (04:00 UTC) | Calcula reputación desde invocaciones pagadas |

Settlement mode configurado en `system_config.settlement_mode = 'vercel'`.
Si se activa Chainlink Automation, el cron de Vercel se salta automáticamente.

---

## Infra y servicios

| Servicio | Detalle |
|----------|---------|
| **Supabase prod** | `caldzjhjgctpgodldqav` — PostgreSQL + Auth + RLS |
| **Supabase dev** | `bdwvrwzvsldephfibmuu` |
| **Vercel** | Auto-deploy on push to `main`. Hobby plan. |
| **Upstash Redis** | Rate limiting |
| **Pinata** | IPFS storage |
| **Groq** | `llama-3.1-8b-instant` — free tier, 14,400 req/day (transform layer, chat) |
| **cron-job.org** | Job #7393312 — backup cron trigger |
| **wasiai-agents** | Separate Vercel project (`wasiai-agents.vercel.app`) — 7 agent endpoints |

---

## Estado de sprints y épicas

### Estado general
- **Total commits:** 872+ (since Feb 20, 2026)
- **Sprints completados:** 1–15+ (ver `.nexus/_INDEX.md`)
- **Metodología:** NexusAgil v1.3 con 6 sub-agentes especializados
- **Contrato mainnet:** v1.3 con registration fee + free tier + Agent Keys + Chainlink
- **Migrations:** 000–073 aplicadas (76 total)
- **Último fix:** WAS-257 (agent key balance display)

### Bugs recientes resueltos
- WAS-244: health endpoint 401 → healthy
- WAS-245: is_available 7-day window from `app_settings`
- WAS-246: onboard session 405
- WAS-248: FTS español
- WAS-249: signup copy
- WAS-250: onboarding step 7 → 500 (webhook_secret generation)
- WAS-251: categories from DB
- WAS-252: agent_url + status active on onboarding
- WAS-257: agent key balance display (budget - spent)

### Columnas DB críticas (no confundir)
- `agent_calls.status` → `'success' | 'error'` (NO `status_code`)
- `agent_calls.latency_ms` → duración en ms (NO `duration_ms`)
- `agent_calls.payment_type` → `'api_key' | 'x402' | 'trial'`
- `agent_calls.settlement_batch_id` → FK a `key_batch_settlements.id` (null si no settled)
- `creator_profiles.id = auth.users.id` (NO hay columna `user_id` separada)
- `agent_calls.is_trial` → boolean, trials sin costo
- `agent_keys.budget_usdc` → deposit original on-chain
- `agent_keys.spent_usdc` → gastado off-chain (incrementado atómicamente por RPC)
- `agent_keys.balance_synced_at` → último sync con on-chain (WAS-218)
- `agents.webhook_secret` → secreto por agente (NUNCA exponer en API pública)
- `app_settings` → configuración dinámica (availability window, etc.)
- `agent_categories` → categorías servidas desde DB

---

## Decisiones de arquitectura tomadas (ADRs)

| ID | Decisión | Razón | Sprint |
|----|----------|-------|--------|
| ADR-001 | Batch settlement (no per-call) | Gas ~$0.037/tx supera el 10% fee en calls de $0.02 | Pre-Sprint |
| ADR-002 | refundKeyToEarnings (no withdrawKeyBalance) | Único punto de salida de USDC via withdraw() | Pre-Sprint |
| ADR-003 | emergencyWithdrawKey con 30 días | Trustless exit — fondos recuperables sin WasiAI | Pre-Sprint |
| ADR-004 | Receipts ECDSA por llamada | Auditoría criptográfica por el usuario | Pre-Sprint |
| ADR-005 | ERC-4337 via thirdweb (embedded wallets) | Gasless onboarding para non-crypto users | Sprint 10+ |
| ADR-006 | viem v2 reemplaza ethers.js | Golden Path — consistencia y seguridad de tipos | Pre-Sprint |
| ADR-007 | Métricas fake = 0 | No datos simulados en producción | Pre-Sprint |
| ADR-008 | pending_earnings_usdc = DB counter | Cron salta si no hay wallet; settled al configurar wallet | Sprint 1 |
| ADR-009 | registerAgentOnChain en PATCH status | Evita registro on-chain de drafts nunca publicados | Sprint 1 |
| ADR-010 | Categories from DB (agent_categories) | Everything from DB, nothing hardcoded | WAS-251 |
| ADR-011 | Availability window from app_settings | 7-day window configurable, not hardcoded | WAS-245 |
| ADR-012 | webhook_secret per agent | Generated at agent insert (randomBytes 32), never in public API | WAS-250 |
| ADR-013 | Settlement mode toggle | `system_config.settlement_mode` = vercel/chainlink — cron auto-skips | WAS-080 |
| ADR-014 | Agent key balance = budget - spent | Off-chain truth for display; on-chain for settlement | WAS-257 |

---

## Reglas de proceso — NexusAgil QUALITY

> Estas reglas son INVIOLABLES. Cualquier violación se documenta en la Retro.

1. **Dev no empieza sin SPEC_APPROVED** — sin excepciones, sin importar la urgencia
2. **Story File se genera DESPUÉS de SPEC_APPROVED** — nunca antes
3. **CR siempre cita archivo:línea** — "APPROVED" sin evidencia no es CR
4. **F4 QA cita archivo:línea por cada AC** — sin evidencia el AC no cuenta como PASS
5. **SM corre las 3 ceremonias** — Planning, Review y Retro — no San directamente
6. **El SM persiste el cierre de cada HU** al completar el pipeline: `_INDEX.md`, `sprint-status.yaml`, Linear
7. **Ceremonias activan el rol SM explícitamente** — primer token de respuesta es "Agente: SM"
8. **F1 Work Items son del Architect** — SM no los presenta; SM solo coordina la selección en Planning
9. **Análisis de dependencias y paralelismo es del Architect en F1** — post-SPRINT_APPROVED, no en Planning
10. **Sub-agentes son OBLIGATORIOS** — SM nunca ejecuta ni evalúa roles de Requirements, Spec, Logic, Security, QA

---

## Deuda técnica conocida

| # | Deuda | Impacto | Engram |
|---|-------|---------|--------|
| 1 | viem en serverless (wasiai-agents) | 4 agents cold start TCP por invocación | #24 |
| 2 | wasiai-agents comparte Supabase con wasiai-v2 | Blast radius risk | #25 |
| 3 | Snowtrace `gettxreceiptstatus` reporta FAILED incorrectamente | Verificar siempre con RPC directo | — |

---

*Última actualización: 2026-03-20 | Migrations aplicadas: 000–073 (76 total) | Próxima: 074 | Contrato mainnet: 0x9316E902 | Contrato Fuji: 0x3583fb96*
