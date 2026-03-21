# Build Report — WAS-260: invoke select explicit fields

**Date:** 2026-03-20  
**Branch:** `improvement/260-invoke-select-explicit`  
**Commit:** `perf(invoke): replace select('*') with explicit fields in hot path WAS-260`

## Change

**File:** `src/app/api/v1/models/[slug]/invoke/route.ts` — line 163

**Before:**
```ts
supabase.from('agents').select('*').eq('slug', slug).single(),
```

**After:**
```ts
supabase.from('agents').select('id, slug, status, name, endpoint_url, webhook_secret, price_per_call, creator_id, user_id, category, input_schema, max_rpd, max_rpm').eq('slug', slug).single(),
```

## Acceptance Criteria

| AC | Status | Notes |
|----|--------|-------|
| AC1 | ✅ PASS | `select('*')` replaced with explicit field list |
| AC2 | ✅ PASS | All 13 fields present in select |
| AC3 | ✅ PASS | Only 1 line changed |
| AC4 | ✅ PASS | `npx tsc --noEmit` — no errors |

## Fields Verified (13)

`id`, `slug`, `status`, `name`, `endpoint_url`, `webhook_secret`, `price_per_call`, `creator_id`, `user_id`, `category`, `input_schema`, `max_rpd`, `max_rpm`
