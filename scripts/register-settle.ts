import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'

const CONTRACT  = '0xB25688c47B441964d8d30b1157161Fde3e0334AA' as const
const USDC_FUJI = '0x5425890298aed601595a70AB815c96711a31Bc65' as const
const CREATOR   = '0xeC176F4f3BB71fD7288Cb7Defd09CDC427BBC70a' as const
const RPC       = 'https://avalanche-fuji-c-chain-rpc.publicnode.com'
const PRICE     = 20000n  // $0.02 = 20000 atomic USDC

const pk      = (process.env.OPERATOR_PRIVATE_KEY ?? '').trim().replace(/^0x/i, '')
const account = privateKeyToAccount(`0x${pk}`)
const wallet  = createWalletClient({ account, chain: avalancheFuji, transport: http(RPC) })
const pub     = createPublicClient({ chain: avalancheFuji, transport: http(RPC) })

const ABI = [
  { name:'registerAgent', type:'function' as const, stateMutability:'nonpayable' as const, inputs:[{name:'slug',type:'string'},{name:'pricePerCall',type:'uint256'},{name:'creator',type:'address'},{name:'erc8004Id',type:'uint64'}], outputs:[] },
  { name:'recordInvocation', type:'function' as const, stateMutability:'nonpayable' as const, inputs:[{name:'slug',type:'string'},{name:'payer',type:'address'},{name:'amount',type:'uint256'}], outputs:[] },
  { name:'getPendingEarnings', type:'function' as const, stateMutability:'view' as const, inputs:[{name:'creator',type:'address'}], outputs:[{type:'uint256'}] },
] as const

const ERC20 = [
  { name:'balanceOf', type:'function' as const, stateMutability:'view' as const, inputs:[{name:'account',type:'address'}], outputs:[{type:'uint256'}] },
] as const

async function main() {
  console.log('Operator:', account.address)

  // 1. Register nanoagent on-chain
  console.log('\n1. Registrando nanoagent...')
  try {
    const { request } = await pub.simulateContract({ address:CONTRACT, abi:ABI, functionName:'registerAgent', args:['nanoagent', PRICE, CREATOR, 0n], account })
    const tx = await wallet.writeContract(request)
    const rc = await pub.waitForTransactionReceipt({ hash:tx, timeout:30_000 })
    console.log('   ✅', rc.status, '→', tx)
  } catch (e: unknown) {
    console.log('   ❌', (e as Error).message?.slice(0, 120))
  }

  await new Promise(r => setTimeout(r, 2000))

  // 2. recordInvocation — split the $0.02 already in the contract
  console.log('\n2. recordInvocation ($0.02)...')
  try {
    const { request } = await pub.simulateContract({ address:CONTRACT, abi:ABI, functionName:'recordInvocation', args:['nanoagent', CREATOR, PRICE], account })
    const tx = await wallet.writeContract(request)
    const rc = await pub.waitForTransactionReceipt({ hash:tx, timeout:30_000 })
    console.log('   ✅', rc.status, '→', tx)
  } catch (e: unknown) {
    console.log('   ❌', (e as Error).message?.slice(0, 120))
  }

  await new Promise(r => setTimeout(r, 1000))

  // 3. Check earnings
  const earnings = await pub.readContract({ address:CONTRACT, abi:ABI, functionName:'getPendingEarnings', args:[CREATOR] })
  console.log('\n3. Pending earnings de Fer: $', Number(earnings) / 1_000_000, 'USDC')

  const balance = await pub.readContract({ address:USDC_FUJI, abi:ERC20, functionName:'balanceOf', args:[CONTRACT] })
  console.log('4. USDC en contrato: $', Number(balance) / 1_000_000, 'USDC')
}

main().catch(console.error)
