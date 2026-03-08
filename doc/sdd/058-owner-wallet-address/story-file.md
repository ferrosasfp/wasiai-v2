# Story File — #058: Owner Wallet Address en Agent Keys

> SDD: doc/sdd/058-owner-wallet-address/sdd.md
> Fecha: 2026-03-07
> Branch: fix/058-owner-wallet-address
> SPEC_APPROVED: 2026-03-07

---

## Goal

La wallet del primer depósito en una Agent Key no se persiste — el campo `owner_wallet_address`
no existe en la tabla `agent_keys` y el upsert en `creator_profiles` tiene un bug silencioso
(`.eq('user_id')` pero la PK es `id`). Esto hace que al retirar, el servidor tenga que consultar
el contrato on-chain cada vez. Esta HU agrega `owner_wallet_address` a `agent_keys`, la persiste
en el primer depósito, la usa en el retiro, y avisa al usuario si deposita con una wallet diferente.

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN el usuario hace el primer depósito (`owner_wallet_address IS NULL`),
THEN `agent_keys.owner_wallet_address` se guarda con su wallet address.

**AC-2a:** WHEN el usuario deposita con la misma wallet ya registrada,
THEN el depósito procede sin warning.

**AC-2b:** WHEN el usuario deposita con una wallet diferente a la registrada,
THEN el depósito se acepta Y el response incluye `{ warning: "El retiro solo se puede hacer con 0xOriginal..." }`.

**AC-3:** WHEN el DepositModal se abre y `ownerWalletAddress` difiere de la wallet conectada,
THEN se muestra banner amber: "Esta key solo puede retirarse con 0xABCD…1234."

**AC-4:** WHEN el retiro es solicitado,
THEN el servidor usa `owner_wallet_address` de DB; fallback a `getKeyOwnerOnChain` si es null.

**AC-5:** IF el usuario deposita en una key de otro usuario,
THEN el servidor retorna `403 Forbidden`.

---

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 0 | Supabase SQL Editor | **Ejecutar SQL** | `ALTER TABLE agent_keys ADD COLUMN IF NOT EXISTS owner_wallet_address TEXT` | N/A |
| 1 | `src/features/agent-api/services/agent-keys.service.ts` | Modificar | Agregar `owner_wallet_address?: string \| null` a interfaz `AgentKey` | Mismo archivo línea 4 |
| 2 | `src/app/api/agent-keys/[id]/deposit/route.ts` | Modificar | Ampliar select, eliminar bloque `creator_profiles`, agregar lógica `owner_wallet_address` | Mismo archivo |
| 3 | `src/app/api/agent-keys/[id]/withdraw/route.ts` | Modificar | Ampliar select, reemplazar `getKeyOwnerOnChain` por `owner_wallet_address ?? fallback` | Mismo archivo |
| 4 | `src/app/[locale]/agent-keys/page.tsx` | Modificar | Ampliar `depositKey` state, `DepositModalProps`, warning pre-depósito, warning post-depósito | Mismo archivo — patrón `bg-amber-50` de `WithdrawModal` |

---

## Exemplars

### Exemplar 1 — Interfaz AgentKey
**Archivo**: `src/features/agent-api/services/agent-keys.service.ts`
**Usar para**: Archivo #1
**Patrón clave**:
```typescript
export interface AgentKey {
  id: string
  owner_id: string
  name: string
  key_hash: string
  budget_usdc: number
  spent_usdc: number
  is_active: boolean
  last_used_at: string | null
  created_at: string
  // ← agregar aquí:
  owner_wallet_address?: string | null
  raw_key?: string
}
```

### Exemplar 2 — Bloque owner_wallet_address en deposit route
**Archivo**: `src/app/api/agent-keys/[id]/deposit/route.ts`
**Usar para**: Archivo #2
**Patrón clave**:

**Select ampliado** (reemplazar select actual en paso 3):
```typescript
.select('id, key_hash, budget_usdc, is_active, owner_id, owner_wallet_address')
```

**Eliminar** este bloque completo (líneas ~86–100 actuales):
```typescript
// HAL-020: Verify ownerAddress matches authenticated user's wallet
const { data: creatorProfile } = await supabase
  .from('creator_profiles')
  ...
```

**Insertar** este bloque en su lugar (ENTRE paso 3 y paso 4):
```typescript
// ── HU-058: Owner wallet enforcement ───────────────────────────────────────
const registeredWallet = keyRow.owner_wallet_address?.toLowerCase()
const incomingWallet   = body.ownerAddress.toLowerCase()
const ownerDiffers     = !!registeredWallet && registeredWallet !== incomingWallet
// ownerDiffers → depósito se permite, warning en response (RN-3)
```

**Insertar** DESPUÉS del `increment_key_budget` RPC, ANTES del return final:
```typescript
// Persistir owner_wallet_address en primer depósito (HAL-025: solo después de tx OK)
if (!registeredWallet) {
  await supabase
    .from('agent_keys')
    .update({ owner_wallet_address: body.ownerAddress })
    .eq('id', id)
    .eq('owner_id', user.id)
}

return NextResponse.json({
  ok: true,
  txHash,
  newBudgetDb:   newBudget,
  onChainBalance,
  ...(ownerDiffers ? {
    warning: `Este depósito se acreditó a la key. El retiro solo se puede hacer con ${keyRow.owner_wallet_address}.`
  } : {}),
})
```

### Exemplar 3 — withdraw route con fallback
**Archivo**: `src/app/api/agent-keys/[id]/withdraw/route.ts`
**Usar para**: Archivo #3
**Patrón clave**:

**Select ampliado**:
```typescript
.select('id, key_hash, is_active, owner_id, owner_wallet_address')
```

**Reemplazar** bloque `getKeyOwnerOnChain` actual:
```typescript
// RN-1: DB es fuente primaria; fallback on-chain para keys sin owner_wallet_address
const ownerAddress = keyRow.owner_wallet_address
  ?? await getKeyOwnerOnChain(keyRow.key_hash)

if (!ownerAddress) {
  return NextResponse.json(
    { error: 'Key owner not found on-chain. Key may not have been deposited yet.' },
    { status: 400 },
  )
}
```

### Exemplar 4 — Warning banner amber (DepositModal)
**Archivo**: `src/app/[locale]/agent-keys/page.tsx`
**Usar para**: Archivo #4 — patrón visual
**Patrón clave** (copiar estilo de `WithdrawModal`):
```tsx
{ownerWalletAddress &&
 address &&
 ownerWalletAddress.toLowerCase() !== address.toLowerCase() && (
  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2 text-xs text-amber-800">
    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
    <span>
      Esta key solo puede retirarse con{' '}
      <span className="font-mono font-semibold">
        {ownerWalletAddress.slice(0,6)}…{ownerWalletAddress.slice(-4)}
      </span>.
      Tu wallet actual puede depositar pero no retirar.
    </span>
  </div>
)}
```

### Exemplar 5 — Estado depositKey ampliado + DepositModalProps
**Archivo**: `src/app/[locale]/agent-keys/page.tsx`
**Usar para**: Archivo #4

**Estado** (buscar `useState<{ id: string; name: string }` y reemplazar):
```typescript
const [depositKey, setDepositKey] = useState<{
  id: string
  name: string
  ownerWalletAddress?: string | null
} | null>(null)
```

**Al abrir el modal** (buscar `setDepositKey({` y reemplazar):
```typescript
onClick={() => setDepositKey({
  id:                 key.id,
  name:               key.name,
  ownerWalletAddress: key.owner_wallet_address,
})}
```

**Props del componente** (reemplazar `DepositModalProps`):
```typescript
interface DepositModalProps {
  keyId:               string
  keyName:             string
  ownerWalletAddress?: string | null   // ← nuevo
  onClose:             () => void
  onSuccess:           () => void
}
```

**Desestructuración en componente** (agregar `ownerWalletAddress`):
```typescript
function DepositModal({ keyId, keyName, ownerWalletAddress, onClose, onSuccess }: DepositModalProps)
```

**Estado nuevo en `DepositModal`**:
```typescript
const [depositWarning, setDepositWarning] = useState('')
```

**Al recibir response** (en ambas rutas B y C, después de verificar `res.ok`):
```typescript
const data = await res.json()
if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)
if (data.warning) setDepositWarning(data.warning)
```

**En JSX estado `success`** (debajo del texto de éxito):
```tsx
{depositWarning && (
  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
    <AlertTriangle size={13} className="inline mr-1" />
    {depositWarning}
  </div>
)}
```

**Render del modal** (en la página, pasar la prop):
```tsx
<DepositModal
  keyId={depositKey.id}
  keyName={depositKey.name}
  ownerWalletAddress={depositKey.ownerWalletAddress}
  onClose={...}
  onSuccess={...}
/>
```

---

## Constraint Directives

### OBLIGATORIO
- W0 SQL es **Serial Gate** — ejecutar antes de cualquier código. Sin esto, `select('owner_wallet_address')` rompe producción
- `select` en deposit route DEBE incluir `owner_wallet_address`
- Guardar `owner_wallet_address` SOLO después de tx on-chain OK (HAL-025)
- Guardar solo si `!registeredWallet` (primer depósito)
- UPDATE usa `supabase` autenticado (mismo client que verificó ownership en paso 3)
- Fallback `getKeyOwnerOnChain` en withdraw si `owner_wallet_address` es null

### PROHIBIDO
- NO usar `NOT NULL` en la migración SQL
- NO bloquear el depósito cuando wallet difiere — solo warning en response
- NO volver a introducir lógica de `creator_profiles` en deposit route
- NO modificar `CloseKeyModal`, `WithdrawModal`, `createAgentKey`, `revokeAgentKey`
- NO agregar dependencias nuevas
- NO modificar archivos fuera de la tabla "Files to Modify/Create"

---

## Test Expectations

Sin tests automáticos nuevos requeridos.  
Verificación: `npm run lint && npx tsc --noEmit` sin errores ni warnings.  
QA hará verificación manual (F4).

---

## Waves

### Wave 0 — Serial Gate (ANTES de cualquier código)
- [ ] W0.1: Ejecutar SQL en Supabase Dashboard → SQL Editor:
  ```sql
  ALTER TABLE agent_keys
    ADD COLUMN IF NOT EXISTS owner_wallet_address TEXT;
  ```
- [ ] W0.2: Verificar que la columna existe: `SELECT owner_wallet_address FROM agent_keys LIMIT 1`

### Wave 1 — Backend (parallelizable)
- [ ] W1.1: `agent-keys.service.ts` → agregar `owner_wallet_address` a interfaz `AgentKey` → Exemplar 1
- [ ] W1.2: `deposit/route.ts` → ampliar select, eliminar `creator_profiles`, insertar lógica `owner_wallet_address` → Exemplar 2
- [ ] W1.3: `withdraw/route.ts` → ampliar select, reemplazar `getKeyOwnerOnChain` por fallback → Exemplar 3

### Wave 2 — Frontend
- [ ] W2.1: `page.tsx` → ampliar `depositKey` state + `DepositModalProps` + desestructuración → Exemplar 5
- [ ] W2.2: `page.tsx` → warning pre-depósito en form → Exemplar 4
- [ ] W2.3: `page.tsx` → `depositWarning` state + warning post-depósito en success → Exemplar 5
- [ ] W2.4: `page.tsx` → pasar `ownerWalletAddress` al render del modal → Exemplar 5

### Wave 3 — Verificación
- [ ] W3.1: `npm run lint -- --max-warnings 0` → 0 warnings
- [ ] W3.2: `npx tsc --noEmit` → 0 errores
- [ ] W3.3: `npm run build` → pasa

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | Columna existe en Supabase |
| W1 | `npx tsc --noEmit` pasa |
| W2 | `npx tsc --noEmit` pasa |
| W3 | lint + typecheck + build limpios |

---

## Out of Scope

- Contrato on-chain — no redesplegar
- `creator_profiles` — no tocar (ni corregir el bug de `user_id` vs `id`)
- `WithdrawModal` — no modificar
- `CloseKeyModal` — no tocar
- `createAgentKey`, `revokeAgentKey`, `validateAgentKey` — no tocar
- Depósitos directos al contrato bypasseando la UI
- Retiros parciales (WAS-167 en backlog)

---

## Escalation Rule

**Si algo no está en este Story File, Dev PARA y pregunta a Architect.**

Situaciones de escalation obligatoria:
- W0: el SQL falla con un error diferente a "column already exists" → Architect revisa schema
- `keyRow.owner_wallet_address` no aparece en el tipo TypeScript tras W1.1 → Architect ajusta
- El bloque `creator_profiles` tiene dependencias no vistas → Architect revisa antes de eliminar
- Cualquier archivo fuera de la tabla necesita cambio → Architect actualiza Story File

---

*Story File generado por NexusAgil — F2.5 | HU-058 | SPEC_APPROVED: 2026-03-07*
