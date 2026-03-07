# Report — 056: Google OAuth Login/Signup Broken

**Status:** ✅ DONE
**Classification:** FAST-FIX (config only, no code changes)
**Date:** 2026-03-06

## Root Cause

Two configuration issues, zero code changes needed:

1. **Supabase Google provider was disabled** — Error: `Unsupported provider: provider is not enabled`
2. **Supabase Site URL was `http://localhost:3000`** — OAuth callback redirected to localhost instead of production

## Fix Applied

1. Created Google OAuth credentials in Google Cloud Console
2. Enabled Google provider in Supabase with Client ID + Secret
3. Published Google OAuth app (moved from Testing → Production)
4. Changed Supabase Site URL from `http://localhost:3000` → `https://wasiai-v2.vercel.app`
5. Added `NEXT_PUBLIC_SITE_URL` to Vercel Development environment
6. Redeployed to production

## Google OAuth Config

- **Client ID:** `566240520510-ocif92sf2gesosquiqjftc1e5b4n7alm.apps.googleusercontent.com`
- **Redirect URI:** `https://bdwvrwzvsldephfibmuu.supabase.co/auth/v1/callback`
- **Scopes:** email, profile (basic — no user limit)

## For Future Domain Change

When moving to custom domain (e.g. `wasiai.com`):
1. Update `NEXT_PUBLIC_SITE_URL` in Vercel
2. Add new domain to Google OAuth authorized redirect URIs
3. Update Supabase Site URL in Authentication → URL Configuration
