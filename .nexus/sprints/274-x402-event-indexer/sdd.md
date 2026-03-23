# SDD #096: x402 Event Indexer v1 — WAS-274

> SPEC_APPROVED: 2026-03-22 (PO)
> Fecha: 2026-03-22
> Tipo: feature
> SDD_MODE: full
> Branch: feat/274-x402-event-indexer

---

## 1. Resumen

Cron job que lee `KeyCallSettled` events del contrato WasiAI Marketplace on-chain y reconcilia con `agent_calls` en DB. Marca calls existentes como `on_chain_recorded = true` y detecta orphan settlements (on-chain pero sin match en DB).

**v1 scope:** Solo `KeyCallSettled` reconciliation. `AgentInvoked` detection se implementará en v2 cuando se reactive `recordInvocationOnChain`.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 096 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Reconciliar KeyCallSettled events on-chain con agent_calls en DB |
| **Scope IN** | Cron endpoint, KeyCallSettled reconciliation, vercel.json entry |
| **Scope OUT** | AgentInvoked indexing, contract changes, invoke/settlement route changes, orphan call creation |

### Acceptance Criteria

- **AC-1:** Cron endpoint validates `CRON_SECRET`, reads events from `last_indexed_block` to latest, persists progress in `app_settings`
- **AC-3:** KeyCallSettled events matched by `settlement_tx_hash` → mark `on_chain_recorded = true`; unmatched → log warning
- **AC-4:** Idempotent — events already marked `on_chain_recorded = true` are skipped
- **AC-6:** Paginate RPC queries in ≤ 2048 block chunks
- **AC-7:** On failure, don't advance `last_indexed_block` past failed chunk
- **AC-8:** Seed block = `80556531` (contract deployment) when `last_indexed_block` missing
- **AC-9:** Max 25 chunks per run (timeout guard)
- **AC-10:** Lock via `app_settings.indexer_lock` — skip if < 5 min old

*AC-2 (AgentInvoked), AC-5 (creator earnings), AC-11 (gas tracking) deferred to v2.*

## 3. Context Map

### Archivos leídos

| Archivo | Patrón extraído |
|---------|-----------------|
| `src/app/api/cron/settle-key-batches/route.ts` | CRON_SECRET auth, service client, logger, maxDuration=120 |
| `src/app/api/cron/reconcile-onchain/route.ts` | publicClient setup pattern (chainId → chain → rpcUrl) |
| `src/lib/contracts/WasiAIMarketplace.ts` | `KeyCallSettled` event ABI |
| `src/lib/settlement/runSettlement.ts` | Writes `settlement_tx_hash` to `agent_calls` |

### Exemplar

| Para crear | Seguir patrón de |
|-----------|------------------|
| `src/app/api/cron/index-events/route.ts` | `src/app/api/cron/reconcile-onchain/route.ts` |

### Estado de BD

| Tabla | Columnas usadas |
|-------|-----------------|
| `agent_calls` | `settlement_tx_hash`, `on_chain_recorded` (ambas existen) |
| `app_settings` | `key`, `value` (tabla existe, service client bypassa RLS) |

## 4. Diseño Técnico

### 4.1 Archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/lib/indexer/eventIndexer.ts` | Crear | Core logic: pagination, event processing, lock |
| `src/app/api/cron/index-events/route.ts` | Crear | Thin cron endpoint |
| `vercel.json` | Modificar | Add cron schedule |

### 4.2 Matching strategy

`KeyCallSettled` events llevan `transactionHash` del log. El settlement route (`runSettlement.ts`) escribe ese mismo hash en `agent_calls.settlement_tx_hash`.

- Calls con `settlement_tx_hash` matching log `transactionHash` → `on_chain_recorded = true`
- Calls sin `settlement_tx_hash` (from admin route) → **skip** (can't match, not critical)
- On-chain events sin match en DB → log warning con details (keyId, slug, amount, txHash)

### 4.3 Flujo

```
1. GET /api/cron/index-events → validate CRON_SECRET
2. Check indexer_lock in app_settings → skip if fresh (< 5 min)
3. Set lock (timestamp)
4. Read last_indexed_block from app_settings (default: 80556531)
5. Get current block from RPC
6. Loop chunks (≤ 2048 blocks, max 25 chunks):
   a. getLogs(KeyCallSettled) for chunk range
   b. Group events by transactionHash
   c. For each txHash group:
      - Query agent_calls WHERE settlement_tx_hash = txHash
      - UPDATE on_chain_recorded = true for matches
      - Log warning for unmatched events
   d. Update last_indexed_block to end of chunk
7. Release lock
8. Return { processed, matched, warnings, blocksScanned }
```

### 4.4 KeyCallSettled event

```
name: 'KeyCallSettled'
inputs:
  keyId:         bytes32 (indexed, topic[1])
  slug:          string  (NOT indexed, in data — decodable)
  amount:        uint256 (in data)
  creatorShare:  uint256 (in data)
  platformShare: uint256 (in data)
```

Topic hash: `0x8935c1d7f28bc934...`

Decode via viem `decodeEventLog` with the ABI — straightforward since `slug` is NOT indexed.

## 5. Waves

### Wave 0 — Pre-flight
- [ ] Verify `on_chain_recorded` column exists: `SELECT on_chain_recorded FROM agent_calls LIMIT 1`
- [ ] Verify `settlement_tx_hash` column exists
- [ ] Verify `app_settings` writable via service client
- [ ] `tsc --noEmit` passes

### Wave 1 — Core indexer (`src/lib/indexer/eventIndexer.ts`)
- [ ] Types: `IndexerConfig`, `IndexerResult`
- [ ] `getLastIndexedBlock(client)` → reads from app_settings, defaults to `80556531`
- [ ] `setLastIndexedBlock(client, block)` → writes to app_settings (upsert)
- [ ] `acquireLock(client)` / `releaseLock(client)` → timestamp-based in app_settings
- [ ] `processChunk(publicClient, serviceClient, contractAddress, fromBlock, toBlock)` → fetches logs, groups by txHash, updates agent_calls
- [ ] `indexEvents(serviceClient, publicClient, config)` → main loop with pagination + timeout guard
- [ ] Build gate: `tsc --noEmit`

### Wave 2 — Cron endpoint + config
- [ ] Create `src/app/api/cron/index-events/route.ts`:
  - `export const runtime = 'nodejs'`
  - `export const maxDuration = 120`
  - CRON_SECRET validation
  - Setup serviceClient + publicClient (reconcile-onchain pattern)
  - Call `indexEvents()`, return JSON
- [ ] Modify `vercel.json`: add `{ "path": "/api/cron/index-events", "schedule": "30 * * * *" }` (every hour at :30)
- [ ] Build gate: `tsc --noEmit`

## 6. Constraint Directives

### OBLIGATORIO
- Seguir patrón de `reconcile-onchain/route.ts` para publicClient setup
- `createServiceClient()` para DB writes
- `viem` para contract reads + `decodeEventLog` for event parsing
- Paginar ≤ 2048 blocks por getLogs
- Delay 200ms entre chunks (rate limit protection)
- Group updates by `transactionHash` to minimize DB round-trips

### PROHIBIDO
- NO modificar el contrato
- NO modificar settlement route, invoke route, ni ningún archivo existente (excepto vercel.json)
- NO agregar columnas a `agent_calls`
- NO agregar dependencias npm
- NO procesar más de 25 chunks por run
- NO hardcodear contract address (usar env var)
- NO implementar AgentInvoked indexing (v2)
- NO crear agent_calls rows (solo UPDATE existing)

## 7. Rollback

1. `git revert <commit>`
2. Remove cron entry de `vercel.json`
3. `app_settings` keys (`last_indexed_block`, `indexer_lock`) son inofensivas

## 8. Riesgos

| Riesgo | Prob | Impacto | Mitigación |
|--------|------|---------|------------|
| RPC rate limit | Media | Cron falla silently | 200ms delay entre chunks, retry next run |
| Concurrent cron overlap | Baja | Duplicate processing | Lock en app_settings |
| First run scans ~500k blocks | Media | Timeout | Max 25 chunks, catches up over multiple runs |

## 9. Dependencias

Todas ya existen:
- `CRON_SECRET`, `MARKETPLACE_CONTRACT_ADDRESS`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_MAINNET`/`TESTNET` env vars
- `app_settings` table (migración 073)
- `on_chain_recorded`, `settlement_tx_hash` columns in `agent_calls`

---

*SDD generado por NexusAgil — FULL (simplified v1)*
