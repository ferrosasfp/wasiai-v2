# Story File — #050: Agent Keys — Migrar wallet a sistema unificado thirdweb

> SDD: doc/sdd/050-agent-keys-unified-wallet/sdd.md
> Fecha: 2026-03-07
> Branch: feat/050-agent-keys-unified-wallet

---

## Goal

Reemplazar `window.ethereum` en `DepositModal` y `WithdrawModal` de la página `/agent-keys`
por los hooks unificados `useWallet()` + `useUnifiedWalletClient()` para que usuarios con
wallet embedded (Google/email) puedan depositar y retirar fondos igual que usuarios EOA.

**Importante — Deposit tiene dos rutas:**
- **EOA** (Core Wallet): EIP-3009 `signTypedData` → server ejecuta `transferWithAuthorization`
- **Embedded** (Google/email): `writeContract(USDC.transfer)` directo → server verifica Transfer event on-chain (igual que Route C en `/invoke`)

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN el usuario tiene wallet embedded (Google/email) conectada,
THEN el botón "Add USDC" está habilitado y el depósito funciona sin `window.ethereum`.

**AC-2:** WHEN el usuario tiene wallet EOA (Core Wallet) conectada vía thirdweb,
THEN el botón "Add USDC" está habilitado y el depósito funciona.

**AC-3:** WHEN el usuario EOA ejecuta un depósito,
THEN firma EIP-3009 (`TransferWithAuthorization`) via `signTypedData` sin pagar gas.

**AC-3b:** WHEN el usuario embedded ejecuta un depósito,
THEN se ejecuta `USDC.transfer(MARKETPLACE_ADDRESS, amount)` directamente y el server verifica el Transfer event.

**AC-4:** WHEN el usuario ejecuta un retiro,
THEN `withdrawKey()` se ejecuta on-chain via `writeContract` y el gas lo paga el creator.

**AC-5:** WHEN el usuario no tiene wallet conectada o `isReady === false`,
THEN se muestra error claro "Wallet no conectada. Conecta tu wallet para continuar."

**AC-6:** WHEN la tx de retiro se confirma on-chain,
THEN el DB se sincroniza y el balance de la key se actualiza en UI.

**AC-7:** IF la wallet está en chain incorrecta (`chain?.id !== CHAIN_ID`),
THEN se muestra error "Red incorrecta. Cambia a Avalanche Fuji Testnet."

---

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer |
|---|---------|--------|-----------|
| 1 | `src/app/[locale]/agent-keys/page.tsx` | Modificar | Ver instrucciones detalladas abajo |
| 2 | `src/app/api/agent-keys/[id]/deposit/route.ts` | Modificar | Agregar soporte Route C (txHash) al schema Zod y handler |

---

## Instrucciones detalladas — `page.tsx`

### Imports a agregar (al top del archivo, junto a los existentes)

```typescript
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { useUnifiedWalletClient } from '@/features/wallet/hooks/useUnifiedWalletClient'
```

### ABI a agregar (junto a las constantes existentes, antes de los componentes)

```typescript
// ABI para withdrawKey on-chain
const WITHDRAW_KEY_ABI = [
  {
    name: 'withdrawKey',
    type: 'function' as const,
    inputs: [
      { name: 'keyId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// ABI para USDC.transfer (embedded wallet deposit — Route C)
const USDC_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function' as const,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const
```

---

### DepositModal — cambios

**Agregar al top del componente (dentro de la función `DepositModal`):**

```typescript
const { address, chain, isThirdweb } = useWallet()
const { signTypedData, writeContract, isReady } = useUnifiedWalletClient()
```

**Reemplazar la función `handleDeposit` completa:**

```typescript
async function handleDeposit() {
  setErrorMsg('')

  if (CHAIN_ID === 43114 && !MARKETPLACE_ADDRESS) {
    setErrorMsg('Mainnet contract not configured. Contact support.')
    return
  }
  if (!MARKETPLACE_ADDRESS) {
    setErrorMsg('Contract address not configured. Check NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI in env.')
    return
  }

  // Guard: wallet conectada
  if (!isReady || !address) {
    setErrorMsg('Wallet no conectada. Conecta tu wallet para continuar.')
    return
  }

  // Guard: chain correcta
  if (chain?.id !== CHAIN_ID) {
    setErrorMsg(`Red incorrecta. Cambia a ${CHAIN_ID === 43114 ? 'Avalanche C-Chain' : 'Avalanche Fuji Testnet'}.`)
    return
  }

  const atomicAmount = BigInt(Math.round(amount * 1_000_000))

  try {
    setStatus('signing')

    if (isThirdweb) {
      // ── Route C: Embedded wallet — USDC.transfer directo ──────────────
      // EIP-3009 no funciona para smart accounts (ecrecover retorna admin EOA)
      // En su lugar: transfer directo + server verifica Transfer event on-chain
      const transferHash = await writeContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: USDC_TRANSFER_ABI as unknown as import('viem').Abi,
        functionName: 'transfer',
        args: [MARKETPLACE_ADDRESS as `0x${string}`, atomicAmount],
        chainId: CHAIN_ID,
      })

      setStatus('submitting')

      const res = await fetch(`/api/agent-keys/${keyId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAddress: address,
          amount,
          txHash: transferHash,  // Route C: server verifica on-chain
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)

      setTxHash(transferHash)
      setStatus('success')
      onSuccess()
      return
    }

    // ── Route B: EOA — EIP-3009 TransferWithAuthorization ─────────────
    const validAfter  = 0
    const validBefore = Math.floor(Date.now() / 1000) + 86400

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
    const nonce      = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

    const signature = await signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: CHAIN_ID,
        verifyingContract: USDC_ADDRESS as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',         type: 'address' },
          { name: 'value',      type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore',type: 'uint256' },
          { name: 'nonce',      type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        address,
        to:          MARKETPLACE_ADDRESS as `0x${string}`,
        value:       atomicAmount,
        validAfter:  BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce:       nonce as `0x${string}`,
      },
    })

    const sig = (signature as string).startsWith('0x') ? (signature as string).slice(2) : signature as string
    const r   = '0x' + sig.slice(0, 64)
    const s   = '0x' + sig.slice(64, 128)
    const v   = parseInt(sig.slice(128, 130), 16)

    setStatus('submitting')

    const res = await fetch(`/api/agent-keys/${keyId}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerAddress: address,
        amount,
        validAfter,
        validBefore,
        nonce,
        v,
        r,
        s,
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)

    setTxHash(data.txHash ?? '')
    setStatus('success')
    onSuccess()

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    setErrorMsg(msg)
    setStatus('error')
  }
}
```

---

### WithdrawModal — cambios

**Agregar al top del componente (dentro de la función `WithdrawModal`):**

```typescript
const { address, chain } = useWallet()
const { writeContract, isReady } = useUnifiedWalletClient()
```

**Reemplazar la función `handleWithdraw` completa:**

```typescript
async function handleWithdraw() {
  setErrorMsg('')

  if (!keyHash) { setErrorMsg(t('withdraw.noHash')); return }
  if (amount <= 0 || amount > balance) {
    setErrorMsg(t('withdraw.invalidAmount').replace('${max}', balance.toFixed(4)))
    return
  }
  if (!MARKETPLACE_ADDRESS) { setErrorMsg(t('withdraw.noContract')); return }

  // Guard: wallet conectada
  if (!isReady || !address) {
    setErrorMsg('Wallet no conectada. Conecta tu wallet para continuar.')
    return
  }

  // Guard: chain correcta
  if (chain?.id !== CHAIN_ID) {
    setErrorMsg(t('withdraw.wrongChain').replace('{chainId}', String(CHAIN_ID)))
    return
  }

  try {
    setStatus('signing')

    const atomicAmount = BigInt(Math.floor(amount * 1_000_000))
    const hex = keyHash.replace(/^0x/i, '').toLowerCase()
    const bytes32KeyId = ('0x' + hex.padEnd(64, '0').slice(0, 64)) as `0x${string}`

    // writeContract: funciona para EOA y embedded (thirdweb sponsorea gas para embedded)
    const txHashResult = await writeContract({
      address: MARKETPLACE_ADDRESS as `0x${string}`,
      abi: WITHDRAW_KEY_ABI as unknown as import('viem').Abi,
      functionName: 'withdrawKey',
      args: [bytes32KeyId, atomicAmount],
      chainId: CHAIN_ID,
    })

    setTxHash(txHashResult)
    setStatus('polling')

    // Polling receipt via publicClient
    const { createPublicClient, http } = await import('viem')
    const { avalancheFuji, avalanche } = await import('viem/chains')
    const publicClient = createPublicClient({
      chain: CHAIN_ID === 43114 ? avalanche : avalancheFuji,
      transport: http(CHAIN_ID === 43114
        ? 'https://api.avax.network/ext/bc/C/rpc'
        : 'https://api.avax-test.network/ext/bc/C/rpc'),
    })

    await publicClient.waitForTransactionReceipt({
      hash: txHashResult,
      timeout: 30_000,
    })

    // Sync DB
    setStatus('submitted')
    const res = await fetch(`/api/agent-keys/${keyId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: txHashResult, amount }),
    })
    const data2 = await res.json() as { error?: string }
    if (!res.ok) throw new Error(data2.error ?? `Error ${res.status}`)

    setStatus('success')
    setTimeout(onSuccess, 1500)

  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message
      : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message)
      : String(err)
    setErrorMsg(msg)
    setStatus('error')
  }
}
```

---

## Instrucciones detalladas — `/api/agent-keys/[id]/deposit/route.ts`

### Cambio en schema Zod

Reemplazar el `depositSchema` actual por un discriminated union:

```typescript
const depositSchemaEOA = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount:       z.number().min(0.01).max(1000),
  validAfter:   z.number().int().min(0),
  validBefore:  z.number().int().min(1),
  nonce:        z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  v:            z.number().int().min(0).max(28).transform(v => v < 27 ? v + 27 : v),
  r:            z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  s:            z.string().regex(/^0x[0-9a-fA-F]{64}$/),
})

const depositSchemaRouteC = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount:       z.number().min(0.01).max(1000),
  txHash:       z.string().regex(/^0x[0-9a-fA-F]{64}$/),
})

const depositSchema = z.union([depositSchemaRouteC, depositSchemaEOA])
```

### Cambio en el handler POST

Después de parsear el body, bifurcar según ruta:

```typescript
const body = depositSchema.parse(await request.json())

// ... validaciones de auth y key (sin cambios) ...

let txHash: string

if ('txHash' in body) {
  // ── Route C: Embedded wallet — verificar Transfer event on-chain ──────
  import { verifyUsdcTransfer } from '@/lib/contracts/verifyUsdcTransfer'

  const verification = await verifyUsdcTransfer(body.txHash, body.amount)
  if (!verification.verified) {
    return NextResponse.json(
      { error: 'Payment verification failed', detail: verification.error },
      { status: 402 },
    )
  }
  txHash = body.txHash
} else {
  // ── Route B: EOA — EIP-3009 existente (sin cambios) ──────────────────
  txHash = await depositForKeyOnChain({ ...body, keyId: keyRow.key_hash })
  if (!txHash) {
    return NextResponse.json({ error: 'On-chain deposit failed' }, { status: 500 })
  }
}
```

> El resto del handler (DB update, response) queda igual.

---

## Contrato de Integración — Deposit Route C (embedded)

### Frontend → `/api/agent-keys/${keyId}/deposit`

**Request (Route C — embedded wallet):**
```json
{
  "ownerAddress": "0x...",
  "amount": 10,
  "txHash": "0x..."
}
```

**Request (Route B — EOA):**
```json
{
  "ownerAddress": "0x...",
  "amount": 10,
  "validAfter": 0,
  "validBefore": 1234567890,
  "nonce": "0x...",
  "v": 28,
  "r": "0x...",
  "s": "0x..."
}
```

> ⚠️ **El API de deposit necesita detectar cuál ruta usar.**
> Si el body contiene `txHash` → Route C (verificar Transfer event on-chain via `verifyUsdcTransfer`).
> Si el body contiene `v, r, s` → Route B (EIP-3009 existente).
> **Dev PARA aquí y verifica el estado actual de `/api/agent-keys/[id]/deposit/route.ts` antes de implementar.**
> Si el API no soporta `txHash`, escalar a Architect.

---

## Exemplars

### Exemplar 1 — signTypedData con EIP-3009
**Archivo**: `src/features/payments/hooks/useWalletPayment.ts`
**Líneas clave**: ~90-190 (bloque EIP-3009)
**Patrón clave**:
- `const { signTypedData } = useUnifiedWalletClient()`
- Typed data con `domain`, `types`, `primaryType`, `message`
- Valores BigInt para `value`, `validAfter`, `validBefore`
- Extracción de `v, r, s` del string de firma

### Exemplar 2 — writeContract con ABI inline
**Archivo**: `src/features/payments/hooks/useWalletPayment.ts`
**Líneas clave**: ~125-145 (bloque USDC.transfer embedded)
**Patrón clave**:
- ABI definido como `const` con `as const`
- `writeContract({ address, abi: ABI as unknown as import('viem').Abi, functionName, args, chainId })`

### Exemplar 3 — useWallet hook
**Archivo**: `src/features/wallet/hooks/useWallet.ts`
**Patrón clave**:
- `const { address, chain, isThirdweb, isConnected } = useWallet()`
- `chain?.id` para verificar chain ID
- `isThirdweb` para bifurcar entre embedded y EOA

---

## Constraint Directives

### OBLIGATORIO
- Usar `useWallet()` y `useUnifiedWalletClient()` — hooks ya existentes
- Seguir patrón de `useWalletPayment.ts` para EIP-3009 y writeContract
- `isReady` como guard antes de cualquier operación de wallet
- `chain?.id !== CHAIN_ID` para verificar network

### PROHIBIDO
- NO usar `window.ethereum` en ninguna forma
- NO usar `eth_requestAccounts`, `eth_chainId`, `eth_signTypedData_v4`, `eth_sendTransaction`
- NO crear hooks nuevos ni archivos nuevos
- NO modificar `useWallet.ts` ni `useUnifiedWalletClient.ts`
- NO modificar APIs (`/api/agent-keys/*`) — salvo que el contrato de integración lo requiera
- NO modificar `CloseKeyModal`
- NO hardcodear addresses (usar constantes ya definidas en el archivo)
- NO agregar dependencias nuevas

---

## Test Expectations

Sin tests requeridos — no hay lógica de negocio nueva, solo migración de llamadas de wallet.
Verificación: `npm run lint && npx tsc --noEmit` debe pasar sin errores.

---

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Verificar estado actual de `/api/agent-keys/[id]/deposit/route.ts` — ¿soporta `txHash`? Si no, escalar a Architect antes de continuar.

### Wave 1
- [ ] W1.1: Agregar imports y ABIs al top de `page.tsx`
- [ ] W1.2: Reemplazar `handleDeposit` en `DepositModal` con la nueva implementación
- [ ] W1.3: Reemplazar `handleWithdraw` en `WithdrawModal` con la nueva implementación

### Wave 2
- [ ] W2.1: `npm run lint && npx tsc --noEmit` — corregir cualquier error de tipos

### Wave 3
- [ ] W3.1: Build local `npm run build` — debe pasar sin warnings

### Verificación Incremental

| Wave | Verificación |
|------|-------------|
| W0 | Confirmar API deposit acepta `txHash` |
| W1 | typecheck pasa |
| W2 | lint + typecheck sin errores |
| W3 | build completo sin warnings |

---

## Out of Scope

- `CloseKeyModal` — no tocar
- `/api/agent-keys/*` — solo si W0 lo requiere para soporte de `txHash`
- Cualquier otro archivo fuera de `page.tsx`
- Refactors, mejoras de estilo, reorganización de código

---

## Escalation Rule

**Si algo no está en este Story File, Dev PARA y pregunta a Architect.**

Situaciones de escalation obligatoria:
- W0: el API de deposit NO soporta `txHash` → Architect define qué cambiar en el API
- `signTypedData` retorna tipo incompatible → Architect ajusta el cast
- `writeContract` falla con tipo de ABI → Architect ajusta el exemplar

---

*Story File generado por NexusAgil — F2.5*
