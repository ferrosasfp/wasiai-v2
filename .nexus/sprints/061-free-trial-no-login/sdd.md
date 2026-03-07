# SDD 061 — Free trial sin login

**HU:** 061 · **Sprint:** 17 · **Priority:** P1  
**Dependency:** HU-058 (must be implemented first — provides `src/lib/rate-limit-ip.ts`)

---

## Wave 0 — Pre-flight

### Steps

1. Verify HU-058 is complete — `src/lib/rate-limit-ip.ts` exists and exports `checkIpLimit`
2. Verify files exist:
   - `src/app/api/v1/agents/[slug]/trial/route.ts`
   - `src/features/agents/components/AgentTrialPlayground.tsx`
3. `pnpm build` exits 0 (baseline)

### Build gate
- `pnpm build` exits 0
- `src/lib/rate-limit-ip.ts` exists

---

## Wave 1 — Patch trial API route for unauthenticated access

### File: `src/app/api/v1/agents/[slug]/trial/route.ts`

#### Change 1 — Add import (top of file)

```ts
import { checkIpLimit } from '@/lib/rate-limit-ip'
```

#### Change 2 — GET handler: allow anonymous

**Before (lines 32–34):**
```ts
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```

**After:**
```ts
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Anonymous: return generic trial info (no usage tracking)
    return NextResponse.json({
      used: false,
      trialsUsed: 0,
      trialsRemaining: 3,
      limit: 3,
      usedAt: null,
      anonymous: true,
    })
  }
```

#### Change 3 — POST handler: allow anonymous with IP rate limit

**Before (lines 62–65):**
```ts
  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```

**After:**
```ts
  // 1. Auth (optional — anonymous allowed)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAnonymous = !user
```

#### Change 4 — Anonymous IP rate limit (after auth block, before existing IP rate limit ~line 68)

**Before:**
```ts
  // 2. Rate limit por IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { success } = await getTrialLimit().limit(`ip:${ip}`)
  if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
```

**After:**
```ts
  // 2. Rate limit por IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'

  if (isAnonymous) {
    // Anonymous: 3 calls per agent per IP per day (reuses 058 infra)
    const { success } = await checkIpLimit(ip, `trial-anon:${slug}`, 3)
    if (!success) {
      return NextResponse.json({
        error: 'anon_rate_limited',
        code: 'anon_trial_limited',
        limit: 3,
        message: 'Crea una cuenta gratuita para seguir probando',
      }, { status: 429 })
    }
  } else {
    const { success } = await getTrialLimit().limit(`ip:${ip}`)
    if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
```

#### Change 5 — Skip trial exhaustion check for anonymous (step 6–7, ~line 100)

**Before:**
```ts
  // 6-7. HU-3.3: Atómico — use_trial RPC (evita race condition TOCTOU)
  const { data: result } = await svc.rpc('use_trial', {
    p_user_id:  user.id,
    p_agent_id: agent.id,
    p_limit:    agent.free_trial_limit,
  })
  if (result === -1) {
    return NextResponse.json({ error: 'trial_exhausted', limit: agent.free_trial_limit }, { status: 409 })
  }
```

**After:**
```ts
  // 6-7. Trial usage tracking (authenticated only — anonymous tracked by IP rate limit)
  if (!isAnonymous) {
    const { data: result } = await svc.rpc('use_trial', {
      p_user_id:  user!.id,
      p_agent_id: agent.id,
      p_limit:    agent.free_trial_limit,
    })
    if (result === -1) {
      return NextResponse.json({ error: 'trial_exhausted', limit: agent.free_trial_limit }, { status: 409 })
    }
  }
```

#### Change 6 — logTrialCall: handle anonymous (agent_calls insert may need nullable caller_id)

The existing `logTrialCall` doesn't insert `caller_id` so no change needed there. Confirmed: the insert in `logTrialCall` (~line 129) only uses `agent_id`, `status`, `latency_ms`, `is_trial` — no user reference. ✓

### Build gate
- `pnpm build` exits 0
- `curl -X POST localhost:3000/api/v1/agents/<slug>/trial -d '{"input":"test"}' -H 'Content-Type: application/json'` returns 200 without auth

---

## Wave 2 — Patch trial UI for anonymous users

### File: `src/features/agents/components/AgentTrialPlayground.tsx`

#### Change 1 — Add state for anonymous limit hit (after line ~18)

```ts
  const [anonLimitHit, setAnonLimitHit] = useState(false)
```

#### Change 2 — Remove login gate, allow anonymous to use form

**Before (~lines 74–78):**
```tsx
          {!isAuthenticated ? (
            <p className="text-sm text-gray-500">
              <Link href="/auth/login" className="text-[#E84142] underline">Inicia sesión</Link>{' '}
              para probar gratis
            </p>
          ) : (
```

**After:**
```tsx
          {anonLimitHit ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-gray-600 font-medium">
                Has alcanzado el límite de pruebas gratuitas
              </p>
              <Link
                href="/auth/login"
                className="inline-block bg-[#E84142] text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-[#c73535] transition-colors"
              >
                Crear cuenta gratis →
              </Link>
            </div>
          ) : (
```

Remove the closing `)}` that previously ended the `!isAuthenticated` ternary — the new structure replaces both branches into: `anonLimitHit ? <create account> : <form>`.

#### Change 3 — Handle `anon_rate_limited` in handleTrial

In the `handleTrial` function, after `if (data.error === 'already_used')` block (~line 42), add:

```ts
        if (data.error === 'anon_rate_limited') { setAnonLimitHit(true); return }
```

#### Change 4 — Skip GET check for unauthenticated (already done — line 28: `if (!isAuthenticated) return`)

This is already correct — anonymous users skip the usage check and start in `'idle'` state. ✓

### Build gate
- `pnpm build` exits 0
- Visual: visit agent detail page without login → trial playground visible → can invoke → after 3 calls per agent → "Create account" banner

---

## Wave 3 — Final build gate

### Steps

1. `pnpm build` — exits 0
2. Verify all ACs:
   - AC-1: Unauthenticated user can click "Free Trial" ✓
   - AC-2: Trial works without login, 3 calls/agent/IP/day ✓
   - AC-3: Limit message shown ✓
   - AC-4: Authenticated users have normal trial behavior ✓
   - AC-5: Clean build ✓

### Build gate
- `pnpm build` exits 0
- All ACs verified
