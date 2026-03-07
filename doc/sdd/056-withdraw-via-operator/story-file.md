# Story File — HU-056: Retiro de Agent Key vía Operador

> **Sprint 22** | **Modo: QUALITY** | **Fecha: 2026-03-07**
> SDD: `doc/sdd/056-withdraw-via-operator/sdd.md`
> Branch: `fix/056-withdraw-via-operator`
> HU_APPROVED: 2026-03-07

---

## Goal

El contrato desplegado en Fuji (`0xe3250...`) no incluye `withdrawKey(bytes32,uint256)` en su
bytecode — fue definida en source pero el contrato no fue redesplantado. Toda llamada revierte
silenciosamente. El contrato SÍ tiene `refundKeyToEarnings(bytes32)` y `withdrawFor(address)`,
ambas `onlyOperator`. Migrar el flujo de retiro a estas dos funciones, ejecutadas 100% desde el
servidor con la operator key. El usuario **no firma nada**.

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN el usuario confirma un retiro en `WithdrawModal`,
THEN el servidor ejecuta `refundKeyToEarnings` + `withdrawFor` on-chain,
AND el USDC llega al wallet del usuario sin que éste firme ninguna tx.

**AC-2:** WHEN `withdrawFor` se confirma on-chain,
THEN la DB actualiza `budget_usdc = 0`, `spent_usdc = 0`, `is_active = false`.

**AC-3:** WHEN el `keyBalance` on-chain es 0 al momento del retiro,
THEN la API retorna `400 "Key already empty on-chain"` y no modifica DB.

**AC-4:** WHEN el operador no tiene AVAX suficiente para gas,
THEN la API retorna `503` y no modifica ningún estado.

**AC-5:** WHEN `refundKeyToEarnings` confirma on-chain pero `withdrawFor` falla,
THEN la API retorna `500` con el txHash parcial, y DB **no** se actualiza (HAL-025).

**AC-6:** WHEN el balance DB es 0,
THEN el botón "Withdraw" está deshabilitado en UI.

---

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer |
|---|---------|--------|-----------|
| 1 | `src/app/api/agent-keys/[id]/withdraw/route.ts` | Modificar | Reemplazar lógica `writeContract` por `refundKeyToEarnings` + `withdrawFor` desde operador |
| 2 | `src/app/[locale]/agent-keys/page.tsx` | Modificar | `WithdrawModal`: eliminar `useUnifiedWalletClient`, `WITHDRAW_KEY_ABI`, lógica `writeContract`; reemplazar por POST simple |
| 3 | `src/lib/contracts/marketplaceClient.ts` | Modificar | Agregar `refundKeyToEarnings` y `withdrawFor` si no existen |

---

## Instrucciones detalladas — `marketplaceClient.ts`

### Wave 1 — Verificar y agregar funciones operador

Buscar si ya existen `refundKeyToEarnings` y `withdrawFor`. Si no:

```typescript
// ABI entries a agregar en MARKETPLACE_ABI:
{
  name: 'refundKeyToEarnings',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'keyId', type: 'bytes32' }],
  outputs: [],
},
{
  name: 'withdrawFor',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'creator', type: 'address' }],
  outputs: [],
},
```

Agregar funciones wrapper al cliente existente (patrón del archivo):

```typescript
async refundKeyToEarnings(keyId: `0x${string}`): Promise<`0x${string}`> {
  const hash = await this.walletClient.writeContract({
    address: MARKETPLACE_ADDRESS,
    abi: MARKETPLACE_ABI,
    functionName: 'refundKeyToEarnings',
    args: [keyId],
  })
  await this.publicClient.waitForTransactionReceipt({ hash })
  return hash
}

async withdrawFor(ownerAddress: Address): Promise<`0x${string}`> {
  const hash = await this.walletClient.writeContract({
    address: MARKETPLACE_ADDRESS,
    abi: MARKETPLACE_ABI,
    functionName: 'withdrawFor',
    args: [ownerAddress],
  })
  await this.publicClient.waitForTransactionReceipt({ hash })
  return hash
}
```

> ⚠️ Dev PARA aquí y verifica el patrón exacto del cliente existente antes de implementar.
> Si `marketplaceClient.ts` usa un patrón diferente, seguir ese mismo patrón.

---

## Instrucciones detalladas — `withdraw/route.ts`

### Wave 2 — Reemplazar handler POST

**Schema Zod — simplificar:**

```typescript
const withdrawSchema = z.object({
  amount: z.number().min(0.000001),   // solo para validación UI
})
```

**Handler POST:**

```typescript
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // 1. Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Lookup key
  const keyRow = await db.agentKey.findFirst({
    where: { id: params.id, owner_id: user.id, is_active: true },
  })
  if (!keyRow) return NextResponse.json({ error: 'Key not found' }, { status: 404 })

  // 3. Verificar balance on-chain antes de operar
  const onChainBalance = await marketplaceClient.getKeyBalance(keyRow.key_hash)
  if (onChainBalance === 0n) {
    return NextResponse.json({ error: 'Key already empty on-chain' }, { status: 400 })
  }

  const keyId = keyHashToBytes32(keyRow.key_hash)
  const ownerAddress = keyRow.owner_address as Address

  // 4. Paso 1: refundKeyToEarnings (mueve balance a earnings[owner])
  const refundTxHash = await marketplaceClient.refundKeyToEarnings(keyId)

  // 5. Paso 2: withdrawFor (USDC va al wallet del usuario)
  const withdrawTxHash = await marketplaceClient.withdrawFor(ownerAddress)

  // 6. Solo tras ambas confirmaciones → actualizar DB (HAL-025)
  await db.agentKey.update({
    where: { id: params.id },
    data: { budget_usdc: 0, spent_usdc: 0, is_active: false },
  })

  return NextResponse.json({ ok: true, refundTxHash, withdrawTxHash })
}
```

> ⚠️ Verificar cómo `marketplaceClient` es instanciado en rutas existentes.
> Usar el mismo patrón — no crear una nueva instancia distinta.

> ⚠️ Verificar si `keyRow` tiene `owner_address`. Si no existe ese campo → **ESCALAR A ARCHITECT**.

---

## Instrucciones detalladas — `page.tsx` (`WithdrawModal`)

### Wave 3 — Simplificar WithdrawModal

**Eliminar:**
- `const WITHDRAW_KEY_ABI = [...]`
- `const { writeContract, isReady } = useUnifiedWalletClient()` (si solo era para withdraw)
- Bloque completo de `writeContract` / `waitForTransactionReceipt` / polling

**Reemplazar `handleWithdraw` por:**

```typescript
async function handleWithdraw() {
  setErrorMsg('')
  if (amount <= 0 || amount > balance) {
    setErrorMsg(t('withdraw.invalidAmount').replace('${max}', balance.toFixed(4)))
    return
  }

  try {
    setStatus('loading')

    const res = await fetch(`/api/agent-keys/${keyId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })

    const data = await res.json() as { error?: string; withdrawTxHash?: string }
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

    setTxHash(data.withdrawTxHash ?? '')
    setStatus('success')
    setTimeout(onSuccess, 1500)

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    setErrorMsg(msg)
    setStatus('error')
  }
}
```

**Actualizar estados del modal:** `idle | loading | success | error`
(eliminar `signing | submitted | polling`)

---

## Contrato de Integración

### Frontend → `POST /api/agent-keys/[id]/withdraw`

**Request:**
```json
{ "amount": 20 }
```

**Response 200:**
```json
{ "ok": true, "refundTxHash": "0x...", "withdrawTxHash": "0x..." }
```

**Response 400:**
```json
{ "error": "Key already empty on-chain" }
```

**Response 404:**
```json
{ "error": "Key not found" }
```

---

## Exemplars

### Exemplar 1 — Patrón operador on-chain
**Archivo**: `src/app/api/agent-keys/[id]/deposit/route.ts`
**Patrón clave**: cómo se instancia y llama `marketplaceClient` desde una API route

### Exemplar 2 — `getKeyBalance` on-chain
**Archivo**: `src/app/api/agent-keys/[id]/balance/route.ts`
**Patrón clave**: lectura de `keyBalances[keyId]` desde el servidor

### Exemplar 3 — `keyHashToBytes32`
**Archivo**: `src/lib/contracts/marketplaceClient.ts`
**Función**: `hex.replace(/^0x/i,'').toLowerCase().padEnd(64,'0').slice(0,64)`

---

## Constraint Directives

### OBLIGATORIO
- DB se actualiza **solo** tras receipt exitoso de `withdrawFor` (HAL-025)
- `getKeyBalance` on-chain antes de operar — rechazar si = 0
- Usar instancia de `marketplaceClient` existente en el proyecto
- `withdrawTxHash` retornado al frontend para mostrar link a Snowtrace

### PROHIBIDO
- NO usar `window.ethereum` ni `writeContract` desde el cliente
- NO modificar `useWallet.ts` ni `useUnifiedWalletClient.ts`
- NO redesplegar el contrato
- NO crear nueva instancia de viem client separada — usar `marketplaceClient`
- NO actualizar DB si alguna tx falla

---

## Test Expectations

Sin nuevos tests. Verificación: `npm run lint && npx tsc --noEmit` sin errores ni warnings.

---

## Waves

### Wave 0 — Serial Gate (verificar antes de codificar)
- [ ] W0.1: ¿`marketplaceClient.ts` ya tiene `refundKeyToEarnings` y `withdrawFor`?
- [ ] W0.2: ¿`keyRow` en DB tiene campo `owner_address`? Si no → **ESCALAR A ARCHITECT**
- [ ] W0.3: Leer `withdraw/route.ts` actual antes de reescribir

### Wave 1 — `marketplaceClient.ts`
- [ ] W1.1: Agregar ABI entries `refundKeyToEarnings` + `withdrawFor`
- [ ] W1.2: Agregar funciones wrapper siguiendo patrón existente

### Wave 2 — `withdraw/route.ts`
- [ ] W2.1: Simplificar schema Zod
- [ ] W2.2: Implementar handler con `refundKeyToEarnings` → `withdrawFor` → DB update

### Wave 3 — `page.tsx` (`WithdrawModal`)
- [ ] W3.1: Eliminar `WITHDRAW_KEY_ABI`, bloque `writeContract`
- [ ] W3.2: Reemplazar `handleWithdraw` por POST simple

### Wave 4 — Verificación
- [ ] W4.1: `npm run lint && npx tsc --noEmit` sin errores
- [ ] W4.2: `npm run build` pasa
- [ ] W4.3: Test manual — retiro desde Core Wallet EOA → USDC on-chain (Snowtrace)

### Verificación Incremental

| Wave | Verificación |
|------|-------------|
| W0 | `owner_address` confirmado en DB schema |
| W1 | Funciones compilan sin errores de tipos |
| W2 | API responde 200 con ambos txHash en Fuji |
| W3 | `WithdrawModal` no importa `useUnifiedWalletClient` |
| W4 | build + lint + typecheck limpios; USDC on-chain verificado |

---

## Out of Scope

- Redespliegue del contrato con `withdrawKey` nativo
- Retiros parciales
- `CloseKeyModal`
- Cualquier otro modal o flujo de agent-keys

---

## Escalation Rule

**Si algo no está en este Story File, Dev PARA y pregunta a Architect.**

Situaciones de escalation obligatoria:
- W0.2: `keyRow` no tiene `owner_address` → Architect define cómo obtener el wallet del usuario
- `marketplaceClient` no soporta el patrón de nuevas funciones → Architect ajusta Wave 1
- `withdrawFor` falla con `AccessControl` en Fuji → Architect verifica que `0xf432ba...` es operator

---

*Story File generado por NexusAgile — F2.5 | HU-056 | HU_APPROVED: 2026-03-07*
