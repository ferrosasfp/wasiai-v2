import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'

const CONTRACT  = '0xB25688c47B441964d8d30b1157161Fde3e0334AA' as const
const USDC_FUJI = '0x5425890298aed601595a70AB815c96711a31Bc65' as const
const CREATOR   = '0xeC176F4f3BB71fD7288Cb7Defd09CDC427BBC70a' as const
const RPC       = 'https://avalanche-fuji-c-chain-rpc.publicnode.com'

const pk      = (process.env.OPERATOR_PRIVATE_KEY ?? '').trim().replace(/^0x/i, '')
const account = privateKeyToAccount(`0x${pk}`)
const wallet  = createWalletClient({ account, chain: avalancheFuji, transport: http(RPC) })
const pub     = createPublicClient({ chain: avalancheFuji, transport: http(RPC) })

const ABI = [
  { name:'withdrawFor', type:'function' as const, stateMutability:'nonpayable' as const, inputs:[{name:'creator',type:'address'}], outputs:[] },
  { name:'getPendingEarnings', type:'function' as const, stateMutability:'view' as const, inputs:[{name:'creator',type:'address'}], outputs:[{type:'uint256'}] },
] as const

const ERC20 = [
  { name:'balanceOf', type:'function' as const, stateMutability:'view' as const, inputs:[{name:'account',type:'address'}], outputs:[{type:'uint256'}] },
] as const

async function main() {
  const before = await pub.readContract({ address:CONTRACT, abi:ABI, functionName:'getPendingEarnings', args:[CREATOR] })
  console.log('Pending antes:', Number(before)/1e6, 'USDC')

  const usdcBefore = await pub.readContract({ address:USDC_FUJI, abi:ERC20, functionName:'balanceOf', args:[CREATOR] })
  console.log('USDC wallet antes:', Number(usdcBefore)/1e6, 'USDC')

  console.log('\nEjecutando withdrawFor...')
  try {
    const { request } = await pub.simulateContract({ address:CONTRACT, abi:ABI, functionName:'withdrawFor', args:[CREATOR], account })
    const tx = await wallet.writeContract(request)
    const rc = await pub.waitForTransactionReceipt({ hash:tx, timeout:30_000 })
    console.log('✅', rc.status, '→', tx)

    const after = await pub.readContract({ address:CONTRACT, abi:ABI, functionName:'getPendingEarnings', args:[CREATOR] })
    const usdcAfter = await pub.readContract({ address:USDC_FUJI, abi:ERC20, functionName:'balanceOf', args:[CREATOR] })
    console.log('\nPending después:', Number(after)/1e6, 'USDC')
    console.log('USDC wallet después:', Number(usdcAfter)/1e6, 'USDC')
    console.log('Recibido:', (Number(usdcAfter) - Number(usdcBefore))/1e6, 'USDC ✅')
  } catch (e: unknown) {
    console.log('❌ Error:', (e as Error).message?.slice(0, 200))
  }
}

main().catch(console.error)
