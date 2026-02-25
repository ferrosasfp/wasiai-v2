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
10. **Migrations numeradas:** `0XX_descripcion.sql` — próxima disponible: 015

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

## Backlog — Épicas activas

| Épica | Estado | Prioridad |
|-------|--------|-----------|
| E1 — Creators Reales | 🔜 próxima | P0 |
| E2 — SDK @wasiai/sdk | 🔜 próxima | P1 |
| E3 — Free Trial | pendiente | P2 |
| E4 — Discovery | pendiente | P2 |
| E5 — Compose API | pendiente | P3 |
| E6 — Mainnet | pendiente | P3 |
| E7 — Integraciones | pendiente | P4 |
| E8 — Transparencia | pendiente | P4 |

Ver detalle completo: `BACKLOG.md`

---

## Decisiones de arquitectura tomadas (ADRs)

| ID | Decisión | Razón |
|----|----------|-------|
| ADR-001 | Batch settlement (no per-call) | Gas ~$0.037/tx supera el 10% fee en calls de $0.02 |
| ADR-002 | refundKeyToEarnings (no withdrawKeyBalance) | Único punto de salida de USDC via withdraw() |
| ADR-003 | emergencyWithdrawKey con 30 días | Trustless exit — fondos recuperables sin WasiAI |
| ADR-004 | Receipts ECDSA por llamada | Auditoría criptográfica por el usuario |
| ADR-005 | ERC-4337 eliminado | Era leftover de plantilla con Pimlico key en NEXT_PUBLIC_ |
| ADR-006 | viem v2 reemplaza ethers.js | Golden Path — consistencia y seguridad de tipos |
| ADR-007 | Métricas fake = 0 | No datos simulados en producción |

---

*Última actualización: 2026-02-25 | Migrations aplicadas: 000–014*
