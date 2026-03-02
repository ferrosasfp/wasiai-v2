# WAS-71 — CR + QA Validation Report

**Fecha:** 2026-03-02  
**Reviewer:** Adversary + QA (San)  
**Rama:** master  
**Quality Gate:** `npx tsc --noEmit` → **0 errores** ✅

---

## Code Review

### CR-1: Sin `any` explícito
**✅ OK** — Búsqueda exhaustiva en los 4 archivos implementados. No hay `any` explícito.  
- `agentWallet.ts`: tipos correctos (`string`, `0x${string}`, generics de supabase)  
- `route.ts`: `(err as Error).message` — cast seguro, no `any`  
- `AgentWalletSection.tsx`: `(e as Error).message` — mismo patrón  

### CR-2: Patrones consistentes con el codebase
**✅ OK**  
- `agentWallet.ts` sigue el patrón de módulo con constantes en módulo + funciones exportadas nombradas, igual que `CircuitBreaker.ts` (sin clase innecesaria)  
- Nombres de función descriptivos y consistentes (`generateAgentWallet`, `getAgentWalletAddress`, `getAgentWalletBalance`, `getAgentWalletClient`)  
- `route.ts` usa `await createClient()` y `supabase.auth.getUser()` consistente con otros routes de `api/v1/agents/[slug]/`  
- `AgentWalletSection.tsx` sigue patrón de `useCallback + useEffect + fetch` del mismo directorio (WebhooksPanel)  
- Error casting `(err as Error)` igual que `validateEndpointUrl.ts` pattern

### CR-3: Funciones con responsabilidad única
**✅ OK**  
- `encrypt()` / `decrypt()` — solo cripto  
- `generateAgentWallet()` — generate + persist (idempotente)  
- `getAgentWalletAddress()` — solo lookup address  
- `getAgentWalletBalance()` — solo RPC balance  
- `getAgentWalletClient()` — solo decrypt + retornar WalletClient  
- `getAgentWithOwnership()` en route — solo auth + ownership check  

### CR-4: Migration idempotente
**⚠️ MENOR** — `CREATE POLICY "service_only"` sin guardia idempotente.  
- `CREATE TABLE IF NOT EXISTS` ✅  
- `CREATE INDEX IF NOT EXISTS` ✅  
- `CREATE POLICY "service_only"` ❌ — fallará si se aplica dos veces (policy ya existe)  

**Recomendación** (no bloqueante para Fase 1, ya aplicada una vez):
```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agent_wallets' AND policyname = 'service_only'
  ) THEN
    CREATE POLICY "service_only" ON agent_wallets USING (false);
  END IF;
END $$;
```

### CR-5: Sin private key en returns o logs
**✅ OK**  
- `generateAgentWallet()` retorna solo `{ address }` — nunca `encrypted_private_key` ni `privateKey`  
- `getAgentWalletAddress()` selecciona solo `wallet_address`  
- `getAgentWalletClient()` descifra en memoria, retorna `WalletClient` (no expone key)  
- `route.ts` POST retorna solo `{ address }` — `console.error` loguea solo `(err as Error).message`  
- `GET` route retorna `{ address, balanceWei, balanceFormatted }` — sin campos de key  

---

## Veredicto CR

| Item | Estado |
|------|--------|
| Sin `any` | ✅ OK |
| Patrones consistentes | ✅ OK |
| Responsabilidad única | ✅ OK |
| Migration idempotente | ⚠️ MENOR (policy sin DO block) |
| Sin private key en outputs | ✅ OK |

**→ CR: APPROVED** (1 sugerencia menor no bloqueante)

---

## F4 QA — Acceptance Criteria

### AC-1: POST → genera wallet nueva
**✅ CUMPLE**  
- `agentWallet.ts:65-93` — `generateAgentWallet()` genera keypair con `generatePrivateKey()`, cifra, persiste en `agent_wallets`  
- `route.ts:33-49` — POST handler retorna `{ address }` con status 200  
- Retorno: `NextResponse.json({ address })` — `route.ts:46`

### AC-2: POST idempotente — misma address
**✅ CUMPLE**  
- `agentWallet.ts:70-73` — check previo con `.select('wallet_address').eq('agent_id', agentId).single()` antes de generar  
- `agentWallet.ts:86-93` — race condition `23505` manejado: retorna address existente  

### AC-3: GET → address + balance
**✅ CUMPLE**  
- `route.ts:51-68` — GET handler retorna `{ address, balanceWei, balanceFormatted }`  
- `agentWallet.ts:108-118` — `getAgentWalletBalance()` llama RPC Fuji y retorna ambos formatos  

### AC-4: Sin env var → startup falla
**✅ CUMPLE**  
- `agentWallet.ts:19-24` — fail-fast en top-level module:
  ```ts
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('[AgentWallet] AGENT_WALLET_ENCRYPTION_KEY must be set…')
  }
  ```
  El módulo lanza en import si la variable no está definida o es incorrecta.

### AC-5: Key no en logs
**✅ CUMPLE**  
- `route.ts:47` — `console.error('[POST /wallet] Error:', (err as Error).message)` — solo message  
- No hay `console.log` en `agentWallet.ts` con datos de key  
- `getAgentWalletClient()` (`agentWallet.ts:128-143`) — key descifrada en memoria, no logueada  

### AC-6: Balance 0 → no error
**✅ CUMPLE**  
- `agentWallet.ts:112-116` — `catch` en `getAgentWalletBalance()` retorna `{ balanceWei: '0', balanceFormatted: '0' }` sin lanzar  
- `route.ts:59` — GET sin wallet retorna `{ address: null, balanceWei: '0', balanceFormatted: '0' }`  

### AC-7: Auth 401 sin cookie
**✅ CUMPLE**  
- `route.ts:35-37` — `if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`  
- Mismo patrón en GET: `route.ts:52-54`  

### AC-8: Ownership 403
**✅ CUMPLE**  
- `route.ts:17-20` — `getAgentWithOwnership()` compara `agent.creator_id !== userId` → `error: 'forbidden'`  
- `route.ts:39` — `if (error === 'forbidden') return NextResponse.json({ error: 'Not owner' }, { status: 403 })`  

### AC-9: UI sin wallet → botón init
**✅ CUMPLE**  
- `AgentWalletSection.tsx:75-84` — branch `!wallet?.address` renderiza párrafo + botón "Inicializar wallet"  
- Botón disabled durante `initializing` — `AgentWalletSection.tsx:79`  

### AC-10: UI con wallet → address truncada + balance
**✅ CUMPLE**  
- `AgentWalletSection.tsx:86-107` — branch con address:  
  - Address truncada: `wallet.address.slice(0, 6)}…{wallet.address.slice(-4)` — línea 88  
  - Balance: `{wallet.balanceFormatted} AVAX` — línea 99  
  - Botón copiar + link explorer ↗ — líneas 92-97  

### Integración dashboard
**✅ CUMPLE**  
- `page.tsx:12` — `import { AgentWalletSection } from './_components/AgentWalletSection'`  
- `page.tsx:297-299` — render `<AgentWalletSection key={model.id} agentSlug={model.slug} />` por agente  

---

## AC Summary

| AC | Descripción | Estado | Evidencia |
|----|-------------|--------|-----------|
| AC-1 | POST genera wallet | ✅ PASS | `agentWallet.ts:65-93`, `route.ts:33-49` |
| AC-2 | POST idempotente | ✅ PASS | `agentWallet.ts:70-73`, `agentWallet.ts:86-93` |
| AC-3 | GET address + balance | ✅ PASS | `route.ts:51-68`, `agentWallet.ts:108-118` |
| AC-4 | Sin env → error startup | ✅ PASS | `agentWallet.ts:19-24` |
| AC-5 | Key no en logs | ✅ PASS | `route.ts:47`, `agentWallet.ts` sin console.log de key |
| AC-6 | Balance 0 no lanza | ✅ PASS | `agentWallet.ts:112-116`, `route.ts:59` |
| AC-7 | Auth 401 | ✅ PASS | `route.ts:35-37`, `route.ts:52-54` |
| AC-8 | Ownership 403 | ✅ PASS | `route.ts:17-20`, `route.ts:39` |
| AC-9 | UI botón init | ✅ PASS | `AgentWalletSection.tsx:75-84` |
| AC-10 | UI address + balance | ✅ PASS | `AgentWalletSection.tsx:86-107` |

**QA: 10/10 PASS**

---

## Quality Gate

```
npx tsc --noEmit → 0 errores ✅
```

---

## Pendiente (no bloqueante)

1. **Migration policy idempotente** — wrap `CREATE POLICY` en DO block para rerunability segura  
2. **`.env.example`** — verificar que `AGENT_WALLET_ENCRYPTION_KEY=` está documentado (fuera del scope de este review)
