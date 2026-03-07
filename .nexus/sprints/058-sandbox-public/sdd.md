# SDD 058 — Sandbox público sin login

**HU:** 058 · **Sprint:** 17 · **Priority:** P0

---

## Wave 0 — Pre-flight

### Steps

1. Verify files exist:
   - `src/app/api/v1/sandbox/invoke/[slug]/route.ts`
   - `src/app/api/v1/sandbox/balance/route.ts`
   - `src/app/[locale]/sandbox/SandboxClient.tsx`
   - `src/app/[locale]/sandbox/page.tsx`
2. Verify `@upstash/redis` in `package.json` (line ~39 — already present)
3. Run `pnpm build` — must pass clean (baseline)

### Build gate
- `pnpm build` exits 0

---

## Wave 1 — IP rate limiter utility

### New file: `src/lib/rate-limit-ip.ts`

Create a reusable IP-based daily rate limiter using Upstash Redis (already a dependency).

```ts
/**
 * IP-based daily rate limiter via Upstash Redis
 * Usage: const { success, remaining } = await checkIpLimit(ip, prefix, maxCalls)
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const limiters = new Map<string, Ratelimit>()

export function getIpLimiter(prefix: string, maxCalls: number): Ratelimit {
  const key = `${prefix}:${maxCalls}`
  if (!limiters.has(key)) {
    limiters.set(key, new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxCalls, '1 d'),
      prefix: `rl:${prefix}`,
    }))
  }
  return limiters.get(key)!
}

export async function checkIpLimit(
  ip: string,
  prefix: string,
  maxCalls: number,
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const rl = getIpLimiter(prefix, maxCalls)
  const { success, remaining, reset } = await rl.limit(ip)
  return { success, remaining, reset }
}
```

### Build gate
- `pnpm build` exits 0 (file is importable, no type errors)

---

## Wave 2 — Patch sandbox invoke API route

### File: `src/app/api/v1/sandbox/invoke/[slug]/route.ts`

#### Change 1 — Add import (after line 7)

```ts
import { checkIpLimit } from '@/lib/rate-limit-ip'
```

#### Change 2 — Replace auth block (lines 60–64)

**Before:**
```ts
  // 1. Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

**After:**
```ts
  // 1. Auth (optional — anonymous allowed)
  const { data: { user } } = await supabase.auth.getUser()
  const isAnonymous = !user

  // 1b. IP rate limit for anonymous users — 5 calls/day
  if (isAnonymous) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
    const { success, remaining, reset } = await checkIpLimit(ip, 'sandbox-anon', 5)
    if (!success) {
      return NextResponse.json({
        error: 'Anonymous rate limit exceeded',
        code: 'anon_rate_limited',
        limit: 5,
        remaining: 0,
        reset_at: new Date(reset).toISOString(),
        message: 'Crea una cuenta gratuita para seguir probando',
      }, { status: 429 })
    }
  }
```

#### Change 3 — Authenticated rate limit: wrap existing rate limit in `if (!isAnonymous)` (lines 66–75)

**Before:**
```ts
  // 2. Rate limit — sliding window 10 calls / 1 hora
  const { success, limit, reset } = await getSandboxLimit().limit(user.id)
  if (!success) {
    const body: SandboxRateLimitResponse = {
      error:    'Rate limit exceeded',
      code:     'sandbox_rate_limited',
      limit,
      reset_at: new Date(reset).toISOString(),
    }
    return NextResponse.json(body, { status: 429 })
  }
```

**After:**
```ts
  // 2. Rate limit — sliding window 10 calls / 1 hora (authenticated only)
  if (!isAnonymous) {
    const { success, limit, reset } = await getSandboxLimit().limit(user!.id)
    if (!success) {
      const body: SandboxRateLimitResponse = {
        error:    'Rate limit exceeded',
        code:     'sandbox_rate_limited',
        limit,
        reset_at: new Date(reset).toISOString(),
      }
      return NextResponse.json(body, { status: 429 })
    }
  }
```

#### Change 4 — Skip balance check & deduction for anonymous (wrap steps 4–6 in `if (!isAnonymous)`)

**Before (steps 4–6):** The upsert, select, balance check, and deduct_sandbox_balance blocks.

**After:** Wrap all of steps 4, 5, 6 in:
```ts
  if (!isAnonymous) {
    // ... existing steps 4, 5, 6 unchanged ...
  }
```

#### Change 5 — agent_calls insert: handle anonymous caller (step 10, ~line 137)

**Before:**
```ts
    caller_id:    user.id,
```

**After:**
```ts
    caller_id:    user?.id ?? null,
```

#### Change 6 — Balance remaining for anonymous (step 11)

After the existing `updatedCredits` block, patch the response to handle anonymous:

**Before:**
```ts
  const balanceRemaining = (updatedCredits?.balance_usdc ?? 0).toString()
```

**After:**
```ts
  let balanceRemaining: string
  if (isAnonymous) {
    balanceRemaining = '0'
  } else {
    const { data: updatedCredits } = await supabase
      .from('sandbox_credits')
      .select('balance_usdc')
      .eq('user_id', user!.id)
      .single<SandboxCreditsRow>()
    balanceRemaining = (updatedCredits?.balance_usdc ?? 0).toString()
  }
```

(Move the `updatedCredits` fetch inside the else-branch since it was previously after step 10.)

### Build gate
- `pnpm build` exits 0
- Manual test: `curl -X POST localhost:3000/api/v1/sandbox/invoke/<slug> -d '{"input":"test"}' -H 'Content-Type: application/json'` returns 200 (no auth)

---

## Wave 3 — Patch sandbox balance API

### File: `src/app/api/v1/sandbox/balance/route.ts`

#### Change — Return mock balance for unauthenticated

**Before:**
```ts
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

**After:**
```ts
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Anonymous: return null balance (UI hides balance section)
    return NextResponse.json({ balance_usdc: null, total_calls: 0, anonymous: true })
  }
```

### Build gate
- `pnpm build` exits 0

---

## Wave 4 — Patch SandboxClient.tsx

### File: `src/app/[locale]/sandbox/SandboxClient.tsx`

#### Change 1 — Add `isAnonymous` derived state (after line ~34)

```ts
  const isAnonymous = !userId
  const [anonLimitHit, setAnonLimitHit] = useState(false)
```

#### Change 2 — Skip balance fetch for anonymous

In `fetchBalance`, wrap in:
```ts
  const fetchBalance = useCallback(async () => {
    if (!userId) { setBalance(null); return }
    // ... existing logic ...
  }, [userId])
```

#### Change 3 — Handle 429 with `anon_rate_limited` code in `handleInvoke`

In the `res.status === 429` branch, add:
```ts
        } else if (res.status === 429) {
          if (errData.code === 'anon_rate_limited') {
            setAnonLimitHit(true)
            setErrorMsg(null)
          } else {
            setErrorMsg(`Límite alcanzado (${errData.limit ?? 10} llamadas/hora). Reintentar en: ${errData.reset_at ?? 'pronto'}`)
          }
```

#### Change 4 — Handle 401 for anonymous: remove error, let it pass

In the `res.status === 401` branch — this should no longer occur for sandbox invoke, but keep as fallback.

#### Change 5 — Hide balance card for anonymous

Wrap the balance `<section>` in:
```tsx
        {!isAnonymous && (
          <section className="rounded-2xl ...">
            {/* existing balance card */}
          </section>
        )}
```

#### Change 6 — Show "Create account" banner when `anonLimitHit`

After the error section, add:
```tsx
        {anonLimitHit && (
          <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-center space-y-3">
            <p className="text-sm text-blue-800 font-medium">
              Has alcanzado el límite diario de pruebas gratuitas (5 llamadas)
            </p>
            <a
              href="/auth/login"
              className="inline-block bg-[#E84142] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#d03536] transition-colors"
            >
              Crear cuenta gratis →
            </a>
          </section>
        )}
```

#### Change 7 — Disable invoke button when `anonLimitHit`

Add `anonLimitHit` to disabled condition:
```tsx
            disabled={loading || !selectedSlug || agents.length === 0 || anonLimitHit}
```

### Build gate
- `pnpm build` exits 0
- Visual: load `/sandbox` without logging in → no balance card → can invoke → after 5 calls → "Create account" banner

---

## Wave 5 — Final build gate

### Steps

1. `pnpm build` — exits 0, no type errors, no lint errors
2. Verify all ACs:
   - AC-1: Sandbox page loads without auth ✓ (done in 057)
   - AC-2: Anonymous invoke works, IP limited to 5/day ✓
   - AC-3: Limit message shown ✓
   - AC-4: Authenticated users unaffected ✓
   - AC-5: Rate limit via Upstash Redis ✓
   - AC-6: No wallet needed ✓
   - AC-7: Balance hidden for anon ✓
   - AC-8: Clean build ✓

### Build gate
- `pnpm build` exits 0
- All ACs verified
