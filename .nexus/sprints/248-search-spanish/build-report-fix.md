## Build Report — WAS-248 Fix F-01

### Commit
- Hash: `7d41f452b`
- Files changed: 1

### Changes
- Added synthetic `rank: null` field to ILIKE fallback results in `/src/app/api/v1/agents/route.ts`
- Ensures consistency with FTS results that include the rank field
- Prevents `ts_rank: undefined` in API response

### Build Gate
- ✅ TypeScript typecheck passed
- ✅ ESLint validation passed
