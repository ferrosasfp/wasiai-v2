// Entry point — orquesta el flujo completo del demo.
// Ejecutar: npm run start

import 'dotenv/config'
import { initWallet }         from './wallet.js'
import { getCatalogAgent }    from './catalog.js'
import { signERC3009Payment } from './pay.js'
import { invokeAgent }        from './invoke.js'
import { log }                from './logger.js'

// ── Validación de entorno ──────────────────────────────────────────────────────

function validateEnv(required: string[]): Record<string, string> {
  const missing: string[] = []
  const result:  Record<string, string> = {}

  for (const key of required) {
    const val = process.env[key]?.trim()
    if (!val) {
      missing.push(key)
    } else {
      result[key] = val
    }
  }

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables:\n  ${missing.join('\n  ')}`)
    console.error('\nCopy .env.example to .env and fill in all values.')
    process.exit(1)
  }

  return result
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log.info('WasiAI AgentKit Demo — starting')

  // [1] Validar entorno
  const env = validateEnv([
    'AGENT_PRIVATE_KEY',
    'CHAIN_ID',
    'RPC_URL',
    'WASIAI_API_BASE_URL',
    'TARGET_AGENT_SLUG',
    'WASIAI_CONTRACT_ADDRESS',
    'USDC_FUJI_ADDRESS',
    'DEMO_INPUT_TEXT',
  ])

  // [2] Inicializar wallet
  log.info('Initializing agent wallet...')
  const { walletClient, publicClient, agentAddress } = initWallet({
    privateKey: env.AGENT_PRIVATE_KEY as `0x${string}`,
    rpcUrl:     env.RPC_URL,
    chainId:    Number(env.CHAIN_ID),
  })
  log.success(`Agent wallet: ${agentAddress}`)

  // [2.5] Pre-check balance USDC
  const usdcBalance = await publicClient.readContract({
    address: env.USDC_FUJI_ADDRESS as `0x${string}`,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: [agentAddress],
  })
  if (usdcBalance === 0n) {
    log.warn('Wallet USDC balance is 0 — get testnet USDC from https://faucet.avax.network/')
  }

  // [3] Descubrir agente en catálogo
  log.info(`Fetching agent '${env.TARGET_AGENT_SLUG}' from WasiAI catalog...`)
  const agent = await getCatalogAgent(env.WASIAI_API_BASE_URL, env.TARGET_AGENT_SLUG)
  log.success(`Agent found: ${agent.name} | price: ${agent.price_usdc} USDC | url: ${agent.invoke_url}`)

  // [4] Firmar pago ERC-3009
  log.info(`Signing ERC-3009 payment: ${agent.price_usdc} USDC → ${env.WASIAI_CONTRACT_ADDRESS}`)
  const payment = await signERC3009Payment({
    walletClient,
    from:        agentAddress,
    to:          env.WASIAI_CONTRACT_ADDRESS as `0x${string}`,
    priceUsdc:   agent.price_usdc,
    usdcAddress: env.USDC_FUJI_ADDRESS as `0x${string}`,
    chainId:     Number(env.CHAIN_ID),
  })
  log.success(`Payment signed | nonce: ${payment.nonce} | validBefore: ${payment.validBefore}`)

  // [5] Invocar agente con header x402
  log.info(`Invoking agent with x402 payment header...`)
  log.info(`Input: "${env.DEMO_INPUT_TEXT.slice(0, 80)}..."`)
  const result = await invokeAgent({
    invokeUrl: agent.invoke_url,
    payment,
    input: env.DEMO_INPUT_TEXT,
  })
  log.success(`Response received in ${result.elapsed}ms | status: ${result.rawStatus}`)

  // [6] Resumen final
  log.summary({
    agentWallet:   agentAddress,
    targetAgent:   agent.name,
    priceUsdc:     `${agent.price_usdc} USDC`,
    paymentNonce:  payment.nonce,
    txHash:        result.txHash,
    elapsedMs:     result.elapsed,
    agentResponse: result.output.slice(0, 200) + (result.output.length > 200 ? '...' : ''),
  })
}

main().catch((err: unknown) => {
  log.error('Fatal error', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
