# Work Item — 056: Google OAuth Login/Signup Broken

**Classification:** HU-MAJOR
**Priority:** P0 — CRITICAL (users cannot authenticate)
**Sprint:** TBD
**Linear:** TBD

---

## Problem

Google login and signup do not work on production (`wasiai-v2.vercel.app`). Users clicking "Sign in with Google" or "Sign up with Google" are unable to authenticate.

## Root Cause Hypotheses

1. **Supabase redirect URL allowlist** — The callback URL `https://wasiai-v2.vercel.app/{locale}/callback` may not be in Supabase's allowed redirect URLs
2. **Route group mismatch** — Callback route lives at `src/app/[locale]/(auth)/callback/route.ts` inside an `(auth)` group. The `redirectTo` in `signInWithGoogle()` points to `/{locale}/callback` which is correct (groups don't affect URL), but worth verifying
3. **`NEXT_PUBLIC_SITE_URL` env var** — If not set or wrong in Vercel, `getSafeOriginFromHeaders()` falls back to `localhost:3000`, breaking the OAuth redirect
4. **Google OAuth app config** — Authorized redirect URIs in Google Cloud Console may not include the Supabase auth callback URL
5. **Supabase Google provider** — Provider may be disabled or misconfigured in Supabase dashboard

## Acceptance Criteria

1. **AC-1:** User can click "Sign in with Google" on `/en/login` and complete OAuth flow → redirected to dashboard
2. **AC-2:** User can click "Sign up with Google" on `/en/signup` and complete OAuth flow → account created, redirected to dashboard
3. **AC-3:** OAuth flow works in both locales (`/en/` and `/es/`)
4. **AC-4:** Error case: if OAuth fails, user sees a meaningful error message on the login page (not a blank screen or 500)

## Investigation Steps

1. Check `NEXT_PUBLIC_SITE_URL` in Vercel env vars → must be `https://wasiai-v2.vercel.app`
2. Check Supabase Auth → Redirect URLs → must include `https://wasiai-v2.vercel.app/**`
3. Check Supabase Auth → Google provider → must be enabled with valid client ID/secret
4. Check Google Cloud Console → OAuth 2.0 → Authorized redirect URIs → must include `https://<supabase-project>.supabase.co/auth/v1/callback`
5. Test locally with `npm run dev` to isolate whether it's a config issue vs code issue

## Files Involved

- `src/actions/auth.ts` — `signInWithGoogle()` (line 182)
- `src/app/[locale]/(auth)/callback/route.ts` — OAuth callback handler
- `src/lib/security/allowed-origins.ts` — Origin validation for redirects
- `src/features/auth/components/LoginForm.tsx` — Login UI
- `src/features/auth/components/SignupForm.tsx` — Signup UI

## Notes

- The `allowed-origins.ts` has a fallback to `SITE_URL || 'http://localhost:3000'` — if SITE_URL is empty in production, all OAuth redirects would fail silently
- The callback route returns a redirect to login with `?error=auth_callback_error` on failure, so users should see *something* — need to know if they see that error or something else entirely
