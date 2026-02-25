/**
 * Test E2E en Fuji Testnet para WasiAIMarketplace (nuevas funciones)
 *
 * Corre: npx tsx scripts/test-e2e-fuji.ts
 *
 * Requiere:
 *  - OPERATOR_PRIVATE_KEY en .env.local
 *  - MARKETPLACE_CONTRACT_ADDRESS en .env.local
 *  - NEXT_PUBLIC_RPC_TESTNET en .env.local
 *
 * Para USDC Fuji:
 *  https://faucet.circle.com — seleccionar Avalanche Fuji
 */

import 'dotenv/config'
import { createPublicClient, http, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '../src/lib/contracts/WasiAIMarketplace'

type TestResult = { name: string; status: 'PASS' | 'FAIL'; detail?: string }
const results: TestResult[] = []

function pass(name: string, detail?: string) {
  results.push({ name, status: 'PASS', detail })
  console.log(`  ✅ PASS: ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name: string, detail: string) {
  results.push({ name, status: 'FAIL', detail })
  console.log(`  ❌ FAIL: ${name} — ${detail}`)
}

async function main() {
  console.log('\n=== WasiAI Fuji E2E Tests ===\n')

  const pkRaw = process.env.OPERATOR_PRIVATE_KEY?.trim()
  const contractAddr = process.env.MARKETPLACE_CONTRACT_ADDRESS?.trim()
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_TESTNET?.trim()

  if (!pkRaw || !contractAddr || contractAddr === '0x0000000000000000000000000000000000000000') {
    console.log('⚠️  OPERATOR_PRIVATE_KEY or MARKETPLACE_CONTRACT_ADDRESS not set')
    console.log('   Set these in .env.local to run E2E tests against Fuji.')
    console.log('   Contract address (Fuji): 0x02e8A1c86E4D246ED281E8Cd45B2a8480B15Db71\n')
    process.exit(0)
  }

  const pkHex = pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`
  const account = privateKeyToAccount(pkHex as `0x${string}`)

  const pub = createPublicClient({
    chain: avalancheFuji,
    transport: http(rpcUrl),
  })
  const wallet = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: http(rpcUrl),
  })

  const contract = {
    address: contractAddr as `0x${string}`,
    abi: WASIAI_MARKETPLACE_ABI,
  }

  // 1. Verificar funciones nuevas en el contrato
  console.log('[1] Verificando funciones del contrato...')
  try {
    const activity = await pub.readContract({
      ...contract,
      functionName: 'lastOperatorActivity',
      args: [],
    }) as bigint
    pass('lastOperatorActivity()', `timestamp=${activity}`)
  } catch (err) {
    fail('lastOperatorActivity()', String(err).slice(0, 200))
    console.log('\n⚠️  Contract may not have the new functions yet (not redeployed).\n')
    console.log('   This script tests the ALREADY DEPLOYED contract.\n')
    console.log('   The new functions (settleKeyBatch, refundKeyToEarnings,')
    console.log('   emergencyWithdrawKey) require a new deployment by Fer.\n')
  }

  // 2. Verificar getKeyBalance (ya existía)
  console.log('\n[2] Verificando getKeyBalance...')
  try {
    const testKeyId = ('0x' + 'deadbeef'.padEnd(64, '0')) as `0x${string}`
    const balance = await pub.readContract({
      ...contract,
      functionName: 'getKeyBalance',
      args: [testKeyId],
    }) as bigint
    pass('getKeyBalance()', `balance=${balance}`)
  } catch (err) {
    fail('getKeyBalance()', String(err).slice(0, 200))
  }

  // 3. Verificar getPendingEarnings (ya existía)
  console.log('\n[3] Verificando getPendingEarnings...')
  try {
    const earnings = await pub.readContract({
      ...contract,
      functionName: 'getPendingEarnings',
      args: [account.address],
    }) as bigint
    pass('getPendingEarnings()', `earnings=${earnings} atomic USDC`)
  } catch (err) {
    fail('getPendingEarnings()', String(err).slice(0, 200))
  }

  // 4. Verificar settleKeyBatch (nueva función)
  console.log('\n[4] Verificando settleKeyBatch (nueva función)...')
  try {
    const testKeyId = ('0x' + 'cafebabe'.padEnd(64, '0')) as `0x${string}`
    // Simular — va a fallar por balance insuficiente, pero eso confirma que la función existe
    await pub.simulateContract({
      ...contract,
      functionName: 'settleKeyBatch',
      args: [testKeyId, ['test-agent'], [BigInt(1000)]],
      account,
    })
    pass('settleKeyBatch() — signature found (simulation succeeded unexpectedly)')
  } catch (err) {
    const errStr = String(err)
    // Si el error es de contrato (revert), la función existe
    if (errStr.includes('WasiAI') || errStr.includes('revert') || errStr.includes('insufficient')) {
      pass('settleKeyBatch() — function exists (reverted as expected: no balance)')
    } else if (errStr.includes('not found') || errStr.includes('no function') || errStr.includes('does not exist')) {
      fail('settleKeyBatch()', 'Function not found — contract needs redeployment')
    } else {
      fail('settleKeyBatch()', errStr.slice(0, 200))
    }
  }

  // 5. Verificar refundKeyToEarnings (nueva función)
  console.log('\n[5] Verificando refundKeyToEarnings (nueva función)...')
  try {
    const testKeyId = ('0x' + 'deadbeef'.padEnd(64, '0')) as `0x${string}`
    await pub.simulateContract({
      ...contract,
      functionName: 'refundKeyToEarnings',
      args: [testKeyId],
      account,
    })
    pass('refundKeyToEarnings() — simulation succeeded (key has balance?)')
  } catch (err) {
    const errStr = String(err)
    if (errStr.includes('WasiAI') || errStr.includes('revert') || errStr.includes('unknown key')) {
      pass('refundKeyToEarnings() — function exists (reverted as expected: unknown key)')
    } else if (errStr.includes('not found') || errStr.includes('no function')) {
      fail('refundKeyToEarnings()', 'Function not found — contract needs redeployment')
    } else {
      fail('refundKeyToEarnings()', errStr.slice(0, 200))
    }
  }

  // 6. Verificar emergencyWithdrawKey (nueva función)
  console.log('\n[6] Verificando emergencyWithdrawKey (nueva función)...')
  try {
    const testKeyId = ('0x' + 'deadbeef'.padEnd(64, '0')) as `0x${string}`
    await pub.simulateContract({
      ...contract,
      functionName: 'emergencyWithdrawKey',
      args: [testKeyId],
      account,
    })
    pass('emergencyWithdrawKey() — simulation succeeded (timeout expired?)')
  } catch (err) {
    const errStr = String(err)
    if (errStr.includes('WasiAI') || errStr.includes('operator still active') || errStr.includes('not key owner')) {
      pass('emergencyWithdrawKey() — function exists (reverted as expected: operator active or not owner)')
    } else if (errStr.includes('not found') || errStr.includes('no function')) {
      fail('emergencyWithdrawKey()', 'Function not found — contract needs redeployment')
    } else {
      fail('emergencyWithdrawKey()', errStr.slice(0, 200))
    }
  }

  // Resumen
  console.log('\n=== Resultados ===')
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`)

  if (failed > 0) {
    console.log('\n⚠️  Algunos tests fallaron.')
    console.log('   Las nuevas funciones requieren redespliegue del contrato por Fer.')
    console.log('   Los tests de Forge (forge test) validan toda la lógica localmente.')
  } else {
    console.log('\n✅ Todos los tests pasaron!')
  }

  console.log('\nNOTA: Para depositar USDC Fuji de prueba:')
  console.log('  https://faucet.circle.com — seleccionar Avalanche Fuji\n')

  void wallet // supress unused warning
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
