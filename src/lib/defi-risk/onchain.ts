/**
 * Agent 2 — On-Chain Token Analyzer
 * Uses viem v2 for contract reads + Snowtrace API for holder data
 */
import { getPublicClient } from '@/shared/lib/web3/client'
import type { OnChainResult } from './types'

const SNOWTRACE_BASE = (process.env.SNOWTRACE_BASE_URL ?? 'https://api-testnet.snowtrace.io').trim()
const SNOWTRACE_KEY  = (process.env.SNOWTRACE_API_KEY ?? '').trim()

// Minimal ERC-20 ABI
const ERC20_ABI = [
  { name: 'name',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8'  }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'owner',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'paused',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool'   }] },
] as const

async function snowtraceGet(path: string): Promise<unknown> {
  const keyParam = SNOWTRACE_KEY ? `&apikey=${SNOWTRACE_KEY}` : ''
  const url = `${SNOWTRACE_BASE}/api?${path}${keyParam}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`Snowtrace HTTP ${res.status}`)
  return res.json()
}

export async function analyzeOnChain(tokenAddress: string): Promise<OnChainResult> {
  const client = getPublicClient()
  const address = tokenAddress.trim() as `0x${string}`

  // ── 1. Basic ERC-20 reads (parallel) ────────────────────────────────────
  const [nameRes, symbolRes, decimalsRes, totalSupplyRes, bytecodeRes] = await Promise.allSettled([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'name' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }),
    client.getBytecode({ address }),
  ])

  const name        = nameRes.status        === 'fulfilled' ? String(nameRes.value)        : 'Unknown'
  const symbol      = symbolRes.status      === 'fulfilled' ? String(symbolRes.value)      : '???'
  const decimals    = decimalsRes.status    === 'fulfilled' ? Number(decimalsRes.value)    : 18
  const totalSupply = totalSupplyRes.status === 'fulfilled' ? String(totalSupplyRes.value) : '0'
  const bytecode    = bytecodeRes.status    === 'fulfilled' ? (bytecodeRes.value ?? '0x')  : '0x'

  // ── 2. Risk flags (best-effort reads) ───────────────────────────────────
  const [ownerRes, pausedRes] = await Promise.allSettled([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'owner' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'paused' }),
  ])

  const ownerAddress   = ownerRes.status  === 'fulfilled' ? String(ownerRes.value)  : null
  const isPaused       = pausedRes.status === 'fulfilled' ? Boolean(pausedRes.value) : false
  const ownerRenounced = ownerAddress === '0x0000000000000000000000000000000000000000'

  // Detect mint function from bytecode selector (4-byte keccak of "mint(address,uint256)")
  const MINT_SELECTOR = '40c10f19'
  const hasMintFunction = bytecode.toLowerCase().includes(MINT_SELECTOR)

  // Detect proxy pattern (EIP-1967 implementation slot in bytecode)
  const PROXY_PATTERN = '5c60da1b'
  const isProxy = bytecode.toLowerCase().includes(PROXY_PATTERN)

  const bytecodeSize = Math.floor((bytecode.length - 2) / 2)

  // ── 3. Contract age via Snowtrace ────────────────────────────────────────
  let contractAgeDays = 0
  try {
    const creationData = await snowtraceGet(
      `module=contract&action=getcontractcreation&contractaddresses=${address}`
    ) as { result?: Array<{ txHash: string }> }
    const txHash = creationData.result?.[0]?.txHash
    if (txHash) {
      const txData = await snowtraceGet(
        `module=proxy&action=eth_getTransactionByHash&txhash=${txHash}`
      ) as { result?: { blockNumber?: string } }
      const blockHex = txData.result?.blockNumber
      if (blockHex) {
        const block = await client.getBlock({ blockNumber: BigInt(blockHex) })
        const ageMs = Date.now() - Number(block.timestamp) * 1000
        contractAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
      }
    }
  } catch {
    contractAgeDays = -1  // Unknown
  }

  // ── 4. Holder data via Snowtrace (best-effort) ───────────────────────────
  let holderCount: number | null = null
  let top10ConcentrationPct: number | null = null

  try {
    const holderData = await snowtraceGet(
      `module=token&action=tokenholderlist&contractaddress=${address}&page=1&offset=100`
    ) as { result?: Array<{ TokenHolderQuantity: string }> }

    if (Array.isArray(holderData.result) && holderData.result.length > 0) {
      const holders = holderData.result
      holderCount = holders.length

      // Top-10 concentration
      const totalQty = holders.reduce((sum, h) => sum + BigInt(h.TokenHolderQuantity), 0n)
      const top10Qty = holders
        .sort((a, b) => (BigInt(b.TokenHolderQuantity) > BigInt(a.TokenHolderQuantity) ? 1 : -1))
        .slice(0, 10)
        .reduce((sum, h) => sum + BigInt(h.TokenHolderQuantity), 0n)

      top10ConcentrationPct = totalQty > 0n
        ? Math.round(Number((top10Qty * 10000n) / totalQty) / 100)
        : null
    }
  } catch {
    // Snowtrace unavailable — degrade gracefully
  }

  return {
    token_address: address,
    name,
    symbol,
    total_supply:  totalSupply,
    decimals,
    contract_age_days: contractAgeDays,
    holder_count:  holderCount,
    top10_concentration_pct: top10ConcentrationPct,
    flags: {
      has_mint_function:  hasMintFunction,
      owner_renounced:    ownerRenounced,
      is_paused:          isPaused,
      is_proxy:           isProxy,
      bytecode_size_bytes: bytecodeSize,
    },
  }
}
