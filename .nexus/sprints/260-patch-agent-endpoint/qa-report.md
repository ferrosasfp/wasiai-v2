# QA Report — SDD #260 PATCH /api/v1/agents/{slug}

**Verifier:** QA Verifier subagent  
**Date:** 2026-03-20  
**Builder commit:** 2cfb678b4  
**Verdict:** ✅ QA PASS

---

## Drift Detection

**Expected:** Modified `src/app/api/v1/agents/[slug]/route.ts`  
**Actual:** File exists and contains PATCH handler. ✅ No drift.

---

## AC Verification

### AC1 — PATCH with valid fields → updates only provided fields, returns updated agent
✅ CUMPLE  
- `route.ts:148` — `PatchAgentSchema` uses `.optional()` on all fields (only provided fields are patched)
- `route.ts:230` — `const patch = { ...fields }` builds patch from validated fields only
- `route.ts:243` — `.update(patch).select(...)` returns updated agent row

### AC2 — Non-owner requester → 403
✅ CUMPLE  
- `route.ts:197-201` — `if (requesterId !== agent.creator_id)` → returns `{ status: 403 }`

### AC3 — Unauthenticated → 401
✅ CUMPLE  
- `route.ts:175-179` — JWT path: `if (authErr || !user)` → returns `{ status: 401 }`
- `route.ts:167-171` — Agent key path: `if (keyErr || !keyRow)` → returns `{ status: 401 }`

### AC4 — endpoint_url provided → validated with validateEndpointUrlAsync (SSRF)
✅ CUMPLE  
- `route.ts:14` — `import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'`
- `route.ts:213-220` — `if (fields.endpoint_url !== undefined) { await validateEndpointUrlAsync(fields.endpoint_url) }`

### AC5 — input_schema provided → validated with metaValidateSchema
✅ CUMPLE  
- `route.ts:15` — `import { metaValidateSchema } from '@/lib/schema-validator'`
- `route.ts:222-228` — `if (fields.input_schema !== undefined) { const result = metaValidateSchema(...); if (!result.valid) return 422 }`

### AC6 — price_per_call validated 0.001 ≤ price ≤ 100
✅ CUMPLE  
- `route.ts:151` — `price_per_call: z.number().min(0.001).max(100).optional()`

### AC7 — Cannot edit slug, creator_id, id, status, total_calls, total_revenue, webhook_secret
✅ CUMPLE  
- `route.ts:148-163` — `PatchAgentSchema` only allows: name, description, category, price_per_call, endpoint_url, tags, input_schema, output_schema, max_rpm, max_rpd, mcp_description, sandbox_enabled, free_trial_enabled, free_trial_limit. None of the forbidden fields are included.

### AC8 — input_schema updated → metadata.input_example auto-updated via buildExampleFromSchema
✅ CUMPLE  
- `route.ts:16` — `import { buildExampleFromSchema } from '@/features/agents/utils/buildExampleFromSchema'`
- `route.ts:231-236` — `if (fields.input_schema !== undefined) { patch.metadata = { ...existingMetadata, input_example: buildExampleFromSchema(fields.input_schema) } }`

---

## Build Verification

`tsc --noEmit` → **0 errors** ✅

---

## Summary

All 8 ACs verified with code evidence. Build is clean. **QA PASS ✅**
