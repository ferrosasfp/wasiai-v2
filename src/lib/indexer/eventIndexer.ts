/**
 * Event Indexer — WAS-274
 * Reconciles KeyCallSettled on-chain events with agent_calls in DB.
 */

import { decodeEventLog, type PublicClient, type AbiEvent } from 'viem'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

// ── Constants ─────────────────────────────────────────────────────────────

const SEED_BLOCK = 80556531n
const CHUNK_SIZE = 2048n
const MAX_CHUNKS = 25
const CHUNK_DELAY_MS = 200
const LOCK_KEY = 'indexer_lock'
const LAST_BLOCK_KEY = 'last_indexed_block'
const LOCK_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ── Types ─────────────────────────────────────────────────────────────────

export interface IndexerConfig {
  contractAddress: `0x${string}`
  publicClient: PublicClient
}

export interface IndexerResult {
  processed: number
  matched: number
  warnings: number
  blocksScanned: number
  skipped?: boolean
  reason?: string
}

// ── app_settings helpers ──────────────────────────────────────────────────

async function getAppSetting(client: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await client
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single()
  return data?.value ?? null
}

async function setAppSetting(client: SupabaseClient, key: string, value: string): Promise<void> {
  await client
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' })
}

// ── Lock ──────────────────────────────────────────────────────────────────

export async function acquireLock(client: SupabaseClient): Promise<boolean> {
  const lockVal = await getAppSetting(client, LOCK_KEY)
  if (lockVal) {
    const lockTime = Number(lockVal)
    if (!isNaN(lockTime) && Date.now() - lockTime < LOCK_TTL_MS) {
      return false // lock is fresh
    }
  }
  await setAppSetting(client, LOCK_KEY, String(Date.now()))
  return true
}

export async function releaseLock(client: SupabaseClient): Promise<void> {
  await setAppSetting(client, LOCK_KEY, '0')
}

// ── Block tracking ────────────────────────────────────────────────────────

export async function getLastIndexedBlock(client: SupabaseClient): Promise<bigint> {
  const val = await getAppSetting(client, LAST_BLOCK_KEY)
  if (val !== null && !isNaN(Number(val))) return BigInt(val)
  return SEED_BLOCK
}

export async function setLastIndexedBlock(client: SupabaseClient, block: bigint): Promise<void> {
  await setAppSetting(client, LAST_BLOCK_KEY, String(block))
}

// ── Chunk processor ───────────────────────────────────────────────────────

export async function processChunk(
  publicClient: PublicClient,
  serviceClient: SupabaseClient,
  contractAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ processed: number; matched: number; warnings: number }> {
  const keyCallSettledEvent = WASIAI_MARKETPLACE_ABI.find(
    (e) => e.type === 'event' && e.name === 'KeyCallSettled',
  ) as AbiEvent

  const logs = await publicClient.getLogs({
    address: contractAddress,
    event: keyCallSettledEvent,
    fromBlock,
    toBlock,
  })

  let processed = 0
  let matched = 0
  let warnings = 0

  // Group by transactionHash to minimize DB round-trips
  const byTx = new Map<string, typeof logs>()
  for (const log of logs) {
    if (!log.transactionHash) continue
    const group = byTx.get(log.transactionHash) ?? []
    group.push(log)
    byTx.set(log.transactionHash, group)
  }

  for (const [txHash, txLogs] of byTx.entries()) {
    processed += txLogs.length

    // Decode events to get slug for logging
    const decodedEvents = txLogs.map((log) => {
      try {
        const decoded = decodeEventLog({
          abi: WASIAI_MARKETPLACE_ABI,
          data: log.data,
          topics: log.topics,
          eventName: 'KeyCallSettled',
        })
        return decoded.args as { keyId: `0x${string}`; slug: string; amount: bigint; creatorShare: bigint; platformShare: bigint }
      } catch {
        return null
      }
    })

    // Query agent_calls by settlement_tx_hash
    const { data: calls, error } = await serviceClient
      .from('agent_calls')
      .select('id, on_chain_recorded')
      .eq('settlement_tx_hash', txHash)

    if (error) {
      logger.error('[indexer] DB query error', { txHash, error: error.message })
      warnings++
      continue
    }

    if (!calls || calls.length === 0) {
      // Orphan: on-chain settlement with no DB match
      for (const decoded of decodedEvents) {
        if (decoded) {
          logger.warn('[indexer] Orphan settlement — no agent_calls match', {
            txHash,
            slug: decoded.slug,
            amount: decoded.amount.toString(),
            keyId: decoded.keyId,
          })
        } else {
          logger.warn('[indexer] Orphan settlement (decode failed)', { txHash })
        }
      }
      warnings += txLogs.length
      continue
    }

    // Filter out already-marked
    const toUpdate = calls.filter((c) => !c.on_chain_recorded)

    if (toUpdate.length > 0) {
      const ids = toUpdate.map((c) => c.id)
      const { error: updateError } = await serviceClient
        .from('agent_calls')
        .update({ on_chain_recorded: true })
        .in('id', ids)

      if (updateError) {
        logger.error('[indexer] Failed to update agent_calls', { txHash, error: updateError.message })
        warnings++
      } else {
        matched += toUpdate.length
        logger.info('[indexer] Marked on_chain_recorded', { txHash, count: toUpdate.length })
      }
    } else {
      // Already marked — idempotent skip
      matched += calls.length
    }
  }

  return { processed, matched, warnings }
}

// ── Main loop ─────────────────────────────────────────────────────────────

export async function indexEvents(
  serviceClient: SupabaseClient,
  config: IndexerConfig,
): Promise<IndexerResult> {
  // Acquire lock
  const locked = await acquireLock(serviceClient)
  if (!locked) {
    logger.info('[indexer] Lock held by recent run — skipping')
    return { processed: 0, matched: 0, warnings: 0, blocksScanned: 0, skipped: true, reason: 'lock_held' }
  }

  let processed = 0
  let matched = 0
  let warnings = 0
  let blocksScanned = 0

  try {
    const startBlock = await getLastIndexedBlock(serviceClient)
    const latestBlock = await config.publicClient.getBlockNumber()

    if (startBlock >= latestBlock) {
      logger.info('[indexer] Already up to date', { startBlock: startBlock.toString(), latestBlock: latestBlock.toString() })
      return { processed: 0, matched: 0, warnings: 0, blocksScanned: 0 }
    }

    logger.info('[indexer] Starting indexing', {
      from: startBlock.toString(),
      to: latestBlock.toString(),
      chunks: Math.min(MAX_CHUNKS, Math.ceil(Number(latestBlock - startBlock) / Number(CHUNK_SIZE))),
    })

    let currentBlock = startBlock
    let chunksProcessed = 0

    while (currentBlock < latestBlock && chunksProcessed < MAX_CHUNKS) {
      const toBlock = currentBlock + CHUNK_SIZE - 1n < latestBlock
        ? currentBlock + CHUNK_SIZE - 1n
        : latestBlock

      const chunkResult = await processChunk(
        config.publicClient,
        serviceClient,
        config.contractAddress,
        currentBlock,
        toBlock,
      )

      processed += chunkResult.processed
      matched += chunkResult.matched
      warnings += chunkResult.warnings
      blocksScanned += Number(toBlock - currentBlock + 1n)

      // Persist progress — only advance on successful chunk
      await setLastIndexedBlock(serviceClient, toBlock + 1n)

      currentBlock = toBlock + 1n
      chunksProcessed++

      if (currentBlock < latestBlock && chunksProcessed < MAX_CHUNKS) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS))
      }
    }

    logger.info('[indexer] Indexing complete', { processed, matched, warnings, blocksScanned, chunksProcessed })
  } finally {
    await releaseLock(serviceClient)
  }

  return { processed, matched, warnings, blocksScanned }
}
