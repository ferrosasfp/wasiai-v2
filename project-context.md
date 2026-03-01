# WasiAI — Project Context
> Este archivo es cargado por TODOS los agentes BMAD antes de operar.
> Contiene las reglas críticas, patrones y contexto que cualquier IA necesita para trabajar correctamente en este proyecto.

---

## Qué es WasiAI

Marketplace on-chain de agentes IA en Avalanche. Cualquier developer publica un agente, cualquier persona o agente autónomo lo llama y paga en USDC. El contrato liquida automáticamente 90% al creator, 10% a la plataforma.

**URL prod:** https://wasiai-v2.vercel.app
**Repo:** github.com/ferrosasfp/wasiai-v2
**Stack:** Next.js 14 + Supabase + viem v2 + wagmi v3 + Avalanche + Foundry

---

## Actores del sistema

| Actor | Descripción |
|-------|-------------|
| Creator | Developer que publica agentes y recibe el 90% por invocación |
| Consumer | Developer o usuario que llama agentes del marketplace |
| Agente autónomo | Agente IA que llama otros agentes vía x402 o MCP sin intervención humana |
| Operator wallet | `0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB` — ejecuta txs on-chain, paga gas |
| Treasury | `0xeC176F4f3BB71fD7288Cb7Defd09CDC427BBC70a` — recibe 10% de fees |

---

## Contratos activos

| Red | Dirección | Estado |
|-----|-----------|--------|
| Fuji (43113) | `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` | ✅ activo, verificado |
| Mainnet | pendiente | 🔒 no deployado |

**NUNCA usar estas direcciones deprecadas:**
- `0xB25688c47B441964d8d30b1157161Fde3e0334AA`
- `0x02e8A1c86E4D246ED281E8Cd45B2a8480B15Db71`

**USDC Fuji:** `0x5425890298aed601595a70AB815c96711a31BC65`

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

### Web3
- **Blockchain:** Avalanche C-Chain (Fuji dev, Mainnet prod)
- **Contratos:** Solidity 0.8.24 + Foundry — forge tests antes de cualquier deploy
- **Lib blockchain:** viem v2 — **PROHIBIDO ethers.js**
- **Wallet React:** wagmi v3 — solo para conexión de wallet en frontend
- **Pagos:** x402 + ERC-3009 + uvd-x402-sdk
- **Identidad:** ERC-8004 — anclado on-chain en registerAgent()
- **AA:** NO activo — roadmap futuro, **PROHIBIDO permissionless**

---

## Reglas absolutas (nunca violar)

1. **Sin hardcodes** — contratos, URLs, keys, amounts siempre desde env vars
2. **Sin datos simulados en producción** — métricas, calls, revenue siempre reales o en cero
3. **Sin NEXT_PUBLIC_ para secrets** — API keys de terceros solo en vars de servidor
4. **Sin ethers.js** — viem en todo el codebase
5. **Sin permissionless** — ERC-4337 es roadmap, no instalado
6. **SSRF protection** en cualquier endpoint que haga fetch a URLs del usuario
7. **trim()** en todas las env vars leídas al arrancar
8. **RLS activo** antes de cualquier commit con tablas nuevas
9. **Push siempre:** `git push origin master master:main`
10. **Migrations numeradas:** `0XX_descripcion.sql` — próxima disponible: 017
11. **Contrato de integración condicional** — si la HU involucra comunicación entre componentes (compose ↔ agente, frontend ↔ API, SDK ↔ endpoint): la sección "Contrato de Integración" es BLOQUEANTE en el story file — Dev no empieza sin ella completa. Si NO hay comunicación entre componentes: la sección se elimina del story file, no se deja vacía.

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
│   ├── [locale]/          ← todas las páginas bajo i18n
│   │   ├── (auth)/        ← páginas de autenticación
│   │   ├── (marketplace)/ ← exploración de agentes
│   │   └── creator/       ← dashboard del creator
│   └── api/
│       ├── agent-keys/    ← gestión de API keys
│       ├── creator/       ← withdraw, wallet setup
│       ├── v1/            ← API pública (agents, invoke, mcp)
│       └── cron/          ← batch settlement
├── lib/
│   ├── chain.ts           ← CHAIN_NAME, chain config
│   ├── viem.ts            ← getPublicClient, getOperatorClient
│   ├── supabase/          ← createServerClient, createServiceClient
│   ├── upstash.ts         ← ratelimit
│   └── ssrf.ts            ← validateUrl
├── components/            ← componentes compartidos
└── features/              ← features por dominio

contracts/
├── src/WasiAIMarketplace.sol
├── test/
└── script/DeployMarketplace.s.sol

supabase/migrations/       ← 000–014 aplicadas
.nexus/                    ← metodología Nexus
_bmad/                     ← agentes y workflows BMAD
```

---

## Modelo de pagos (referencia rápida)

**Flujo x402 (humano con wallet):**
1. UI → 402 con requisitos de pago
2. Usuario firma EIP-712 en Core Wallet (sin gas)
3. Operator: `USDC.transferWithAuthorization` on-chain
4. Contrato: 90% → `earnings[creator]`, 10% → treasury
5. Creator hace `withdraw()` cuando quiera

**Flujo API Key (developer/agente autónomo):**
1. Developer deposita USDC on-chain via ERC-3009 → `keyBalances[keyId]`
2. Cada llamada: firma criptográfica ECDSA del operator, anotada en DB
3. Cron diario: `settleKeyBatch()` on-chain liquida el día → earnings creators
4. Al cerrar key: `refundKeyToEarnings()` → saldo va a earnings del owner
5. Si WasiAI desaparece 30 días: `emergencyWithdrawKey()` sin permiso

---

## Estado de sprints y épicas

### Sprints cerrados
| Sprint | HUs | Commits | Tests |
|--------|-----|---------|-------|
| Sprint 1 | HU-1.1, HU-1.2, HU-1.3 | `a036cbe` | 144/144 |
| Sprint 2 | HU-1.4, HU-1.5, HU-3.1 | `4ff5ddc` | 182/182 |

### Épicas activas

| Épica | Estado | Prioridad |
|-------|--------|-----------|
| E1 — Creators Reales | ✅ COMPLETA | — |
| E2 — SDK @wasiai/sdk | 🔜 Sprint 3 | P0 |
| E3 — Free Trial | ✅ HU-3.1 done | P0 |
| E4 — Discovery | pendiente | P1 |
| E5 — Compose API | pendiente | P2 |
| E6 — Mainnet | 🔒 diferida (producto más robusto primero) | P3 |
| E7 — Integraciones | pendiente | P3 |
| E8 — Transparencia | pendiente | P4 |

Ver detalle completo: `BACKLOG.md`

### Columnas DB críticas (no confundir)
- `agent_calls.status` → `'success' | 'error'` (NO `status_code`)
- `agent_calls.latency_ms` → duración en ms (NO `duration_ms`)
- `creator_profiles.id = auth.users.id` (NO hay columna `user_id` separada)
- `agent_calls.is_trial` → boolean, trials sin costo
- `creator_profiles.username` + `creator_profiles.bio` → desde migration 016
- `agent_trials` → tabla de control de trials (1 por usuario/agente)

---

## Decisiones de arquitectura tomadas (ADRs)

Archivos completos en `.nexus/docs/architecture/`

| ID | Decisión | Razón | Sprint |
|----|----------|-------|--------|
| ADR-001 | Batch settlement (no per-call) | Gas ~$0.037/tx supera el 10% fee en calls de $0.02 | Pre-Sprint |
| ADR-002 | refundKeyToEarnings (no withdrawKeyBalance) | Único punto de salida de USDC via withdraw() | Pre-Sprint |
| ADR-003 | emergencyWithdrawKey con 30 días | Trustless exit — fondos recuperables sin WasiAI | Pre-Sprint |
| ADR-004 | Receipts ECDSA por llamada | Auditoría criptográfica por el usuario | Pre-Sprint |
| ADR-005 | ERC-4337 eliminado | Era leftover de plantilla con Pimlico key en NEXT_PUBLIC_ | Pre-Sprint |
| ADR-006 | viem v2 reemplaza ethers.js | Golden Path — consistencia y seguridad de tipos | Pre-Sprint |
| ADR-007 | Métricas fake = 0 | No datos simulados en producción | Pre-Sprint |
| ADR-008 | pending_earnings_usdc = DB counter (Option A) | Cron salta si no hay wallet; settled al configurar wallet | Sprint 1 |
| ADR-009 | registerAgentOnChain en PATCH status (no POST) | Evita registro on-chain de drafts nunca publicados | Sprint 1 |
| ADR-010 | CallsChart = barras CSS (no recharts) | Cero dependencias nuevas; entrega más rápida | Sprint 2 |
| ADR-011 | Username desde email con REGEXP_REPLACE | Sin friction en onboarding; backfill automático en migration | Sprint 2 |
| ADR-012 | Trial rate limit = lazy singleton Ratelimit | Prefix wasiai:trial, 3 req/hora por IP; aislado del rate limit principal | Sprint 2 |
| ADR-013 | creator_profiles.id = auth.users.id | Sin columna user_id separada; simplifica todas las queries | Sprint 1 |

---

| ADR-014 | Rate limiting creator por slug+api_key (HU-8.4) | Aísla por consumer y por agente. Fail-open si Upstash cae. Aplicado en invoke + compose | Sprint 5 |

---

## Reglas de proceso — NexusAgil QUALITY (Auto-Blindaje Sprint 5)

> Estas reglas son INVIOLABLES. Cualquier violación se documenta en la Retro.

1. **Dev no empieza sin SPEC_APPROVED** — sin excepciones, sin importar la urgencia
2. **Story File se genera DESPUÉS de SPEC_APPROVED** — nunca antes
3. **CR siempre cita archivo:línea** — "APPROVED" sin evidencia no es CR
4. **F4 QA cita archivo:línea por cada AC** — sin evidencia el AC no cuenta como PASS
5. **SM corre las 3 ceremonias** — Planning, Review y Retro — no San directamente
6. **El SM persiste el cierre de cada HU** al completar el pipeline: `_INDEX.md`, `sprint-status.yaml`, Linear

---

*Última actualización: 2026-02-28 | Migrations aplicadas: 000–025 | Próxima: 026*
