# SDD-022 — Agent Wallets (Fase 1: Generate + UI)

**WAS-71** | Sprint 15 | Modo: QUALITY  
**Fecha:** 2026-03-02  
**Status:** SPEC_APPROVED  
**Scope:** Generar wallet por agente, cifrado AES-256-GCM, endpoints REST, UI en dashboard  
**Fuera de scope:** Pagos agente→agente autónomos (Sprint 16)

---

## 1. Contexto del codebase (Grounding)

| Archivo / Artefacto | Estado | Nota |
|---|---|---|
| `supabase/migrations/032_sandbox_credits.sql` | ✅ Existe | Última migración — próxima: `033` |
| `agents.agentkit_wallet TEXT` | ✅ Existe en DB | Solo guarda address, vacía para todos — se mantiene por compatibilidad pero los datos reales irán en `agent_wallets` |
| `src/actions/wallet.ts` | ✅ Existe | Wallet del creator (human-controlled) — NO reutilizar para agentes |
| `src/lib/security/validateEndpointUrl.ts` | ✅ Existe | Reutilizar para validar RPC endpoints si aplica |
| `src/lib/circuit-breaker/CircuitBreaker.ts` | ✅ Existe | Patrón Redis — referencia para patrones async |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | ✅ Existe (400+ líneas) | **NO TOCAR** — golden path de pagos |
| `src/app/api/v1/agents/[slug]/` | ✅ Existe | Directorio base — agregar `wallet/route.ts` aquí |
| `src/app/[locale]/creator/dashboard/_components/` | ✅ Existe | Agregar `AgentWalletSection.tsx` |
| `src/lib/agent-wallets/` | ❌ NO existe | **CREAR** |
| Endpoints `/agents/[slug]/wallet` | ❌ NO existen | **CREAR** |

---

## 2. Arquitectura — Context Map

```
Creator Dashboard (UI)
  └── AgentWalletSection.tsx
        ├── GET /api/v1/agents/[slug]/wallet  →  address + balance USDC Fuji
        └── POST /api/v1/agents/[slug]/wallet →  inicializar wallet

POST /api/v1/agents/[slug]/wallet
  ├── Auth: createClient() → session.user.id
  ├── Ownership: agents.creator_id === user.id
  ├── agentWallet.generateAgentWallet(agentId)
  │     ├── genera keypair con viem generatePrivateKey()
  │     ├── cifra private key con AES-256-GCM (AGENT_WALLET_ENCRYPTION_KEY)
  │     └── INSERT agent_wallets (agentId, encryptedKey, address)
  └── Response: { address }   ← nunca private key

GET /api/v1/agents/[slug]/wallet
  ├── Auth + Ownership (mismo patrón)
  ├── agentWallet.getAgentWalletAddress(agentId)
  ├── viem publicClient.getBalance(address) en Fuji
  └── Response: { address, balanceWei, balanceUsdc }

src/lib/agent-wallets/agentWallet.ts
  ├── validateEncryptionKey()  → se llama en import (startup fail-fast)
  ├── generateAgentWallet(agentId)
  ├── getAgentWalletAddress(agentId)
  └── getAgentWalletClient(agentId)  → WalletClient viem (key en memoria)

supabase DB
  └── agent_wallets
        ├── agent_id UUID PK
        ├── encrypted_private_key TEXT (AES-256-GCM base64)
        ├── wallet_address TEXT
        └── RLS: USING (false) — solo service role
```

---

## 3. Schema — `033_agent_wallets.sql`

```sql
-- 033_agent_wallets.sql

CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id            UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  encrypted_private_key TEXT NOT NULL,          -- AES-256-GCM, base64
  wallet_address      TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: ningún cliente puede leer ni escribir — solo service role
ALTER TABLE agent_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON agent_wallets USING (false);

-- Índice para lookup por address (futuro: balance scan)
CREATE INDEX IF NOT EXISTS idx_agent_wallets_address ON agent_wallets(wallet_address);
```

> **Rationale:** Se usa tabla separada (no columna en `agents`) para:
> - Aplicar RLS más restrictiva sin afectar queries existentes de `agents`
> - Evitar que `encrypted_private_key` aparezca en joins accidentales
> - La columna `agentkit_wallet` en `agents` se mantiene intacta (compatibilidad)

---

## 4. Módulo — `src/lib/agent-wallets/agentWallet.ts`

### Contratos de función

```typescript
// Fail-fast en startup — no en runtime
function validateEncryptionKey(): Buffer  // lanza si AGENT_WALLET_ENCRYPTION_KEY ausente o mal formado

// Genera keypair, cifra, persiste. Idempotente: si ya existe retorna address existente.
async function generateAgentWallet(agentId: string): Promise<{ address: string }>

// Retorna address sin descifrar nada
async function getAgentWalletAddress(agentId: string): Promise<string | null>

// Descifra en memoria y retorna WalletClient de viem (Fuji)
// Private key NUNCA serializada fuera de esta función
async function getAgentWalletClient(agentId: string): Promise<WalletClient>
```

### Cifrado AES-256-GCM

```typescript
function encrypt(plaintext: string, keyBuf: Buffer): string {
  const iv = crypto.randomBytes(12)           // 96 bits
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()             // 128 bits auth tag
  // formato: iv(12) + tag(16) + ciphertext — todo base64
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(b64: string, keyBuf: Buffer): string {
  const buf = Buffer.from(b64, 'base64')
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct  = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ct) + decipher.final('utf8')
}
```

### Supabase client

Usar `createServiceClient()` (service role) — no `createClient()` (anon) — porque RLS bloquea todo acceso anon/user a `agent_wallets`.

---

## 5. Endpoints REST

### `POST /api/v1/agents/[slug]/wallet`

**Auth:** sesión Supabase (createClient → session.user.id)  
**Ownership:** `agents.creator_id === user.id`  

```
Request:  POST /api/v1/agents/defi-risk/wallet
          { } (body vacío o ignorado)

Response 200 (nueva o existente):
  { "address": "0x..." }

Response 401: { "error": "Unauthorized" }
Response 403: { "error": "Not owner" }
Response 500: { "error": "Internal error" }
```

**Flujo:**
1. `createClient()` → `getUser()` → 401 si no hay sesión
2. Lookup `agents` por slug → `creator_id` → 403 si no coincide
3. `generateAgentWallet(agent.id)` → idempotente
4. Return `{ address }`

### `GET /api/v1/agents/[slug]/wallet`

```
Response 200:
  {
    "address": "0x...",
    "balanceWei": "1000000000000000",
    "balanceUsdc": "0.001"   // estimado, no precio real
  }

Response 200 (sin wallet):
  { "address": null, "balanceWei": "0", "balanceUsdc": "0" }
```

**Fuji RPC:** `https://api.avax-test.network/ext/bc/C/rpc`  
Usar `viem` `createPublicClient` con `avalancheFuji` chain.  
Balance en AVAX (getBalance) — se muestra como nativo Fuji, no USDC real (Fase 1 simplificada).

> **Nota Fase 1:** En Fuji no hay USDC real desplegado accesible fácilmente. Se retorna balance AVAX nativo de Fuji como proxy de "fondos disponibles". El label en UI dirá "Balance (Fuji AVAX)".

---

## 6. UI — `AgentWalletSection.tsx`

Componente client (`"use client"`) que se agrega al dashboard del creator para cada agente.

**Estados:**
1. **Sin wallet** → botón "Inicializar wallet" → llama POST → muestra address
2. **Con wallet** → muestra address truncada + balance Fuji + enlace Snowtrace Fuji
3. **Loading** → skeleton
4. **Error** → mensaje inline

**Props:**
```typescript
interface AgentWalletSectionProps {
  agentSlug: string
}
```

**Integración en dashboard:**  
Agregar `<AgentWalletSection agentSlug={agent.slug} />` dentro de la página existente del agente en el dashboard (sin tocar EarningsSection ni otros componentes).

---

## 7. Variables de entorno

```bash
# Requerida — 32 bytes en hex (64 chars)
AGENT_WALLET_ENCRYPTION_KEY=<hex64>

# Ya existe — RPC Fuji (o usar hardcoded fallback)
# NEXT_PUBLIC_AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
```

**Validación en startup:**
```typescript
const KEY_HEX = process.env.AGENT_WALLET_ENCRYPTION_KEY
if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error('[AgentWallet] AGENT_WALLET_ENCRYPTION_KEY must be 64 hex chars')
}
const ENCRYPTION_KEY = Buffer.from(KEY_HEX, 'hex')
```

---

## 8. Constraint Directives

### OBLIGATORIO
- ✅ `AGENT_WALLET_ENCRYPTION_KEY` validada en módulo load (no en runtime de cada request)
- ✅ `encrypted_private_key` solo en tabla `agent_wallets` — nunca en `agents` ni en caché Redis
- ✅ RLS `USING (false)` en `agent_wallets` — acceso solo via service role
- ✅ `getAgentWalletClient` descifra en memoria, retorna `WalletClient` — nunca retorna `PrivateKeyAccount` ni string de key
- ✅ Auth + ownership check en AMBOS endpoints (POST y GET)
- ✅ Idempotencia en `generateAgentWallet` — INSERT con ON CONFLICT DO NOTHING o check previo
- ✅ Balance 0 → retornar `{ balanceWei: "0" }` — no error
- ✅ Usar `createServiceClient()` para queries a `agent_wallets`

### PROHIBIDO
- ❌ Private key en logs (`console.log`, `console.error`, Sentry breadcrumbs)
- ❌ Private key en Response body (ningún endpoint)
- ❌ Private key en variables de entorno del cliente (`NEXT_PUBLIC_*`)
- ❌ Tocar `src/app/api/v1/models/[slug]/invoke/route.ts`
- ❌ Implementar pagos agente→agente (Sprint 16)
- ❌ Usar `createClient()` (anon) para queries a `agent_wallets` — RLS bloqueará
- ❌ Almacenar private key sin cifrar en ningún medio

---

## 9. Acceptance Criteria (EARS)

| # | EARS | Verificación |
|---|------|------|
| AC-1 | WHEN creator llama POST /wallet → se genera keypair, se cifra y guarda en `agent_wallets`, retorna `{ address }` | curl POST → ver address en response |
| AC-2 | IF wallet ya existe → POST retorna misma address sin crear duplicado | curl POST dos veces → misma address |
| AC-3 | WHEN GET /wallet → retorna `{ address, balanceWei, balanceUsdc }` | curl GET → JSON con address |
| AC-4 | IF `AGENT_WALLET_ENCRYPTION_KEY` ausente → módulo lanza en startup, app no arranca | unset var → `next build` o `next start` falla |
| AC-5 | WHEN private key se descifra en `getAgentWalletClient` → no aparece en Response ni logs | grep logs, inspeccionar network tab |
| AC-6 | WHEN balance Fuji = 0 → retorna `balanceWei: "0"`, no error 500 | curl GET agente sin fondos |
| AC-7 | WHEN user no es owner → POST y GET retornan 403 | curl con sesión de otro user |
| AC-8 | UI muestra address truncada + balance + botón copiar | inspección visual en dashboard |

---

## 10. Definition of Done

- [ ] Migración `033_agent_wallets.sql` aplicada en Supabase (manual via dashboard o CLI)
- [ ] `src/lib/agent-wallets/agentWallet.ts` implementado con tests unitarios del cifrado
- [ ] POST + GET `/api/v1/agents/[slug]/wallet` funcionan en local
- [ ] `AgentWalletSection.tsx` renderiza en dashboard sin romper nada
- [ ] `npm run build` 0 errores, 0 type errors
- [ ] Private key verificada: no aparece en logs ni responses (revisión manual)
- [ ] `AGENT_WALLET_ENCRYPTION_KEY` documentada en `.env.example`
- [ ] git push master + master:main

---

## 11. Fuera de Scope (Sprint 16)

- Pagos autónomos agente→agente desde `invoke`
- Transferencias USDC real (Mainnet)
- UI de transacciones / historial
- Multi-chain (solo Fuji en Fase 1)
- Recuperación de wallet / key rotation
