// Smoke test — valida el flujo sin gastar USDC (solo firma, no transmite).
// Ejecutar: npm test

import 'dotenv/config'
import { getCatalogAgent }    from '../src/catalog.js'
import { initWallet }         from '../src/wallet.js'
import { signERC3009Payment } from '../src/pay.js'

const REQUIRED_ENV = [
  'AGENT_PRIVATE_KEY',
  'CHAIN_ID',
  'RPC_URL',
  'WASIAI_API_BASE_URL',
  'TARGET_AGENT_SLUG',
  'WASIAI_CONTRACT_ADDRESS',
  'USDC_FUJI_ADDRESS',
]

async function smokeTest() {
  console.log('=== WasiAI AgentKit Smoke Test ===\n')

  // Verificar vars de entorno
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim())
  if (missing.length > 0) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`)
    process.exit(1)
  }

  let passed = 0
  let failed = 0

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn()
      console.log(`  ✅ ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ ${name}: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  // [1] Catálogo — verifica que el agente existe y tiene invoke_url
  await check('Catalog: fetch agent from WasiAI API', async () => {
    const slug = process.env.TARGET_AGENT_SLUG!.trim()
    const base = process.env.WASIAI_API_BASE_URL!.trim()
    const agent = await getCatalogAgent(base, slug)
    if (!agent.invoke_url) throw new Error('invoke_url is missing')
    if (typeof agent.price_usdc !== 'number') throw new Error('price_usdc is not a number')
    console.log(`       Agent: ${agent.name} | price: ${agent.price_usdc} USDC`)
  })

  // [2] Wallet — verifica que la private key genera una address válida
  await check('Wallet: initialize from AGENT_PRIVATE_KEY', async () => {
    const { agentAddress } = initWallet({
      privateKey: process.env.AGENT_PRIVATE_KEY!.trim() as `0x${string}`,
      rpcUrl:     process.env.RPC_URL!.trim(),
      chainId:    Number(process.env.CHAIN_ID),
    })
    if (!agentAddress.startsWith('0x')) throw new Error(`Invalid address: ${agentAddress}`)
    console.log(`       Address: ${agentAddress}`)
  })

  // [3] ERC-3009 Signing — verifica que la firma genera v, r, s válidos
  await check('ERC-3009: sign transferWithAuthorization with viem', async () => {
    const { walletClient, agentAddress } = initWallet({
      privateKey: process.env.AGENT_PRIVATE_KEY!.trim() as `0x${string}`,
      rpcUrl:     process.env.RPC_URL!.trim(),
      chainId:    Number(process.env.CHAIN_ID),
    })

    const payment = await signERC3009Payment({
      walletClient,
      from:        agentAddress,
      to:          process.env.WASIAI_CONTRACT_ADDRESS!.trim() as `0x${string}`,
      priceUsdc:   0.01,
      usdcAddress: process.env.USDC_FUJI_ADDRESS!.trim() as `0x${string}`,
      chainId:     Number(process.env.CHAIN_ID),
    })

    if (!payment.nonce.startsWith('0x'))   throw new Error('nonce format invalid')
    if (!payment.r.startsWith('0x'))       throw new Error('r format invalid')
    if (!payment.s.startsWith('0x'))       throw new Error('s format invalid')
    if (payment.v !== 27 && payment.v !== 28) throw new Error(`v must be 27 or 28, got ${payment.v}`)
    console.log(`       Nonce: ${payment.nonce.slice(0, 18)}... | v: ${payment.v}`)
  })

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.log('\n=== SMOKE TEST FAILED ===')
    process.exit(1)
  } else {
    console.log('\n=== SMOKE TEST PASSED ===')
  }
}

smokeTest().catch((err) => {
  console.error('\n=== SMOKE TEST CRASHED ===')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
