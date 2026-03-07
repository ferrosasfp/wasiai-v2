# SDD — HU-063: x402 Payment Flow for Embedded Wallets

## Overview

For embedded wallets (thirdweb smart accounts), EIP-3009 signTypedData doesn't work. Solution: direct USDC `transfer` to operator, 1 signature, gasless via sponsorGas. Server verifies txHash on-chain, then calls agent.

For external wallets (MetaMask/Core), the existing EIP-3009 x402 flow is unchanged.

## Flow

```
Embedded wallet:
  User clicks Pay → USDC.transfer(operator, amount) [1 firma, gasless]
    → Client calls /invoke with X-PAYMENT-TX: <txHash>
    → Server verifies USDC Transfer event on-chain
    → Server calls upstream agent → returns result

External wallet (unchanged):
  User clicks Pay → EIP-3009 signTypedData → x402 header → /invoke
```

---

## Wave 0 — Pre-flight

- [ ] Verify files exist:
  - `src/features/payments/hooks/useWalletPayment.ts`
  - `src/features/payments/components/FallbackApproveFlow.tsx`
  - `src/app/api/v1/models/[slug]/invoke/route.ts`
  - `src/features/wallet/hooks/useUnifiedWalletClient.ts`
- [ ] `npx tsc --noEmit` passes

## Wave 1 — Server: verifyUsdcTransfer helper

**Create `src/lib/contracts/verifyUsdcTransfer.ts`**

```ts
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const chain = CHAIN_ID === 43114 ? avalanche : avalancheFuji
const USDC_ADDRESS = (CHAIN_ID === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  : '0x5425890298aed601595a70AB815c96711a31Bc65').toLowerCase()
const OPERATOR_ADDRESS = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '').toLowerCase()
const RPC_URL = CHAIN_ID === 43114
  ? 'https://api.avax.network/ext/bc/C/rpc'
  : 'https://api.avax-test.network/ext/bc/C/rpc'

export async function verifyUsdcTransfer(
  txHash: string,
  expectedAmountUsdc: number
): Promise<{ verified: boolean; from?: string; error?: string }> {
  try {
    const client = createPublicClient({ chain, transport: http(RPC_URL) })
    // Wait for receipt (tx may not be mined yet)
    let receipt
    for (let i = 0; i < 5; i++) {
      try {
        receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
        break
      } catch {
        if (i === 4) return { verified: false, error: 'Transaction not found after 15s' }
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    if (receipt.status !== 'success') {
      return { verified: false, error: 'Transaction reverted' }
    }

    const expectedAtomic = BigInt(Math.round(expectedAmountUsdc * 1_000_000))

    // ERC-20 Transfer event: keccak256("Transfer(address,address,uint256)")
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS) continue
      if (log.topics[0] !== TRANSFER_TOPIC) continue
      if (log.topics.length < 3) continue

      const to = ('0x' + log.topics[2]!.slice(26)).toLowerCase()
      if (to !== OPERATOR_ADDRESS) continue

      const value = BigInt(log.data)
      if (value >= expectedAtomic) {
        const from = '0x' + log.topics[1]!.slice(26)
        return { verified: true, from }
      }
    }

    return { verified: false, error: 'No matching USDC transfer to operator found' }
  } catch (err) {
    return { verified: false, error: `Verification error: ${String(err).slice(0, 200)}` }
  }
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Server: Accept X-PAYMENT-TX in invoke route

**File: `src/app/api/v1/models/[slug]/invoke/route.ts`**

Add import at top:
```ts
import { verifyUsdcTransfer } from '@/lib/contracts/verifyUsdcTransfer'
```

Insert **before** the existing `if (!paymentHeader)` block (Route B, ~line where `paymentHeader` is checked):

```ts
// ── 3b. Route C: Direct USDC transfer (embedded wallets) ──────────────
const paymentTxHash = request.headers.get('x-payment-tx')
if (paymentTxHash) {
  // Anti-replay: reject if txHash already used
  const { data: existing } = await supabase
    .from('agent_calls')
    .select('id')
    .eq('tx_hash', paymentTxHash)
    .limit(1)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'Payment already used', code: 'payment_replay' },
      { status: 402 }
    )
  }

  const verification = await verifyUsdcTransfer(paymentTxHash, totalPrice)
  if (!verification.verified) {
    return NextResponse.json(
      { error: 'Payment verification failed', code: 'payment_invalid', reason: verification.error },
      { status: 402 }
    )
  }
  const result = await callUpstream(model, request, slug)
  await logCall(supabase, model, 'human', null, paymentTxHash, result, null, slug)

  if (model.creator_id) {
    void triggerAgentEvent(
      result.status === 'success' ? 'agent.invoked' : 'agent.error',
      model.id as string, model.creator_id as string,
      { slug, status: result.status, latency_ms: result.latencyMs }
    ).catch(() => {})
  }

  return buildResponse(model, result, paymentTxHash, undefined, { creatorPrice, overhead, totalPrice, breakdown })
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 3 — Client: Direct transfer flow

**File: `src/features/payments/hooks/useWalletPayment.ts`**

### 3a. Add transfer ABI constant (top of file, near other ABIs):

```ts
const USDC_ABI_TRANSFER = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const
```

### 3b. Replace the thirdweb branch in `initiatePayment`

Replace:
```ts
if (isThirdweb) {
  setFlowState('eip3009_failed') // triggers FallbackApproveFlow
  return
}
```

With:
```ts
if (isThirdweb) {
  setFlowState('transferring')
  try {
    // 1. Direct USDC transfer — 1 signature, gasless
    const txHash = await unifiedWriteContract({
      address: USDC_FUJI_ADDRESS,
      abi: USDC_ABI_TRANSFER as unknown as import('viem').Abi,
      functionName: 'transfer',
      args: [WASIAI_OPERATOR_ADDRESS, amountWei],
      chainId: FUJI_CHAIN_ID,
    })

    // 2. Invoke agent with txHash as proof of payment
    const invokeRes = await fetch(`/api/v1/models/${slug}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT-TX': txHash,
      },
      body: JSON.stringify({ input }),
    })

    if (!invokeRes.ok) {
      const err = await invokeRes.json().catch(() => ({}))
      setErrorMsg(err.error ?? `Agent returned ${invokeRes.status}`)
      setFlowState('error')
      return
    }

    const data = await invokeRes.json()
    setResult(data.result ?? data)
    setTxHash(txHash)
    setFlowState('success')
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === 4001) {
      setErrorMsg('Cancelaste el pago.')
      setFlowState('idle')
    } else {
      setErrorMsg('Error al transferir USDC.')
      setFlowState('error')
    }
  }
  return
}
```

### 3c. Add 'transferring' to PaymentFlowState type

**File: `src/features/payments/types/payment-flow.types.ts`**

Add `'transferring'` to the union type.

### 3d. Update `deriveState` and `isPaying` to handle 'transferring'

In `useWalletPayment.ts`, wherever `signing_eip3009` is checked for the spinner, also include `transferring`.

**Build gate:** `npx tsc --noEmit`

## Wave 4 — Client: Update UI for transfer flow

**File: `src/features/payments/components/FallbackApproveFlow.tsx`**

This component is no longer shown for embedded wallets (they go through direct transfer). No changes needed — it remains for edge cases.

**File: Whatever component renders the payment button for embedded wallets**

Show states:
- `transferring` → spinner + "Procesando pago..."
- `success` → green checkmark + agent result
- `error` → error message + retry button

**Build gate:** `npx tsc --noEmit`

## Wave 5 — Full build + commit

- [ ] `npm run build` passes clean
- [ ] Commit: `feat(063): direct USDC transfer payment for embedded wallets`
- [ ] **DO NOT push** — PO tests locally first

## AC Verification

| AC | How to verify |
|----|---------------|
| AC-1 | Embedded wallet: click Pay → 1 firma → agent responds |
| AC-2 | MetaMask: click Pay → EIP-3009 → agent responds (unchanged) |
| AC-3 | Embedded wallet: no AVAX needed (sponsorGas) |
| AC-4 | Agent response displayed after successful payment |
| AC-5 | `npm run build` clean, zero warnings |

## Security Notes

- Server verifies txHash on-chain (not trusting client)
- Transfer must be to OPERATOR_ADDRESS with >= expected amount
- **Anti-replay:** Server checks `agent_calls.tx_hash` uniqueness before accepting. If txHash already used, return 402.
- No changes to external wallet flow
