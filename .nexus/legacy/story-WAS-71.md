# Story WAS-71: Agentes con wallet propia (self-custody payments) — Fase 1

**Status:** ready-for-dev  
**Sprint:** 15 | **Épica:** Epic 14 — x402 & Payments  
**Prioridad:** P1 | **Estimación:** L (~6–8 horas)  
**Dependencias:** `032_sandbox_credits.sql` aplicada (ya está)  
**SDD:** `doc/sdd/022-agent-wallets/sdd.md`

---

## Historia de usuario

Como creator de WasiAI, quiero que cada agente tenga su propia wallet self-custody en Avalanche Fuji, para que el agente pueda recibir pagos autónomos en el futuro y yo pueda ver su dirección y balance desde el dashboard.

---

## Contexto — qué existe hoy

| Archivo | Estado |
|---------|--------|
| `supabase/migrations/032_sandbox_credits.sql` | ✅ Existe — última migración, próxima: `033` |
| `agents.agentkit_wallet TEXT` | ✅ Columna existe — solo address, vacía para todos — NO tocar |
| `src/actions/wallet.ts` | ✅ Existe — wallet del creator (humano) — NO reutilizar |
| `src/lib/security/validateEndpointUrl.ts` | ✅ Existe — reutilizar si aplica |
| `src/lib/circuit-breaker/CircuitBreaker.ts` | ✅ Existe — patrón Redis de referencia |
| `src/app/api/v1/agents/[slug]/` | ✅ Existe — directorio base |
| `src/app/[locale]/creator/dashboard/_components/` | ✅ Existe — EarningsSection, WebhooksPanel, etc. |
| `src/lib/agent-wallets/` | ❌ NO existe — CREAR |
| Endpoints `/agents/[slug]/wallet` | ❌ NO existen — CREAR |
| Tabla `agent_wallets` | ❌ NO existe — CREAR con migración `033` |

---

## Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `supabase/migrations/033_agent_wallets.sql` |
| CREAR | `src/lib/agent-wallets/agentWallet.ts` |
| CREAR | `src/app/api/v1/agents/[slug]/wallet/route.ts` |
| CREAR | `src/app/[locale]/creator/dashboard/_components/AgentWalletSection.tsx` |
| MODIFICAR | `src/app/[locale]/creator/dashboard/page.tsx` (o componente que renderiza por agente) — agregar `<AgentWalletSection>` |
| **NO TOCAR** | `src/app/api/v1/models/[slug]/invoke/route.ts` |
| **NO TOCAR** | Ninguna migración anterior |
| **NO TOCAR** | `agents.agentkit_wallet` — dejar como está |

---

## Migración `033_agent_wallets.sql`

```sql
-- 033_agent_wallets.sql
-- Tabla de wallets self-custody por agente
-- RLS: USING (false) → solo service role puede acceder

CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id              UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  encrypted_private_key TEXT NOT NULL,     -- AES-256-GCM, formato: base64(iv[12] + tag[16] + ciphertext)
  wallet_address        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS estricto: ningún cliente puede leer ni escribir directamente
ALTER TABLE agent_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON agent_wallets USING (false);

-- Índice para lookup por address
CREATE INDEX IF NOT EXISTS idx_agent_wallets_address ON agent_wallets(wallet_address);
```

---

## W0 — Setup (serial, primero)

### Tarea 0.1 — Variables de entorno

Agregar a `.env.local` y `.env.example`:

```bash
# 32 bytes en hex (64 caracteres) — generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AGENT_WALLET_ENCRYPTION_KEY=<hex64>
```

### Tarea 0.2 — Aplicar migración

```bash
# Opción A: Supabase CLI
supabase db push

# Opción B: Dashboard Supabase → SQL Editor → pegar 033_agent_wallets.sql
```

---

## W1 — Implementación (paralela tras W0)

### Tarea 1.1 — `src/lib/agent-wallets/agentWallet.ts`

```typescript
/**
 * agentWallet.ts — Self-custody wallets para agentes en Avalanche Fuji
 *
 * WAS-71 Fase 1: generate + store + address lookup
 * Fase 2 (Sprint 16): pagos autónomos agente→agente
 *
 * SEGURIDAD:
 * - Private key cifrada con AES-256-GCM (AGENT_WALLET_ENCRYPTION_KEY)
 * - NUNCA serializada fuera de getAgentWalletClient()
 * - Solo acceso via service role (RLS USING false en agent_wallets)
 */
import crypto from 'crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, createPublicClient, http, formatEther } from 'viem'
import { avalancheFuji } from 'viem/chains'
import { createServiceClient } from '@/lib/supabase/service'  // service role

// ── Fail-fast en startup ──────────────────────────────────────────────────────
const KEY_HEX = process.env.AGENT_WALLET_ENCRYPTION_KEY
if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error(
    '[AgentWallet] AGENT_WALLET_ENCRYPTION_KEY must be set and 64 hex chars (32 bytes). ' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  )
}
const ENCRYPTION_KEY = Buffer.from(KEY_HEX, 'hex')

// ── Crypto helpers ────────────────────────────────────────────────────────────
function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct  = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ct).toString('utf8') + decipher.final('utf8')
}

// ── Public client Fuji ────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
})

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Genera keypair, cifra private key, persiste en agent_wallets.
 * Idempotente: si ya existe, retorna address existente.
 */
export async function generateAgentWallet(
  agentId: string
): Promise<{ address: string }> {
  const supabase = createServiceClient()

  // Idempotencia: check si ya existe
  const { data: existing } = await supabase
    .from('agent_wallets')
    .select('wallet_address')
    .eq('agent_id', agentId)
    .single()

  if (existing) {
    return { address: existing.wallet_address }
  }

  // Generar keypair
  const privateKey = generatePrivateKey()            // `0x${string}`
  const account    = privateKeyToAccount(privateKey)
  const address    = account.address

  // Cifrar
  const encryptedPrivateKey = encrypt(privateKey)

  // Persistir
  const { error } = await supabase.from('agent_wallets').insert({
    agent_id:              agentId,
    encrypted_private_key: encryptedPrivateKey,
    wallet_address:        address,
  })

  if (error) {
    // Race condition: otro request insertó primero → retornar existente
    if (error.code === '23505') {
      const { data: race } = await supabase
        .from('agent_wallets')
        .select('wallet_address')
        .eq('agent_id', agentId)
        .single()
      return { address: race!.wallet_address }
    }
    throw new Error(`[AgentWallet] Failed to persist wallet: ${error.message}`)
  }

  return { address }
}

/**
 * Retorna address de la wallet del agente sin descifrar nada.
 * Retorna null si el agente no tiene wallet.
 */
export async function getAgentWalletAddress(
  agentId: string
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('agent_wallets')
    .select('wallet_address')
    .eq('agent_id', agentId)
    .single()
  return data?.wallet_address ?? null
}

/**
 * Retorna balance AVAX nativo en Fuji (wei como string).
 * Balance 0 retorna "0", no lanza error.
 */
export async function getAgentWalletBalance(
  address: string
): Promise<{ balanceWei: string; balanceFormatted: string }> {
  try {
    const bal = await publicClient.getBalance({ address: address as `0x${string}` })
    return {
      balanceWei:       bal.toString(),
      balanceFormatted: formatEther(bal),
    }
  } catch {
    return { balanceWei: '0', balanceFormatted: '0' }
  }
}

/**
 * Descifra private key en memoria y retorna WalletClient de viem.
 * La private key NUNCA sale de esta función.
 * Para uso en Sprint 16 (pagos autónomos) — ya disponible en Fase 1.
 */
export async function getAgentWalletClient(agentId: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('agent_wallets')
    .select('encrypted_private_key')
    .eq('agent_id', agentId)
    .single()

  if (error || !data) {
    throw new Error(`[AgentWallet] No wallet found for agent ${agentId}`)
  }

  const privateKey = decrypt(data.encrypted_private_key) as `0x${string}`
  const account    = privateKeyToAccount(privateKey)

  return createWalletClient({
    account,
    chain:     avalancheFuji,
    transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
  })
}
```

**Nota sobre `createServiceClient`:** Si no existe `src/lib/supabase/service.ts`, crearlo como:
```typescript
// src/lib/supabase/service.ts
import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
```

---

### Tarea 1.2 — `src/app/api/v1/agents/[slug]/wallet/route.ts`

```typescript
/**
 * POST /api/v1/agents/[slug]/wallet — inicializar wallet del agente
 * GET  /api/v1/agents/[slug]/wallet — address + balance Fuji
 *
 * WAS-71 — Auth: sesión Supabase + ownership check
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateAgentWallet,
  getAgentWalletAddress,
  getAgentWalletBalance,
} from '@/lib/agent-wallets/agentWallet'

interface Params { params: { slug: string } }

async function getAgentWithOwnership(slug: string, userId: string) {
  const supabase = await createClient()
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, creator_id')
    .eq('slug', slug)
    .single()

  if (error || !agent) return { agent: null, error: 'not_found' }
  if (agent.creator_id !== userId) return { agent: null, error: 'forbidden' }
  return { agent, error: null }
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agent, error } = await getAgentWithOwnership(params.slug, user.id)
  if (error === 'not_found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (error === 'forbidden')  return NextResponse.json({ error: 'Not owner' }, { status: 403 })

  try {
    const { address } = await generateAgentWallet(agent!.id)
    return NextResponse.json({ address })
  } catch (err) {
    console.error('[POST /wallet] Error:', (err as Error).message)  // ← solo message, no stack con key
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agent, error } = await getAgentWithOwnership(params.slug, user.id)
  if (error === 'not_found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (error === 'forbidden')  return NextResponse.json({ error: 'Not owner' }, { status: 403 })

  const address = await getAgentWalletAddress(agent!.id)

  if (!address) {
    return NextResponse.json({ address: null, balanceWei: '0', balanceFormatted: '0' })
  }

  const { balanceWei, balanceFormatted } = await getAgentWalletBalance(address)
  return NextResponse.json({ address, balanceWei, balanceFormatted })
}
```

---

### Tarea 1.3 — `AgentWalletSection.tsx`

```typescript
'use client'
/**
 * AgentWalletSection.tsx — UI: wallet self-custody del agente en Fuji
 *
 * WAS-71 Fase 1: address + balance + inicializar
 * Patrón: mismo que WebhooksPanel.tsx (client component, fetch directo)
 */
import { useState, useEffect, useCallback } from 'react'

interface WalletData {
  address: string | null
  balanceWei: string
  balanceFormatted: string
}

interface AgentWalletSectionProps {
  agentSlug: string
}

export function AgentWalletSection({ agentSlug }: AgentWalletSectionProps) {
  const [wallet, setWallet]     = useState<WalletData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [initializing, setInit] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)

  const fetchWallet = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/agents/${agentSlug}/wallet`)
      if (!res.ok) throw new Error('Error cargando wallet')
      const data = await res.json()
      setWallet(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [agentSlug])

  useEffect(() => { fetchWallet() }, [fetchWallet])

  async function initWallet() {
    setInit(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/agents/${agentSlug}/wallet`, { method: 'POST' })
      if (!res.ok) throw new Error('Error inicializando wallet')
      await fetchWallet()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setInit(false)
    }
  }

  function copyAddress() {
    if (!wallet?.address) return
    navigator.clipboard.writeText(wallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fujiExplorer = wallet?.address
    ? `https://testnet.snowscan.xyz/address/${wallet.address}`
    : null

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6 animate-pulse">
        <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
        <div className="h-4 w-64 bg-gray-100 rounded" />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900">Wallet del Agente</h3>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Fuji Testnet</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}

      {!wallet?.address ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            Este agente no tiene wallet propia. Inicializa una para habilitar pagos autónomos en el futuro.
          </p>
          <button
            onClick={initWallet}
            disabled={initializing}
            className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {initializing ? 'Inicializando…' : 'Inicializar wallet'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded font-mono">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </code>
            <button
              onClick={copyAddress}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
            {fujiExplorer && (
              <a
                href={fujiExplorer}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Ver en explorer ↗
              </a>
            )}
          </div>
          <p className="text-sm text-gray-600">
            Balance (Fuji AVAX): <span className="font-medium">{wallet.balanceFormatted} AVAX</span>
          </p>
          <p className="text-xs text-gray-400">
            Los pagos agente→agente estarán disponibles en Sprint 16.
          </p>
        </div>
      )}
    </section>
  )
}
```

---

## W2 — Integración UI (tras 1.3)

### Tarea 2.1 — Agregar AgentWalletSection al dashboard

Localizar el componente que renderiza la vista individual de agente en el creator dashboard (probablemente `src/app/[locale]/creator/dashboard/page.tsx` o un componente hijo).

Buscar con: `grep -rn "WebhooksPanel\|EarningsSection" src/app/[locale]/creator/` para encontrar el punto de integración exacto.

Agregar:
```typescript
import { AgentWalletSection } from './_components/AgentWalletSection'

// Dentro del JSX, junto a WebhooksPanel:
<AgentWalletSection agentSlug={agent.slug} />
```

---

## Anti-Hallucination Protocol

Antes de implementar, verificar:

1. **`createServiceClient`** — ¿existe `src/lib/supabase/service.ts`?  
   ```bash
   ls src/lib/supabase/
   ```
   Si no existe, crear según el exemplar de Tarea 1.1.

2. **`createClient` server** — verificar import path:  
   ```bash
   head -5 src/app/api/v1/agents/[slug]/route.ts
   ```

3. **`agents` table columns** — verificar que `creator_id` y `slug` existen:  
   ```bash
   grep -n "creator_id\|slug" supabase/migrations/000000000000*.sql | head -10
   ```

4. **viem imports** — verificar versión instalada:  
   ```bash
   grep '"viem"' package.json
   ```
   `generatePrivateKey` y `privateKeyToAccount` disponibles desde viem v1+.

5. **`avalancheFuji` chain** — disponible en `viem/chains` desde v1.x:
   ```bash
   node -e "const {avalancheFuji} = require('viem/chains'); console.log(avalancheFuji.id)"
   ```

---

## Contrato de integración

### POST `/api/v1/agents/[slug]/wallet` → `AgentWalletSection`
```
Request:  POST /api/v1/agents/defi-risk/wallet  (body vacío)
Headers:  Cookie: <sesión Supabase>

Response 200: { "address": "0xABC...123" }
Response 401: { "error": "Unauthorized" }
Response 403: { "error": "Not owner" }
Response 404: { "error": "Agent not found" }
Response 500: { "error": "Internal error" }
```

### GET `/api/v1/agents/[slug]/wallet` → `AgentWalletSection`
```
Response 200 (con wallet):
{
  "address": "0xABC...123",
  "balanceWei": "1000000000000000",
  "balanceFormatted": "0.001"
}

Response 200 (sin wallet):
{
  "address": null,
  "balanceWei": "0",
  "balanceFormatted": "0"
}
```

### `generateAgentWallet` → `agent_wallets` DB
```
INSERT agent_wallets:
  agent_id:              UUID (del agente)
  encrypted_private_key: base64(iv[12] + authTag[16] + ciphertext)
  wallet_address:        "0x..." (EVM address)
  created_at:            now()
```

---

## Acceptance Criteria — Verificación

| AC | Escenario | Comando de verificación |
|----|-----------|------------------------|
| AC-1 | POST → genera wallet nueva | `curl -X POST .../wallet -H "Cookie:..."` → `{ address: "0x..." }` |
| AC-2 | POST idempotente | `curl POST` × 2 → misma address |
| AC-3 | GET → address + balance | `curl GET .../wallet` → JSON completo |
| AC-4 | Sin env var → startup falla | `unset AGENT_WALLET_ENCRYPTION_KEY && npm run dev` → error en consola |
| AC-5 | Key no en logs | Revisar terminal tras POST — no debe aparecer `0x` de 64 chars |
| AC-6 | Balance 0 → no error | GET agente sin fondos → `balanceWei: "0"` |
| AC-7 | Auth 401 | `curl POST` sin cookie → 401 |
| AC-8 | Ownership 403 | `curl POST` con sesión de otro creator → 403 |
| AC-9 | UI: sin wallet → botón init | Abrir dashboard → ver sección con botón |
| AC-10 | UI: con wallet → address + balance | Tras init → ver address truncada + balance |

---

## DoD — Checklist de entrega

- [ ] `033_agent_wallets.sql` creada y aplicada
- [ ] `AGENT_WALLET_ENCRYPTION_KEY` en `.env.local` y `.env.example`
- [ ] `src/lib/supabase/service.ts` existe (crear si no)
- [ ] `src/lib/agent-wallets/agentWallet.ts` implementado
- [ ] POST + GET `/api/v1/agents/[slug]/wallet/route.ts` implementados
- [ ] `AgentWalletSection.tsx` integrado en dashboard
- [ ] `npm run build` → 0 errores TypeScript
- [ ] Revisión manual: private key no aparece en logs ni network tab
- [ ] `git push origin master && git push origin master:main`

---

## Fuera de Scope — Sprint 16

- ❌ Pagos agente→agente autónomos en `invoke`
- ❌ USDC real / Mainnet
- ❌ Historial de transacciones
- ❌ Key rotation / recuperación
- ❌ Multi-chain
