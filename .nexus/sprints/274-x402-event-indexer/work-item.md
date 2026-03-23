# Work Item — WAS-274: x402 Event Indexer

> HU_APPROVED: 2026-03-22 (PO)
> Tipo: feature
> Clasificación: QUALITY
> Branch: feat/274-x402-event-indexer

---

## Contexto

WasiAI tiene dos flujos de pago:
1. **API Key** (`api_key`): prepaid balance, calls registradas por compose route → settlement batch on-chain
2. **x402**: pago directo on-chain via EIP-3009, calls registradas por invoke route con `logCall(..., 'x402')`

Ambos flujos registran llamadas en `agent_calls` desde el route handler. Sin embargo, no hay **verificación cruzada** con los eventos on-chain. Si un route handler falla después del pago on-chain pero antes de `logCall`, la call se pierde en la DB.

### Eventos on-chain relevantes (contrato `0x9316E902...`)

| Evento | Cuándo se emite | Datos |
|--------|----------------|-------|
| `AgentInvoked` | Pago x402 directo (recordInvocation) | slug, payer, amount, creatorShare, platformShare |
| `KeyCallSettled` | Settlement batch de api_key | keyId, slug, amount, creatorShare, platformShare |
| `KeyFunded` | Depósito en key | keyId, owner, amount |
| `Withdrawn` | Creator retira earnings | creator, amount |

### Estado actual en producción
- 218 calls en DB (188 api_key + 25 free_trial + 5 x402)
- 0 AgentInvoked events on-chain (recordInvocation removido en WAS-132; x402 calls no emiten este evento actualmente)
- 156 KeyCallSettled events on-chain
- Columnas ya existentes: `on_chain_recorded` (boolean), `caller_wallet` (text), `settlement_tx_hash` (text)
- `app_settings` tabla existente (migración 073), accesible vía service client
- Snowtrace API disponible sin key para queries básicas, RPC limitado a 2048 blocks/query

### Dato clave
Actualmente NO se emiten `AgentInvoked` events on-chain (recordInvocation fue removido). El indexer debe manejar esto:
- **Ahora:** Solo reconcilia `KeyCallSettled` con settlements existentes
- **Futuro:** Si se reactiva recordInvocation, detectará orphan x402 calls

---

## Definición

COMO operador de WasiAI
QUIERO un cron que reconcilie eventos on-chain del contrato con `agent_calls` en DB
PARA detectar inconsistencias (calls pagadas on-chain pero no registradas, settlements sin match), mantener `on_chain_recorded` actualizado, y tener trazabilidad completa.

---

## Acceptance Criteria (EARS)

### AC-1: Cron endpoint con autenticación
WHEN the cron endpoint `/api/cron/index-events` is called
SHALL validate `Authorization: Bearer <CRON_SECRET>` header
AND return 401 if invalid
WHEN valid, SHALL read contract events from `last_indexed_block` to latest block
AND persist `last_indexed_block` in `app_settings` table via service client

### AC-2: AgentInvoked orphan detection
WHEN an `AgentInvoked` event is found on-chain
AND no `agent_calls` row exists with matching `tx_hash` (= `transactionHash` del log)
SHALL create an `agent_calls` row with:
- `payment_type = 'x402'`
- `agent_slug` (decoded from event)
- `amount_paid` (from event `amount`, converted from atomics)
- `caller_wallet` (from event `payer`)
- `tx_hash` (from log `transactionHash`)
- `on_chain_recorded = true`
- `status = 'success'`

### AC-3: KeyCallSettled reconciliation
WHEN a `KeyCallSettled` event is found on-chain
SHALL match against `agent_calls` rows with `settlement_tx_hash` = log `transactionHash`
AND set `on_chain_recorded = true` for matched rows
IF no matching rows exist, SHALL log a warning (orphan settlement)

### AC-4: Idempotency
WHEN the indexer processes a log with a `transactionHash` that already has `on_chain_recorded = true` in `agent_calls`
SHALL skip without error or duplicate

### AC-5: Creator earnings (only for orphan calls)
WHEN AC-2 creates a NEW `agent_calls` row (orphan x402 call)
SHALL increment `pending_earnings_usdc` in `creator_profiles` by `creatorShare` from the event
SHALL NOT increment earnings for calls already in the DB (invoke route already handles this)

### AC-6: Block pagination
SHALL paginate RPC log queries in chunks of ≤2048 blocks
OR use Snowtrace API endpoint with larger range

### AC-7: Error resilience with block-level granularity
IF the indexer fails processing events in a chunk
SHALL NOT advance `last_indexed_block` past the start of the failed chunk
SO THAT the next run retries from the correct position

### AC-8: Seed block
WHEN `last_indexed_block` does not exist in `app_settings`
SHALL use a hardcoded contract deployment block as the starting point
SHALL NOT start from block 0

### AC-9: Timeout guard
SHALL process at most N chunks per run (configurable, default ~50,000 blocks ≈ 25 chunks)
SO THAT the Vercel function stays within the 60s timeout

### AC-10: Concurrent execution guard
WHEN a cron run starts
SHALL check a `indexer_lock` key in `app_settings` with timestamp
IF lock exists and is < 5 min old, SHALL skip run with log
IF lock is stale (> 5 min), SHALL override and continue

### AC-11: Gas tracking (nice-to-have)
WHEN an event is indexed
MAY fetch the transaction receipt to record gas used

---

## Scope

### In scope
- Vercel Cron endpoint (`/api/cron/index-events`)
- `vercel.json` cron schedule entry (every 5 min)
- Read contract events via Snowtrace API or paginated RPC
- Reconcile `AgentInvoked` and `KeyCallSettled` events
- `app_settings` entries: `last_indexed_block`, `indexer_lock`
- Creator earnings update ONLY for orphan x402 calls (AC-5)
- Set `on_chain_recorded = true` for matched calls

### Out of scope
- Modifying the smart contract
- Changing existing x402 invoke flow or settlement route
- Adding new columns to `agent_calls` (all needed columns already exist)
- Historical backfill before contract deployment
- Realtime websocket/subscription (cron is sufficient)
- Reactivating `recordInvocationOnChain` in the invoke route

### Dependencies
- `app_settings` table (migración 073) — already exists
- Service client for `app_settings` writes (bypasses RLS)
- `CRON_SECRET` env var in Vercel
- Snowtrace API (no key needed for basic queries, optional `SNOWTRACE_API_KEY` for higher rate limits)
