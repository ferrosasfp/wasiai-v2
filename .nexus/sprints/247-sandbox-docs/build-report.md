## Build Report — WAS-247

- Rate limit: 2→3 ✅
- README actualizado ✅
- Commit: `1a7a03b0d`

### Changed Files
- `src/app/api/v1/sandbox/invoke/[slug]/route.ts` — Rate limit increased from 2 to 3 calls/day per IP per agent
- `README.md` — Added sandbox endpoint to API Endpoints table and new "Sandbox — Free Trial" section with example usage

### Build Gates
- ✅ TypeScript typecheck passed
- ✅ ESLint passed (0 warnings)

### Commit Details
```
fix(WAS-247): raise sandbox anon rate limit to 3/day, document sandbox endpoint in README
```

**Hash:** `1a7a03b0d`
