# Story File — HU-069: Creator Wallet Unification

## Wave 0 — Backend (sync + validation)

### Task 0.1: Sync linkWallet() → creator_profiles
**File:** `src/actions/wallet.ts`
**Function:** `linkWallet()`
**After** the successful `profiles` update (line ~44), add:

```typescript
// HU-069: Sync to creator_profiles if wallet_address is null
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

**Constraint:** Only set if null. Never overwrite existing value.

---

### Task 0.2: Block wallet change if pending earnings
**File:** `src/app/api/creator/wallet/route.ts`
**Before** the `.update({ wallet_address })` call, add earnings check:

```typescript
// HU-069: Block wallet change if pending earnings > 0
const { data: current } = await supabase
  .from('creator_profiles')
  .select('wallet_address, pending_earnings_usdc')
  .eq('id', user.id)
  .single()

if (current?.wallet_address &&
    current.wallet_address.toLowerCase() !== wallet_address.toLowerCase()) {
  const pending = Number(current.pending_earnings_usdc ?? 0)
  if (pending > 0) {
    return NextResponse.json(
      { error: 'Withdraw your pending earnings before changing your withdrawal wallet.' },
      { status: 409 },
    )
  }
}
```

---

## Wave 1 — Frontend (UI validation)

### Task 1.1: WalletSetup — block edit if earnings pending
**File:** `src/components/WalletSetup.tsx`

Add prop:
```typescript
interface Props {
  initialWallet: string | null
  pendingEarnings?: number
}
```

In the "Configured state" block (line ~52), before the edit button:
```typescript
{(props.pendingEarnings ?? 0) > 0 && initialWallet ? (
  <span className="text-xs text-amber-500" title="Withdraw earnings before changing wallet">
    🔒
  </span>
) : (
  <button
    onClick={() => { setEditing(true); setSaved(false) }}
    className="text-xs text-avax-400 hover:text-avax-600 hover:underline"
  >
    Editar
  </button>
)}
```

---

### Task 1.2: EarningsSection — pass pendingEarnings to WalletSetup
**File:** `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx`

Find where `<WalletSetup>` is rendered (line ~74) and add:
```typescript
<WalletSetup
  initialWallet={profile?.wallet_address ?? null}
  pendingEarnings={Number(profile?.pending_earnings_usdc ?? 0)}
/>
```

---

### Task 1.3: UpgradeOnChainButton — validate against registered wallet
**File:** `src/features/agents/components/UpgradeOnChainButton.tsx`

Add prop:
```typescript
interface Props {
  slug: string
  pricePerCall: number
  registrationType: string
  isOwner: boolean
  registeredWallet?: string | null  // HU-069
}
```

Replace the onClick and add validation:
```typescript
const [walletError, setWalletError] = useState<string | null>(null)

function handleClick() {
  setWalletError(null)
  if (!registeredWallet) {
    setWalletError('Configure your withdrawal wallet in Dashboard first.')
    return
  }
  if (address?.toLowerCase() !== registeredWallet.toLowerCase()) {
    setWalletError(`Please connect wallet ${registeredWallet.slice(0,6)}…${registeredWallet.slice(-4)}`)
    return
  }
  setShowModal(true)
}
```

Add below the button:
```typescript
{walletError && <p className="text-xs text-red-500 mt-1">{walletError}</p>}
```

**Caller** (wherever UpgradeOnChainButton is rendered): pass `registeredWallet` from the creator's profile. Find where this component is used:

```bash
grep -rn "UpgradeOnChainButton" src --include="*.tsx" | grep -v "UpgradeOnChainButton.tsx"
```

Pass the prop from the parent that has access to creator_profiles.wallet_address.

---

## Acceptance Criteria Traceability

| AC | Task |
|----|------|
| AC-1: Auto-sync wallet | 0.1 |
| AC-2: Validate on withdraw | Already works (WithdrawButton.tsx line 58) |
| AC-3: Block wallet change if earnings > 0 | 0.2 + 1.1 |
| AC-4: Allow change if earnings === 0 | 0.2 (passthrough) |
| AC-5: Use registered wallet for on-chain | 1.3 |
| AC-6: Block if null | 1.3 (no registeredWallet case) |
| AC-7: Validate on selfRegisterAgent | 1.3 |
| AC-8: Consistency with on-chain wallets | Deferred to W2 (edge case) |
