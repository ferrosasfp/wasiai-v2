## Build Report — WAS-245 Fix F-01

### Commit
- Hash: `d4273a3ff`

### Fix Applied
**File:** `src/app/api/v1/agents/[slug]/reputation/route.ts`

**Change:** Added NaN guard to `availableWindowDays` parseInt
```typescript
// Before
const availableWindowDays = parseInt(windowSetting?.value ?? '7', 10)

// After
const availableWindowDays = Math.max(1, parseInt(windowSetting?.value ?? '7', 10) || 7)
```

### Build Gate
✅ `npm run typecheck` — passed
✅ `npm run lint` — passed (0 warnings)

### Impact
- Prevents NaN propagation when `app_settings.value` is malformed
- Falls back to 7 days on parse failure
- Enforces minimum 1-day window with `Math.max`
