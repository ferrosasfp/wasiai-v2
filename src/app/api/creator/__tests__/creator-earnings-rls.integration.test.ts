/**
 * creator-earnings-rls.integration.test.ts — WKH-SEC-03 (AC-1 / AC-2 / AC-4)
 *
 * INTEGRATION test against a REAL Postgres/Supabase instance — RLS cannot be
 * exercised by a mock. It proves, with two REAL `authenticated` JWTs, that:
 *   AC-1: creator A cannot cross-read creator B's creator_earnings row, nor B's
 *         legacy earnings columns on creator_profiles (post Phase B REVOKE).
 *   AC-2: creator A CAN read their own creator_earnings row.
 *   AC-4: creator A cannot write B's creator_earnings row (RLS denies it).
 *
 * REQUIRES (env) — the whole suite self-skips if any is missing so the normal
 * mocked test run stays green. The orchestrator runs this AFTER applying
 * Phase A + Phase B to the target DB:
 *   NEXT_PUBLIC_SUPABASE_URL  (or SUPABASE_URL)   — instance URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY                 — anon key (for JWT clients)
 *   SUPABASE_SERVICE_ROLE_KEY                     — service_role key (seed/admin)
 *
 * JWT strategy (FIXED, story §Decisiones 2): `auth.admin.createUser()` +
 * `signInWithPassword` for two real `authenticated` sessions. Does NOT depend on
 * SUPABASE_JWT_SECRET. Fallback: `supabase start` local with both migrations
 * applied (`supabase db reset` runs them from supabase/migrations/).
 *
 * NOTE: The `creator_earnings` mirror rows are created by the AFTER INSERT trigger
 * on creator_profiles; the profiles themselves are created by the auth signup
 * trigger (handle_new_user). So creating the two users is enough to get their
 * earnings rows; we then seed distinct values via the service_role client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL          = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const RLS_ENV_READY = Boolean(URL && ANON_KEY && SERVICE_KEY)

const PW  = 'rls-test-Pw-123456!'
const A_EMAIL = `rls-a-${Date.now()}@test.local`
const B_EMAIL = `rls-b-${Date.now()}@test.local`

// Self-skip when the DB env is not provided (keeps the mocked suite green).
const suite = RLS_ENV_READY ? describe : describe.skip

suite('WKH-SEC-03 — creator_earnings RLS (real DB)', () => {
  let admin: SupabaseClient
  let aClient: SupabaseClient
  let aUserId: string
  let bUserId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1. Create two real creators (signup trigger creates creator_profiles; the
    //    AFTER INSERT trigger creates each creator_earnings mirror row).
    const { data: a, error: aErr } = await admin.auth.admin.createUser({
      email: A_EMAIL, password: PW, email_confirm: true,
    })
    if (aErr || !a.user) throw aErr ?? new Error('failed to create user A')
    aUserId = a.user.id

    const { data: b, error: bErr } = await admin.auth.admin.createUser({
      email: B_EMAIL, password: PW, email_confirm: true,
    })
    if (bErr || !b.user) throw bErr ?? new Error('failed to create user B')
    bUserId = b.user.id

    // Seed distinct values (service_role bypasses RLS). B has a value A must never see.
    await admin.from('creator_earnings')
      .update({ pending_earnings_usdc: 99 }).eq('creator_id', bUserId)
    await admin.from('creator_earnings')
      .update({ pending_earnings_usdc: 7 }).eq('creator_id', aUserId)

    // 2. Real `authenticated` JWT for A (NOT SUPABASE_JWT_SECRET).
    const anonClient = createClient(URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: session, error: signInErr } =
      await anonClient.auth.signInWithPassword({ email: A_EMAIL, password: PW })
    if (signInErr || !session.session) throw signInErr ?? new Error('sign-in A failed')

    aClient = createClient(URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    })
  })

  afterAll(async () => {
    if (!admin) return
    if (aUserId) await admin.auth.admin.deleteUser(aUserId).catch(() => {})
    if (bUserId) await admin.auth.admin.deleteUser(bUserId).catch(() => {})
  })

  it('AC-1: A cannot cross-read B\'s creator_earnings row (0 rows, no values)', async () => {
    const { data: cross } = await aClient
      .from('creator_earnings').select('*').eq('creator_id', bUserId)
    expect(cross ?? []).toEqual([])
  })

  it('AC-1: A cannot read B\'s legacy earnings columns on creator_profiles (post Phase B)', async () => {
    const { data: legacy } = await aClient
      .from('creator_profiles').select('pending_earnings_usdc').eq('id', bUserId)
    // Column REVOKEd for authenticated → the value is never exposed. Whether the
    // driver returns [] or a row without the column, B's number must not appear.
    expect(legacy?.[0]?.pending_earnings_usdc ?? null).toBeNull()
  })

  it('AC-2: A can read their OWN creator_earnings row', async () => {
    const { data: self } = await aClient
      .from('creator_earnings').select('*').eq('creator_id', aUserId)
    expect(self).toHaveLength(1)
    expect(Number(self![0].pending_earnings_usdc)).toBe(7)
  })

  it('AC-4: A cannot write B\'s creator_earnings row (RLS denies the update)', async () => {
    const { data: wr } = await aClient
      .from('creator_earnings')
      .update({ pending_earnings_usdc: 0 })
      .eq('creator_id', bUserId)
      .select()
    expect(wr ?? []).toEqual([])

    // Confirm via service_role that B's value is untouched.
    const { data: bAfter } = await admin
      .from('creator_earnings').select('pending_earnings_usdc').eq('creator_id', bUserId).single()
    expect(Number(bAfter!.pending_earnings_usdc)).toBe(99)
  })
})
