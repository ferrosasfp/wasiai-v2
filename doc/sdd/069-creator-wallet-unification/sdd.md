# SDD-069: Creator Wallet Unification

## Context Map

### Archivos leídos (Codebase Grounding)

| Archivo | Rol | Patrón extraído |
|---------|-----|-----------------|
| `src/actions/wallet.ts` | Server action para link/unlink wallet en `profiles` | Update `profiles.wallet_address`, NO toca `creator_profiles` |
| `src/components/WalletSetup.tsx` | UI para editar wallet en `creator_profiles` vía `/api/creator/wallet` | POST fetch, sin validación de earnings pendientes |
| `src/app/api/creator/wallet/route.ts` | API para guardar wallet en `creator_profiles` | Update directo, sin check de earnings |
| `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` | Botón withdraw con claimEarnings | Valida `connectedAddress === walletAddress` ✅ |
| `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Pasa `wallet_address` de `creator_profiles` a WithdrawButton | Lee de `creator_profiles` |
| `src/features/agents/components/UpgradeOnChainButton.tsx` | Abre modal para selfRegisterAgent | Usa `address` de wagmi directo, NO valida contra `creator_profiles` |
| `src/features/agents/components/UpgradeOnChainModal.tsx` | Ejecuta selfRegisterAgent con `creatorAddress` | Recibe address como prop, no consulta DB |
| `src/app/api/creator/earnings/voucher/route.ts` | Genera voucher EIP-712 para claimEarnings | Lee `creator_profiles.wallet_address`, falla si null |

### Problema raíz

Hay **dos fuentes de verdad** para la wallet del creator:
1. `profiles.wallet_address` — se llena al conectar wallet (navbar)
2. `creator_profiles.wallet_address` — se llena solo manualmente vía WalletSetup

El withdraw y el voucher leen de `creator_profiles`. Si no se llenó manualmente → null → no puede retirar.

Además, `UpgradeOnChainButton` usa la wallet conectada sin validar contra la registrada, lo que permite registrar agentes on-chain con wallets distintas.

---

## Decisiones de diseño

### D-1: `creator_profiles.wallet_address` es la fuente de verdad
- Todo lo que toca earnings (voucher, withdraw, register on-chain) lee de aquí
- `profiles.wallet_address` se sincroniza → `creator_profiles.wallet_address` si es null

### D-2: Sincronización automática en `linkWallet()`
- Cuando `linkWallet()` guarda en `profiles`, también actualiza `creator_profiles.wallet_address` **solo si es null**
- Si ya tiene wallet en `creator_profiles`, no la sobreescribe (el creator la configuró manualmente)

### D-3: Bloqueo de cambio con earnings pendientes
- `/api/creator/wallet` antes de actualizar, lee `pending_earnings_usdc` del creator
- Si > 0, rechaza con 409 y mensaje explicativo
- También verifica on-chain con `getPendingEarnings(old_wallet)` si la wallet actual está registrada

### D-4: Validación en UpgradeOnChain
- `UpgradeOnChainButton` consulta `creator_profiles.wallet_address`
- Si wallet conectada ≠ wallet registrada → no abre modal, muestra error
- Si wallet registrada es null → muestra "Configura tu wallet primero"

### D-5: No cambio de contrato
- El contrato ya funciona correctamente
- `claimEarnings` envía a `creator` del voucher
- `selfRegisterAgent` registra el `creator` que se le pasa
- Solo necesitamos consistencia en la capa de aplicación

---

## Constraint Directives

- **CD-1:** NO tocar el contrato inteligente
- **CD-2:** NO cambiar schema de DB (solo data updates)
- **CD-3:** NO permitir cambio de wallet si hay earnings pendientes (off-chain o on-chain)
- **CD-4:** NO sobreescribir `creator_profiles.wallet_address` si ya tiene valor en la sincronización automática
- **CD-5:** NO hacer migración masiva de datos — usuarios existentes se arreglan en su próximo login/connect

---

## Cambios por archivo

### W0 — Backend

#### 1. `src/actions/wallet.ts` → `linkWallet()`
**Cambio:** Después de actualizar `profiles`, sincronizar a `creator_profiles` si wallet_address es null.

```typescript
// Después del update a profiles exitoso:
const { data: creatorProfile } = await supabase
  .from('creator_profiles')
  .select('id, wallet_address')
  .eq('id', user.id)
  .maybeSingle()

if (creatorProfile && !creatorProfile.wallet_address) {
  await supabase
    .from('creator_profiles')
    .update({ wallet_address: validated.data })
    .eq('id', user.id)
}
```

#### 2. `src/app/api/creator/wallet/route.ts`
**Cambio:** Validar earnings pendientes antes de permitir cambio.

```typescript
// Antes del update:
const { data: current } = await supabase
  .from('creator_profiles')
  .select('wallet_address, pending_earnings_usdc')
  .eq('id', user.id)
  .single()

// Si ya tiene wallet y quiere cambiar, verificar earnings
if (current?.wallet_address && current.wallet_address.toLowerCase() !== wallet_address.toLowerCase()) {
  const pendingDb = Number(current.pending_earnings_usdc ?? 0)
  if (pendingDb > 0) {
    return NextResponse.json(
      { error: 'Withdraw pending earnings before changing wallet' },
      { status: 409 }
    )
  }
  // TODO: verificar on-chain getPendingEarnings(old_wallet) si se quiere ser exhaustivo
}
```

### W1 — Frontend

#### 3. `src/components/WalletSetup.tsx`
**Cambio:** Recibir prop `pendingEarnings` y bloquear edición si > 0.

```typescript
interface Props {
  initialWallet: string | null
  pendingEarnings?: number  // nuevo
}
```

Si `pendingEarnings > 0 && initialWallet`:
- Ocultar botón "Editar"
- Mostrar tooltip: "Retira tus earnings antes de cambiar wallet"

#### 4. `src/features/agents/components/UpgradeOnChainButton.tsx`
**Cambio:** Recibir `registeredWallet` prop y validar contra wallet conectada.

```typescript
interface Props {
  slug: string
  pricePerCall: number
  registrationType: string
  isOwner: boolean
  registeredWallet: string | null  // nuevo
}
```

- Si `!registeredWallet` → mostrar "Configura tu wallet primero"
- Si `address.toLowerCase() !== registeredWallet.toLowerCase()` → mostrar "Conecta la wallet registrada"
- Solo abrir modal si match

#### 5. `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx`
**Cambio:** Pasar `pendingEarnings` a `WalletSetup`.

---

## Readiness Check

| Check | Status |
|-------|--------|
| Todos los archivos referenciados existen | ✅ verificado con Read |
| No hay ambigüedades en ACs | ✅ |
| Constraint Directives claras | ✅ |
| Waves definidas | ✅ W0 + W1 |
| No requiere cambio de contrato | ✅ |
| No requiere cambio de schema | ✅ |
| Exemplars vivos | ✅ patterns extraídos de código real |
