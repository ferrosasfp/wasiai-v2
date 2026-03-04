# Story File — SDD-043 WAS-141
**Retiro total y parcial de Agent Key**
**Fecha:** 2026-03-04 | **Modo:** QUALITY

## Archivos

### Modificados
1. `contracts/src/WasiAIMarketplace.sol` — función withdrawKey + evento KeyWithdrawn
2. `src/lib/contracts/WasiAIMarketplace.ts` — ABI entry withdrawKey
3. `src/app/api/agent-keys/route.ts` — exponer key_hash al owner

### Nuevos
4. `src/app/api/agent-keys/[id]/withdraw/route.ts`
5. `src/app/[locale]/agent-keys/page.tsx` — WithdrawModal (modificación)

## Waves

### Wave 1 — Contrato
Añadir después de emergencyWithdrawKey:
```solidity
event KeyWithdrawn(bytes32 indexed keyId, address indexed owner, uint256 amount);

function withdrawKey(bytes32 keyId, uint256 amount)
  external nonReentrant  // SIN whenNotPaused — user siempre puede retirar
{
  require(keyOwners[keyId] == msg.sender, "WasiAI: not key owner");
  require(amount > 0, "WasiAI: amount must be > 0");
  require(keyBalances[keyId] >= amount, "WasiAI: insufficient key balance");
  keyBalances[keyId] -= amount;
  totalKeyBalances   -= amount;
  usdc.safeTransfer(msg.sender, amount);
  emit KeyWithdrawn(keyId, msg.sender, amount);
}
```

### Wave 2 — ABI
En WasiAIMarketplace.ts añadir entrada:
```ts
{
  name: 'withdrawKey',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'keyId',  type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [],
}
// + evento KeyWithdrawn
```

### Wave 3 — API GET: exponer key_hash
En route.ts GET agent-keys: quitar `key_hash: undefined` del map

### Wave 4 — Backend withdraw route
```
POST /api/agent-keys/[id]/withdraw
Body: { txHash: string, amount: number }
1. Auth getUser()
2. Lookup key — owner_id === user.id, is_active
3. createPublicClient → getTransactionReceipt(txHash)
   → status !== 'success' → 400
4. newBalance = budget_usdc - amount
5. update: budget_usdc = max(0, newBalance)
6. if newBalance <= 0 → también is_active = false
7. return { ok: true, newBalance }
```

### Wave 5 — WithdrawModal UI
```
Props: { keyId, keyName, keyHash, currentBalance, onClose, onSuccess }
Estado: idle | signing | submitted | polling | success | error

1. Mostrar balance on-chain actual
2. Input amount (0 < amount <= balance)
3. handleWithdraw:
   a. eth_requestAccounts
   b. eth_chainId check
   c. bytes32KeyId = keyHashToBytes32(keyHash) — inline
   d. atomicAmount = BigInt(Math.floor(amount * 1_000_000))
   e. data = encodeFunctionData({ abi: WITHDRAW_ABI, args: [bytes32KeyId, atomicAmount] })
   f. eth_sendTransaction { from, to: MARKETPLACE_ADDRESS, data }
   g. Poll getTransactionReceipt cada 2s (max 60s)
   h. POST /api/agent-keys/[id]/withdraw { txHash, amount }
   i. success → onSuccess()
```

## Constraint Directives
- CD-1: withdrawKey: nonReentrant SIN whenNotPaused
- CD-2: totalKeyBalances -= amount — mantener invariante
- CD-3: keyHashToBytes32 inline: `'0x' + hash.replace(/^0x/i,'').padEnd(64,'0').slice(0,64)`
- CD-4: USDC atomics = amount * 1_000_000 (BigInt)
- CD-5: Backend verifica receipt antes de update DB (HAL-025)
- CD-6: Si newBalance <= 0 → is_active = false en DB
- CD-7: eth_sendTransaction + encodeFunctionData de viem (client-side)
- CD-8: key_hash solo al owner autenticado
- CD-9: evento KeyWithdrawn separado de KeyRefunded
- CD-10: createPublicClient en withdraw route (patrón de admin/fee/route.ts)
