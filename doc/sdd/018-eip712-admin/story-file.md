# Story File #018 — WAS-80: EIP-712 signature verification en admin panel
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Reemplazar `X-Admin-Signature: address` (inseguro) por firma EIP-712 real. El cliente firma `{ action, nonce, timestamp }` antes de cada acción admin. El servidor verifica la firma con viem `recoverTypedDataAddress` y rechaza si el firmante no es owner/operator o el timestamp tiene más de 5 minutos.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN el owner ejecuta acción admin, THE cliente SHALL firmar EIP-712 `{ action, nonce, timestamp }` antes del request |
| AC2 | WHEN el servidor recibe el request, THE endpoint SHALL verificar firma con `recoverTypedDataAddress` |
| AC3 | WHEN firma inválida o firmante no permitido, THE servidor SHALL retornar 401 |
| AC4 | WHEN timestamp > 5 minutos de antigüedad, THE servidor SHALL retornar 401 (anti-replay) |
| AC5 | WHEN verificación pasa, THE acción SHALL ejecutarse exactamente como hoy |
| AC6 | WHEN servidor verifica, THE helper SHALL leer `WASIAI_OWNER_ADDRESS` (server-side) con fallback a `NEXT_PUBLIC_WASIAI_OWNER` |

---

## Archivos a crear / modificar

| Archivo | Acción |
|---|---|
| `src/lib/admin/verifyAdminSignature.ts` | CREAR — helper de verificación EIP-712 server-side |
| `src/app/api/admin/fee/route.ts` | MODIFICAR — usar verifyAdminSignature |
| `src/app/api/admin/settlement/route.ts` | MODIFICAR — usar verifyAdminSignature |
| `src/app/[locale]/admin/page.tsx` | MODIFICAR — firmar EIP-712 antes de cada acción |

---

## Wave 1 — Vercel env var (PRIMERO)

Agregar `WASIAI_OWNER_ADDRESS` a Vercel antes de deployar:

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
VERCEL=~/.npm-global/bin/vercel
OWNER="0x94DCDb84207724A609B17e4838936832EA59B9eD"

for env in preview production; do
  $VERCEL env rm WASIAI_OWNER_ADDRESS $env --yes 2>/dev/null
  printf "%s" "$OWNER" | $VERCEL env add WASIAI_OWNER_ADDRESS $env
done
```

También agregar en `.env.local`:
```
WASIAI_OWNER_ADDRESS=0x94DCDb84207724A609B17e4838936832EA59B9eD
```

---

## Wave 2 — verifyAdminSignature.ts

### src/lib/admin/verifyAdminSignature.ts

```typescript
import { recoverTypedDataAddress } from 'viem'

const ALLOWED_ADDRESSES = [
  process.env.WASIAI_OWNER_ADDRESS,
  process.env.NEXT_PUBLIC_WASIAI_OWNER,
  process.env.NEXT_PUBLIC_OPERATOR_ADDRESS,
].map(a => a?.toLowerCase()).filter(Boolean) as string[]

export const ADMIN_EIP712_DOMAIN = {
  name:    'WasiAI Admin',
  version: '1',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113),
} as const

export const ADMIN_EIP712_TYPES = {
  AdminAction: [
    { name: 'action',    type: 'string'  },
    { name: 'nonce',     type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const

export interface AdminActionMessage {
  action:    string
  nonce:     `0x${string}`
  timestamp: bigint
}

/**
 * Verifica una firma EIP-712 de acción admin.
 * Retorna { ok: true } si es válida, { ok: false, reason } si no.
 */
export async function verifyAdminSignature(
  signature: `0x${string}`,
  message:   AdminActionMessage,
): Promise<{ ok: boolean; reason?: string }> {
  // Anti-replay: timestamp no puede tener más de 5 minutos
  const now       = BigInt(Math.floor(Date.now() / 1000))
  const MAX_AGE   = 300n // 5 minutos
  if (now - message.timestamp > MAX_AGE) {
    return { ok: false, reason: 'signature_expired' }
  }

  try {
    const recovered = await recoverTypedDataAddress({
      domain:     ADMIN_EIP712_DOMAIN,
      types:      ADMIN_EIP712_TYPES,
      primaryType: 'AdminAction',
      message,
      signature,
    })

    if (!ALLOWED_ADDRESSES.includes(recovered.toLowerCase())) {
      return { ok: false, reason: 'not_authorized' }
    }

    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }
}
```

---

## Wave 3 — Modificar endpoints

### src/app/api/admin/fee/route.ts

Agregar imports al top:
```typescript
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
```

Reemplazar el bloque de verificación de sig:
```typescript
// ANTES:
const sig = request.headers.get('x-admin-signature')
if (!sig) {
  return NextResponse.json({ error: 'X-Admin-Signature required' }, { status: 401 })
}

// DESPUÉS:
const sig       = request.headers.get('x-admin-signature') as `0x${string}` | null
const nonceHdr  = request.headers.get('x-admin-nonce')     as `0x${string}` | null
const tsHdr     = request.headers.get('x-admin-timestamp')

if (!sig || !nonceHdr || !tsHdr) {
  return NextResponse.json({ error: 'Missing admin auth headers' }, { status: 401 })
}

const message: AdminActionMessage = {
  action:    'setPlatformFee',
  nonce:     nonceHdr,
  timestamp: BigInt(tsHdr),
}

const { ok, reason } = await verifyAdminSignature(sig, message)
if (!ok) {
  return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 })
}
```

### src/app/api/admin/settlement/route.ts

Mismo patrón — reemplazar el bloque de sig con:
```typescript
const sig       = request.headers.get('x-admin-signature') as `0x${string}` | null
const nonceHdr  = request.headers.get('x-admin-nonce')     as `0x${string}` | null
const tsHdr     = request.headers.get('x-admin-timestamp')

if (!sig || !nonceHdr || !tsHdr) {
  return NextResponse.json({ error: 'Missing admin auth headers' }, { status: 401 })
}

const message: AdminActionMessage = {
  action:    `settlement:${body.action}`,
  nonce:     nonceHdr,
  timestamp: BigInt(tsHdr),
}

const { ok, reason } = await verifyAdminSignature(sig, message)
if (!ok) {
  return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 })
}
```

⚠️ **ORDEN OBLIGATORIO en settlement:** leer `body` PRIMERO → construir `message.action` con `body.action` → LUEGO verificar firma. Si se invierte el orden, `body` queda sin leer y `message.action` es undefined — la verificación fallará silenciosamente.

---

## Wave 4 — Modificar admin/page.tsx

Agregar imports:
```typescript
import { useWalletClient } from 'wagmi'
```

Agregar en el componente (junto a los otros hooks):
```typescript
const { data: walletClient } = useWalletClient()
```

Crear helper de firma dentro del componente:
```typescript
async function signAdminAction(action: string): Promise<{
  signature: string
  nonce: string
  timestamp: string
} | null> {
  if (!walletClient) return null

  const nonce     = ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
  const timestamp = BigInt(Math.floor(Date.now() / 1000))

  const signature = await walletClient.signTypedData({
    domain: {
      name:    'WasiAI Admin',
      version: '1',
      chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113),
    },
    types: {
      AdminAction: [
        { name: 'action',    type: 'string'  },
        { name: 'nonce',     type: 'bytes32' },
        { name: 'timestamp', type: 'uint256' },
      ],
    },
    primaryType: 'AdminAction',
    message: { action, nonce, timestamp },
  })

  return { signature, nonce, timestamp: timestamp.toString() }
}
```

Actualizar `handleUpdateFee`:
```typescript
async function handleUpdateFee() {
  if (!isOwner) return
  setFeeMsg('Signing…')

  const auth = await signAdminAction('setPlatformFee').catch(() => null)
  if (!auth) { setFeeMsg('❌ Signature rejected'); return }

  setFeeMsg('Sending tx…')
  const res = await fetch('/api/admin/fee', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Admin-Signature': auth.signature,
      'X-Admin-Nonce':     auth.nonce,
      'X-Admin-Timestamp': auth.timestamp,
    },
    body: JSON.stringify({ bps: Number(newBps) }),
  })
  // resto igual
}
```

Aplicar el mismo patrón a `handleToggleMode` y `handleManualSettlement` — cada uno con su `action` string correspondiente (`'toggleSettlement'` y `'runSettlement'`).

---

## Wave 5 — Typecheck + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit  # 0 errores

git add -A
git commit -m "feat(WAS-80): EIP-712 signature verification en admin panel"
git push origin master master:main
```

---

## Constraint Directives

**OBLIGATORIO:**
- `verifyAdminSignature.ts` lee `WASIAI_OWNER_ADDRESS` primero (server-side), fallback a `NEXT_PUBLIC_WASIAI_OWNER`
- Timestamp anti-replay: MAX_AGE = 300n segundos
- `signTypedData` usa `chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)` — debe coincidir exactamente con el dominio del servidor para que `recoverTypedDataAddress` funcione en mainnet
- Wave 1 (Vercel env) se ejecuta ANTES de deployar

**PROHIBIDO:**
- NO cambiar la lógica de fee, toggle ni settlement — solo la capa de auth
- NO modificar `verifyAdminSignature` para aceptar direcciones que no sean owner/operator
- NO usar `ethers.js` — solo `viem`

## Escalation Rule
Si `useWalletClient` de wagmi retorna `undefined` al momento de la firma — agregar mensaje de error al usuario: "Wallet not ready, try reconnecting".
Si el body de settlement se lee ANTES del sig check y causa conflicto — leer body primero y luego verificar sig con el action del body.
